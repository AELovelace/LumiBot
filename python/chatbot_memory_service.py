import json
import math
import os
import sqlite3
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

SERVICE_NAME = 'chatbot-memory-sql'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_PAGE_PATH = os.path.join(BASE_DIR, 'static', 'memory-admin.html')
SCHEMA = '''
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS runtime_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_state (
    channel_id TEXT PRIMARY KEY,
    last_reply_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channel_history (
    channel_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, position),
    FOREIGN KEY (channel_id) REFERENCES channel_state(channel_id) ON DELETE CASCADE
);
PRAGMA user_version = 1;
'''


def log(message):
    print(f'[chatbot-memory-service] {message}', flush=True)


def parse_int_env(name, default):
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def load_admin_page_html():
    try:
        with open(ADMIN_PAGE_PATH, 'r', encoding='utf8') as handle:
            return handle.read()
    except Exception as error:  # pragma: no cover - startup fallback only
        log(f'Could not load admin page at {ADMIN_PAGE_PATH}: {error}')
        return (
            '<!doctype html><meta charset="utf-8"><title>Lumi Memory Admin</title>'
            '<body style="font-family:Segoe UI,Arial,sans-serif;padding:20px;background:#111;color:#eee">'
            '<h1>Lumi Memory Admin</h1>'
            '<p>Admin UI file was not found.</p>'
            f'<p>Expected: <code>{ADMIN_PAGE_PATH}</code></p>'
            '</body>'
        )


def normalize_timestamp(value):
    if isinstance(value, bool):
        return 0

    if isinstance(value, (int, float)) and math.isfinite(value):
        return int(value)

    return 0



def normalize_history(history):
    if not isinstance(history, list):
        return []

    normalized = []
    for item in history:
        if not isinstance(item, dict):
            continue

        content = item.get('content')
        if not isinstance(content, str) or not content.strip():
            continue

        author = item.get('author') if isinstance(item.get('author'), str) else 'unknown'
        normalized.append({
            'role': 'assistant' if item.get('role') == 'assistant' else 'user',
            'author': author,
            'content': content,
            'timestamp': normalize_timestamp(item.get('timestamp')),
        })

    return normalized



def normalize_channels(raw_channels):
    if not isinstance(raw_channels, dict):
        return {}

    normalized = {}
    for channel_id, value in raw_channels.items():
        if not isinstance(value, dict):
            continue

        normalized_channel_id = str(channel_id).strip()
        if not normalized_channel_id:
            continue

        normalized[normalized_channel_id] = {
            'history': normalize_history(value.get('history')),
            'lastReplyAt': normalize_timestamp(value.get('lastReplyAt')),
        }

    return normalized



def normalize_settings(raw_settings):
    if not isinstance(raw_settings, dict):
        return {}

    normalized = {}
    for key, value in raw_settings.items():
        if not isinstance(key, str):
            continue

        try:
            json.dumps(value)
            normalized[key] = value
        except TypeError:
            normalized[key] = str(value)

    return normalized



def normalize_state(raw_state):
    if not isinstance(raw_state, dict):
        return {
            'channels': {},
            'settings': {},
        }

    return {
        'channels': normalize_channels(raw_state.get('channels')),
        'settings': normalize_settings(raw_state.get('settings')),
    }


class MemoryDatabase:
    def __init__(self, db_path):
        self.db_path = db_path
        self._lock = threading.RLock()

        target_dir = os.path.dirname(db_path)
        if target_dir:
            os.makedirs(target_dir, exist_ok=True)

        self._initialize_schema()

    def _connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys = ON')
        return connection

    def _initialize_schema(self):
        with self._connect() as connection:
            connection.executescript(SCHEMA)

    def is_empty(self):
        with self._lock, self._connect() as connection:
            channel_count = connection.execute('SELECT COUNT(*) AS count FROM channel_state').fetchone()['count']
            settings_count = connection.execute('SELECT COUNT(*) AS count FROM runtime_settings').fetchone()['count']
            return channel_count == 0 and settings_count == 0

    def load_state(self):
        with self._lock, self._connect() as connection:
            state = {
                'channels': {},
                'settings': {},
            }

            for row in connection.execute('SELECT key, value_json FROM runtime_settings ORDER BY key'):
                try:
                    state['settings'][row['key']] = json.loads(row['value_json'])
                except json.JSONDecodeError:
                    state['settings'][row['key']] = row['value_json']

            for row in connection.execute('SELECT channel_id, last_reply_at FROM channel_state ORDER BY channel_id'):
                state['channels'][row['channel_id']] = {
                    'history': [],
                    'lastReplyAt': int(row['last_reply_at'] or 0),
                }

            for row in connection.execute(
                'SELECT channel_id, position, role, author, content, timestamp '
                'FROM channel_history '
                'ORDER BY channel_id, position'
            ):
                channel = state['channels'].setdefault(row['channel_id'], {
                    'history': [],
                    'lastReplyAt': 0,
                })
                channel['history'].append({
                    'role': row['role'],
                    'author': row['author'],
                    'content': row['content'],
                    'timestamp': int(row['timestamp'] or 0),
                })

            return state

    def replace_state(self, snapshot):
        normalized = normalize_state(snapshot)

        with self._lock, self._connect() as connection:
            try:
                connection.execute('BEGIN')
                connection.execute('DELETE FROM channel_history')
                connection.execute('DELETE FROM channel_state')
                connection.execute('DELETE FROM runtime_settings')

                for key, value in normalized['settings'].items():
                    connection.execute(
                        'INSERT INTO runtime_settings (key, value_json) VALUES (?, ?)',
                        (key, json.dumps(value)),
                    )

                for channel_id, state in normalized['channels'].items():
                    connection.execute(
                        'INSERT INTO channel_state (channel_id, last_reply_at) VALUES (?, ?)',
                        (channel_id, state['lastReplyAt']),
                    )

                    for position, entry in enumerate(state['history']):
                        connection.execute(
                            'INSERT INTO channel_history '
                            '(channel_id, position, role, author, content, timestamp) '
                            'VALUES (?, ?, ?, ?, ?, ?)',
                            (
                                channel_id,
                                position,
                                entry['role'],
                                entry['author'],
                                entry['content'],
                                entry['timestamp'],
                            ),
                        )

                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return normalized

    def migrate_legacy_json(self, legacy_path):
        if not legacy_path or not os.path.exists(legacy_path) or not self.is_empty():
            return False

        try:
            with open(legacy_path, 'r', encoding='utf8') as handle:
                legacy_state = json.load(handle)
        except Exception as error:  # pragma: no cover - defensive logging for startup only
            log(f'Legacy JSON migration skipped: {error}')
            return False

        migrated = self.replace_state(legacy_state)
        log(
            f'Migrated legacy chatbot memory from {legacy_path} '
            f'({len(migrated["channels"])} channels, {len(migrated["settings"])} settings).'
        )
        return True


class MemoryHttpServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, request_handler_class, database, admin_page_html):
        super().__init__(server_address, request_handler_class)
        self.database = database
        self.admin_page_html = admin_page_html


class MemoryRequestHandler(BaseHTTPRequestHandler):
    server_version = 'ChatbotMemoryService/1.0'

    def _send_json(self, status_code, payload):
        rendered = json.dumps(payload, ensure_ascii=False).encode('utf8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(rendered)))
        self.end_headers()
        self.wfile.write(rendered)

    def _send_html(self, status_code, html):
        rendered = html.encode('utf8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(rendered)))
        self.end_headers()
        self.wfile.write(rendered)

    def _read_json_body(self):
        raw_length = self.headers.get('Content-Length', '0')
        try:
            content_length = int(raw_length)
        except ValueError as error:
            raise ValueError('Invalid Content-Length header.') from error

        if content_length <= 0:
            return {}

        raw_body = self.rfile.read(content_length)
        try:
            return json.loads(raw_body.decode('utf8'))
        except json.JSONDecodeError as error:
            raise ValueError('Request body was not valid JSON.') from error

    def _handle_exception(self, error, status_code=HTTPStatus.INTERNAL_SERVER_ERROR):
        log(f'Request failed: {error}')
        self._send_json(status_code, {
            'error': str(error),
            'service': SERVICE_NAME,
        })

    def do_GET(self):
        parsed = urlparse(self.path)

        try:
            if parsed.path in ('/', '/admin'):
                self._send_html(HTTPStatus.OK, self.server.admin_page_html)
                return

            if parsed.path == '/favicon.ico':
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return

            if parsed.path == '/health':
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    'dbFile': self.server.database.db_path,
                    'pid': os.getpid(),
                })
                return

            if parsed.path == '/state':
                self._send_json(HTTPStatus.OK, self.server.database.load_state())
                return

            self._send_json(HTTPStatus.NOT_FOUND, {
                'error': f'Unknown path: {parsed.path}',
                'service': SERVICE_NAME,
            })
        except Exception as error:  # pragma: no cover - defensive request boundary
            self._handle_exception(error)

    def do_PUT(self):
        parsed = urlparse(self.path)

        try:
            if parsed.path != '/state':
                self._send_json(HTTPStatus.NOT_FOUND, {
                    'error': f'Unknown path: {parsed.path}',
                    'service': SERVICE_NAME,
                })
                return

            snapshot = self._read_json_body()
            normalized = self.server.database.replace_state(snapshot)
            self._send_json(HTTPStatus.OK, {
                'ok': True,
                'service': SERVICE_NAME,
                'channels': len(normalized['channels']),
                'settings': len(normalized['settings']),
            })
        except ValueError as error:
            self._handle_exception(error, HTTPStatus.BAD_REQUEST)
        except Exception as error:  # pragma: no cover - defensive request boundary
            self._handle_exception(error)

    def do_POST(self):
        parsed = urlparse(self.path)

        try:
            if parsed.path != '/shutdown':
                self._send_json(HTTPStatus.NOT_FOUND, {
                    'error': f'Unknown path: {parsed.path}',
                    'service': SERVICE_NAME,
                })
                return

            self._send_json(HTTPStatus.OK, {
                'ok': True,
                'service': SERVICE_NAME,
            })
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        except Exception as error:  # pragma: no cover - defensive request boundary
            self._handle_exception(error)

    def log_message(self, format_string, *args):
        return



def main():
    host = os.environ.get('CHATBOT_MEMORY_SERVICE_HOST', '127.0.0.1').strip() or '127.0.0.1'
    port = parse_int_env('CHATBOT_MEMORY_SERVICE_PORT', 8765)
    db_file = os.path.abspath(os.environ.get('CHATBOT_MEMORY_DB_FILE', 'data/chatbot-memory.sqlite3'))
    legacy_file = os.environ.get('CHATBOT_MEMORY_LEGACY_FILE') or os.environ.get('CHATBOT_MEMORY_FILE', '')
    legacy_file = os.path.abspath(legacy_file) if legacy_file else ''

    database = MemoryDatabase(db_file)
    database.migrate_legacy_json(legacy_file)
    admin_page_html = load_admin_page_html()

    server = MemoryHttpServer((host, port), MemoryRequestHandler, database, admin_page_html)
    log(f'{SERVICE_NAME} listening on http://{host}:{port} using {db_file}')
    log(f'Memory admin UI: http://{host}:{port}/admin')

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log('Service stopped.')


if __name__ == '__main__':
    main()
