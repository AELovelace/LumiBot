import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

SERVICE_NAME = 'chatbot-memory-sql'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_PAGE_PATH = os.path.join(BASE_DIR, 'static', 'memory-admin.html')
USER_MEMORY_TABLE_PREFIX = 'user_memory_'
SAFE_IDENTIFIER_PATTERN = re.compile(r'[^A-Za-z0-9_]+')
VALID_IDENTIFIER_PATTERN = re.compile(r'^[A-Za-z0-9_]+$')
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9']+")

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
CREATE TABLE IF NOT EXISTS user_memory_registry (
    user_id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL UNIQUE,
    last_seen_at INTEGER NOT NULL DEFAULT 0
);
PRAGMA user_version = 2;
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


def parse_boolean(value):
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return value != 0

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ('1', 'true', 'yes', 'on'):
            return True
        if normalized in ('0', 'false', 'no', 'off'):
            return False

    return False


def normalize_limit(value, default, minimum=1, maximum=50):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default

    if parsed < minimum:
        return minimum

    if parsed > maximum:
        return maximum

    return parsed


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


def tokenize_text(value):
    if not isinstance(value, str):
        return []

    return [
        token.lower()
        for token in TOKEN_PATTERN.findall(value.lower())
        if len(token) > 1
    ]


def compute_similarity_score(query_lower, query_tokens, content, timestamp, now_ms, deep):
    if not isinstance(content, str) or not content.strip():
        return 0.0

    content_lower = content.lower()

    if not query_lower and not query_tokens:
        recency_only = max(0.0, 1.0 - ((now_ms - timestamp) / (14 * 24 * 60 * 60 * 1000)))
        return recency_only + 0.01

    token_hits = sum(1 for token in query_tokens if token in content_lower)
    phrase_hit = bool(query_lower) and query_lower in content_lower

    if token_hits == 0 and not phrase_hit:
        return 0.0

    score = float(token_hits * 3)
    if phrase_hit:
        score += 6.0

    recency = max(0.0, 1.0 - ((now_ms - timestamp) / (30 * 24 * 60 * 60 * 1000)))
    score += recency * (0.2 if deep else 0.5)

    return score


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


def normalize_memory_entry_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError('Memory entry payload must be a JSON object.')

    user_id = str(payload.get('userId') or '').strip()
    if not user_id:
        raise ValueError('userId is required for memory logging.')

    channel_id = str(payload.get('channelId') or 'unknown-channel').strip() or 'unknown-channel'
    role = 'assistant' if payload.get('role') == 'assistant' else 'user'

    content = payload.get('content')
    if not isinstance(content, str) or not content.strip():
        raise ValueError('content is required for memory logging.')

    author = payload.get('author')
    if not isinstance(author, str) or not author.strip():
        author = 'Lumi' if role == 'assistant' else 'unknown'

    author_id = payload.get('authorId')
    if not isinstance(author_id, str) or not author_id.strip():
        author_id = 'lumi' if role == 'assistant' else user_id

    timestamp = normalize_timestamp(payload.get('timestamp'))
    if timestamp <= 0:
        timestamp = int(time.time() * 1000)

    return {
        'userId': user_id,
        'channelId': channel_id,
        'role': role,
        'authorId': author_id.strip(),
        'author': author.strip(),
        'content': content.strip(),
        'timestamp': timestamp,
    }


def normalize_search_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError('Memory search payload must be a JSON object.')

    user_id = str(payload.get('userId') or '').strip()
    if not user_id:
        raise ValueError('userId is required for memory search.')

    query = payload.get('query')
    query = query if isinstance(query, str) else str(query or '')

    return {
        'userId': user_id,
        'query': query.strip(),
        'deep': parse_boolean(payload.get('deep')),
        'limit': normalize_limit(payload.get('limit'), 8, minimum=1, maximum=50),
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

    def _build_user_table_name(self, user_id):
        safe = SAFE_IDENTIFIER_PATTERN.sub('_', user_id).strip('_').lower()
        if not safe:
            safe = 'user'

        if safe[0].isdigit():
            safe = f'u_{safe}'

        digest = hashlib.sha1(user_id.encode('utf8')).hexdigest()[:12]
        return f'{USER_MEMORY_TABLE_PREFIX}{safe[:24]}_{digest}'

    def _is_valid_table_name(self, table_name):
        return isinstance(table_name, str) and bool(VALID_IDENTIFIER_PATTERN.match(table_name))

    def _create_user_table(self, connection, table_name):
        connection.execute(
            f'''CREATE TABLE IF NOT EXISTS "{table_name}" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                author_id TEXT NOT NULL,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL DEFAULT 0
            )'''
        )
        connection.execute(
            f'CREATE INDEX IF NOT EXISTS "{table_name}_timestamp_idx" ON "{table_name}" (timestamp DESC)'
        )
        connection.execute(
            f'CREATE INDEX IF NOT EXISTS "{table_name}_channel_idx" ON "{table_name}" (channel_id)'
        )

    def _get_registered_user_table(self, connection, user_id):
        row = connection.execute(
            'SELECT table_name FROM user_memory_registry WHERE user_id = ?',
            (user_id,),
        ).fetchone()

        if not row:
            return None

        table_name = row['table_name']
        if not self._is_valid_table_name(table_name):
            raise ValueError(f'Unsafe table name in registry: {table_name}')

        return table_name

    def _ensure_user_table(self, connection, user_id, last_seen_at):
        table_name = self._get_registered_user_table(connection, user_id)

        if not table_name:
            table_name = self._build_user_table_name(user_id)
            connection.execute(
                'INSERT INTO user_memory_registry (user_id, table_name, last_seen_at) VALUES (?, ?, ?)',
                (user_id, table_name, last_seen_at),
            )

        self._create_user_table(connection, table_name)
        connection.execute(
            '''UPDATE user_memory_registry
               SET last_seen_at = CASE
                 WHEN last_seen_at > ? THEN last_seen_at
                 ELSE ?
               END
               WHERE user_id = ?''',
            (last_seen_at, last_seen_at, user_id),
        )

        return table_name

    def _iter_user_tables(self, connection):
        rows = connection.execute(
            'SELECT user_id, table_name FROM user_memory_registry ORDER BY user_id',
        ).fetchall()

        tables = []
        for row in rows:
            user_id = row['user_id']
            table_name = row['table_name']
            if not self._is_valid_table_name(table_name):
                continue
            tables.append((user_id, table_name))

        return tables

    def _fetch_memory_rows(self, connection, table_name, row_limit=None):
        if row_limit is None:
            rows = connection.execute(
                f'''SELECT channel_id, role, author_id, author, content, timestamp
                    FROM "{table_name}"
                    ORDER BY timestamp DESC''',
            ).fetchall()
            return rows

        rows = connection.execute(
            f'''SELECT channel_id, role, author_id, author, content, timestamp
                FROM "{table_name}"
                ORDER BY timestamp DESC
                LIMIT ?''',
            (row_limit,),
        ).fetchall()
        return rows

    def list_user_memory_users(self):
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                'SELECT user_id, table_name, last_seen_at FROM user_memory_registry',
            ).fetchall()

            users = []
            for row in rows:
                table_name = row['table_name']
                if not self._is_valid_table_name(table_name):
                    continue

                self._create_user_table(connection, table_name)
                counts = connection.execute(
                    f'SELECT COUNT(*) AS count, MAX(timestamp) AS last_entry_at FROM "{table_name}"',
                ).fetchone()

                last_seen_at = int(row['last_seen_at'] or 0)
                last_entry_at = int(counts['last_entry_at'] or 0)
                users.append({
                    'userId': row['user_id'],
                    'tableName': table_name,
                    'entryCount': int(counts['count'] or 0),
                    'lastSeenAt': max(last_seen_at, last_entry_at),
                    'lastEntryAt': last_entry_at,
                })

            users.sort(key=lambda item: (item['lastSeenAt'], item['userId']), reverse=True)

        return users

    def load_user_memory_entries(self, user_id, limit=100):
        normalized_user_id = str(user_id or '').strip()
        if not normalized_user_id:
            raise ValueError('userId is required.')

        normalized_limit = normalize_limit(limit, 100, minimum=1, maximum=500)

        with self._lock, self._connect() as connection:
            table_name = self._get_registered_user_table(connection, normalized_user_id)
            if not table_name:
                return {
                    'userId': normalized_user_id,
                    'tableName': None,
                    'limit': normalized_limit,
                    'totalEntries': 0,
                    'entries': [],
                }

            self._create_user_table(connection, table_name)
            total_entries = connection.execute(
                f'SELECT COUNT(*) AS count FROM "{table_name}"',
            ).fetchone()['count']
            rows = connection.execute(
                f'''SELECT id, channel_id, role, author_id, author, content, timestamp
                    FROM "{table_name}"
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ?''',
                (normalized_limit,),
            ).fetchall()

            entries = []
            for row in rows:
                entries.append({
                    'id': int(row['id'] or 0),
                    'channelId': row['channel_id'],
                    'role': row['role'],
                    'authorId': row['author_id'],
                    'author': row['author'],
                    'content': row['content'],
                    'timestamp': int(row['timestamp'] or 0),
                })

        return {
            'userId': normalized_user_id,
            'tableName': table_name,
            'limit': normalized_limit,
            'totalEntries': int(total_entries or 0),
            'entries': entries,
        }

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

    def append_user_memory_entry(self, payload):
        normalized = normalize_memory_entry_payload(payload)

        with self._lock, self._connect() as connection:
            try:
                connection.execute('BEGIN')
                table_name = self._ensure_user_table(
                    connection,
                    normalized['userId'],
                    normalized['timestamp'],
                )
                connection.execute(
                    f'''INSERT INTO "{table_name}" (
                        channel_id,
                        role,
                        author_id,
                        author,
                        content,
                        timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?)''',
                    (
                        normalized['channelId'],
                        normalized['role'],
                        normalized['authorId'],
                        normalized['author'],
                        normalized['content'],
                        normalized['timestamp'],
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        return {
            'userId': normalized['userId'],
            'tableName': table_name,
            'timestamp': normalized['timestamp'],
        }

    def search_memory(self, payload):
        normalized = normalize_search_payload(payload)

        query_lower = normalized['query'].lower()
        query_tokens = tokenize_text(query_lower)
        now_ms = int(time.time() * 1000)

        with self._lock, self._connect() as connection:
            targets = []

            if normalized['deep']:
                targets = self._iter_user_tables(connection)
            else:
                table_name = self._get_registered_user_table(connection, normalized['userId'])
                if table_name:
                    targets = [(normalized['userId'], table_name)]

            candidates = []
            for target_user_id, table_name in targets:
                row_limit = None if normalized['deep'] else 500
                rows = self._fetch_memory_rows(connection, table_name, row_limit=row_limit)

                for row in rows:
                    timestamp = int(row['timestamp'] or 0)
                    score = compute_similarity_score(
                        query_lower,
                        query_tokens,
                        row['content'],
                        timestamp,
                        now_ms,
                        normalized['deep'],
                    )
                    if score <= 0:
                        continue

                    candidates.append({
                        'userId': target_user_id,
                        'channelId': row['channel_id'],
                        'role': row['role'],
                        'authorId': row['author_id'],
                        'author': row['author'],
                        'content': row['content'],
                        'timestamp': timestamp,
                        'score': round(score, 4),
                    })

            candidates.sort(key=lambda item: (item['score'], item['timestamp']), reverse=True)

            matches = []
            seen = set()
            for candidate in candidates:
                fingerprint = (
                    candidate['userId'],
                    candidate['role'],
                    candidate['content'].strip().lower(),
                )
                if fingerprint in seen:
                    continue

                seen.add(fingerprint)
                matches.append(candidate)
                if len(matches) >= normalized['limit']:
                    break

        return {
            'matches': matches,
            'deep': normalized['deep'],
            'searchedUsers': len(targets),
        }

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

    def __init__(self, server_address, request_handler_class, database):
        super().__init__(server_address, request_handler_class)
        self.database = database


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
                self._send_html(HTTPStatus.OK, load_admin_page_html())
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

            if parsed.path == '/memory/users':
                users = self.server.database.list_user_memory_users()
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    'count': len(users),
                    'users': users,
                })
                return

            if parsed.path.startswith('/memory/user/'):
                encoded_user_id = parsed.path[len('/memory/user/'):]
                user_id = unquote(encoded_user_id).strip()
                if not user_id:
                    raise ValueError('userId path segment is required.')

                params = parse_qs(parsed.query or '')
                limit_raw = params.get('limit', ['100'])[0]
                result = self.server.database.load_user_memory_entries(user_id, limit=limit_raw)
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    **result,
                })
                return

            self._send_json(HTTPStatus.NOT_FOUND, {
                'error': f'Unknown path: {parsed.path}',
                'service': SERVICE_NAME,
            })
        except ValueError as error:
            self._handle_exception(error, HTTPStatus.BAD_REQUEST)
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
            if parsed.path == '/memory/log':
                payload = self._read_json_body()
                result = self.server.database.append_user_memory_entry(payload)
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    **result,
                })
                return

            if parsed.path == '/memory/search':
                payload = self._read_json_body()
                result = self.server.database.search_memory(payload)
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    **result,
                })
                return

            if parsed.path == '/shutdown':
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                })
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return

            self._send_json(HTTPStatus.NOT_FOUND, {
                'error': f'Unknown path: {parsed.path}',
                'service': SERVICE_NAME,
            })
        except ValueError as error:
            self._handle_exception(error, HTTPStatus.BAD_REQUEST)
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

    server = MemoryHttpServer((host, port), MemoryRequestHandler, database)
    log(f'{SERVICE_NAME} listening on http://{host}:{port} using {db_file}')
    log(f'Memory admin UI: http://{host}:{port}/admin')
    log('Per-user SQL memory tables and search endpoints are enabled.')

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log('Service stopped.')


if __name__ == '__main__':
    main()
