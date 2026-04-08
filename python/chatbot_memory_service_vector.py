#!/usr/bin/env python3
"""
Vector-enabled chatbot memory service using ChromaDB for semantic search.
Maintains backward compatibility with existing API while enabling vector similarity search.
"""

import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
except ImportError:
    print('Error: chromadb and sentence-transformers are required.')
    print('Install with: pip install chromadb sentence-transformers')
    import sys
    sys.exit(1)

SERVICE_NAME = 'chatbot-memory-vector'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_PAGE_PATH = os.path.join(BASE_DIR, 'static', 'memory-admin.html')
SAFE_IDENTIFIER_PATTERN = re.compile(r'[^A-Za-z0-9_]+')
VALID_IDENTIFIER_PATTERN = re.compile(r'^[A-Za-z0-9_]+$')
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9']+")

# ChromaDB paths
CHROMA_DB_PATH = os.path.join(os.path.dirname(BASE_DIR), 'data', 'chroma-db')

# Schema for fallback SQLite (for state/history only, not for user memories)
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
PRAGMA user_version = 3;
'''


def log(message):
    print(f'[chatbot-memory-vector] {message}', flush=True)


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
    except Exception as error:
        log(f'Could not load admin page at {ADMIN_PAGE_PATH}: {error}')
        return (
            '<!doctype html><meta charset="utf-8"><title>Lumi Memory Admin</title>'
            '<body style="font-family:Segoe UI,Arial,sans-serif;padding:20px;background:#111;color:#eee">'
            '<h1>Lumi Memory Admin (Vector)</h1>'
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


class VectorMemoryDatabase:
    """Memory database using ChromaDB for vector search with SQLite fallback for state."""
    
    def __init__(self, db_path):
        self.db_path = db_path
        self._lock = threading.RLock()
        self.sqlite_path = os.path.join(os.path.dirname(db_path), 'chatbot-memory.sqlite3')
        
        # Initialize ChromaDB
        os.makedirs(CHROMA_DB_PATH, exist_ok=True)
        self.chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        
        # Initialize embedding model (lazy load)
        self.embedding_model = None
        self._embedding_lock = threading.RLock()
        
        # Initialize SQLite for state/history
        self._initialize_sqlite_schema()

    def _get_embedding_model(self):
        """Lazy load the embedding model on first use."""
        if self.embedding_model is None:
            with self._embedding_lock:
                if self.embedding_model is None:
                    log('Loading embedding model (all-MiniLM-L6-v2)...')
                    self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
                    log('Embedding model ready.')
        return self.embedding_model

    def _connect(self):
        """Context manager for SQLite connection."""
        class SqliteContext:
            def __init__(ctx_self, db_path):
                ctx_self.db_path = db_path
                ctx_self.connection = None

            def __enter__(ctx_self):
                ctx_self.connection = sqlite3.connect(ctx_self.db_path)
                ctx_self.connection.row_factory = sqlite3.Row
                return ctx_self.connection

            def __exit__(ctx_self, *args):
                if ctx_self.connection:
                    ctx_self.connection.close()

        return SqliteContext(self.sqlite_path)

    def _initialize_sqlite_schema(self):
        """Initialize SQLite schema for state and history."""
        with self._lock, self._connect() as connection:
            try:
                connection.executescript(SCHEMA)
                connection.commit()
            except Exception as e:
                log(f'Warning: Could not fully initialize schema: {e}')

    def _get_user_collection(self, user_id):
        """Get or create a ChromaDB collection for a user."""
        collection_name = f'memories_{user_id}'.replace('-', '_').replace(' ', '_')
        return self.chroma_client.get_or_create_collection(
            name=collection_name,
            metadata={'user_id': user_id, 'type': 'user_memories'}
        )

    def is_empty(self):
        """Check if database has any data."""
        with self._lock, self._connect() as connection:
            channel_count = connection.execute('SELECT COUNT(*) AS count FROM channel_state').fetchone()['count']
            settings_count = connection.execute('SELECT COUNT(*) AS count FROM runtime_settings').fetchone()['count']
            return channel_count == 0 and settings_count == 0

    def load_state(self):
        """Load channel state and settings from SQLite."""
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
        """Replace all channel state and settings."""
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
        """Add a memory entry to ChromaDB vector database."""
        normalized = normalize_memory_entry_payload(payload)
        user_id = normalized['userId']
        
        try:
            collection = self._get_user_collection(user_id)
            
            # Create unique ID
            memory_id = f'{int(time.time() * 1000)}_{hash(normalized["content"])}'
            
            # Add to ChromaDB (embeddings are generated automatically)
            collection.add(
                ids=[memory_id],
                documents=[normalized['content']],
                metadatas=[{
                    'user_id': user_id,
                    'channel_id': normalized['channelId'],
                    'role': normalized['role'],
                    'author_id': normalized['authorId'],
                    'author': normalized['author'],
                    'timestamp': str(normalized['timestamp']),
                }]
            )
            
            return {
                'userId': user_id,
                'documentId': memory_id,
                'timestamp': normalized['timestamp'],
                'stored': 'vector',
            }
        except Exception as e:
            log(f'Error adding memory for user {user_id}: {e}')
            raise

    def search_memory(self, payload):
        """Search memories using vector similarity."""
        normalized = normalize_search_payload(payload)
        user_id = normalized['userId']
        query = normalized['query']
        limit = normalized['limit']
        
        try:
            collection = self._get_user_collection(user_id)
            
            # If query is empty, return recent memories
            if not query.strip():
                results = collection.get(
                    limit=limit,
                    include=['documents', 'metadatas']
                )
                
                if not results or not results['ids']:
                    return {
                        'matches': [],
                        'deep': False,
                        'searchedUsers': 1,
                    }
                
                # Convert to match format and sort by recency
                matches = []
                now_ms = int(time.time() * 1000)
                
                for i, doc_id in enumerate(results['ids']):
                    metadata = results['metadatas'][i]
                    timestamp = int(metadata.get('timestamp', 0))
                    # Score based on recency
                    recency_score = max(0.0, 1.0 - ((now_ms - timestamp) / (14 * 24 * 60 * 60 * 1000)))
                    
                    matches.append({
                        'userId': user_id,
                        'channelId': metadata.get('channel_id', 'unknown'),
                        'role': metadata.get('role', 'user'),
                        'authorId': metadata.get('author_id', user_id),
                        'author': metadata.get('author', 'unknown'),
                        'content': results['documents'][i],
                        'timestamp': timestamp,
                        'score': round(recency_score, 4),
                    })
                
                matches.sort(key=lambda x: x['timestamp'], reverse=True)
                return {
                    'matches': matches[:limit],
                    'deep': False,
                    'searchedUsers': 1,
                }
            
            # Vector similarity search
            results = collection.query(
                query_texts=[query],
                n_results=limit * 2,  # Get extra results to filter
                include=['documents', 'metadatas', 'distances']
            )
            
            if not results or not results['ids'] or not results['ids'][0]:
                return {
                    'matches': [],
                    'deep': normalized['deep'],
                    'searchedUsers': 1,
                }
            
            matches = []
            seen = set()
            now_ms = int(time.time() * 1000)
            
            for i, doc_id in enumerate(results['ids'][0]):
                metadata = results['metadatas'][0][i]
                timestamp = int(metadata.get('timestamp', 0))
                
                # Convert distance to similarity score (smaller distance = higher similarity)
                # Distance is between 0 and 2 for cosine distance
                distance = results['distances'][0][i] if results['distances'] and results['distances'][0] else 2.0
                similarity = 1.0 - (distance / 2.0)  # Normalize to 0-1
                
                # Boost score with recency
                recency = max(0.0, 1.0 - ((now_ms - timestamp) / (30 * 24 * 60 * 60 * 1000)))
                final_score = (similarity * 0.8) + (recency * 0.2)
                
                fingerprint = (
                    user_id,
                    metadata.get('role', 'user'),
                    results['documents'][0][i].strip().lower(),
                )
                
                if fingerprint in seen or not results['documents'][0][i].strip():
                    continue
                
                seen.add(fingerprint)
                matches.append({
                    'userId': user_id,
                    'channelId': metadata.get('channel_id', 'unknown'),
                    'role': metadata.get('role', 'user'),
                    'authorId': metadata.get('author_id', user_id),
                    'author': metadata.get('author', 'unknown'),
                    'content': results['documents'][0][i],
                    'timestamp': timestamp,
                    'score': round(final_score, 4),
                })
                
                if len(matches) >= limit:
                    break
            
            return {
                'matches': matches,
                'deep': normalized['deep'],
                'searchedUsers': 1,
            }
            
        except Exception as e:
            log(f'Error searching memory for user {user_id}: {e}')
            return {
                'matches': [],
                'deep': normalized['deep'],
                'searchedUsers': 1,
            }

    def list_user_memory_users(self):
        """List all users with stored memories."""
        try:
            collections = self.chroma_client.list_collections()
            users = []
            for collection in collections:
                if collection.name.startswith('memories_'):
                    user_id = collection.name.replace('memories_', '').replace('_', '-')
                    count = collection.count()
                    users.append({
                        'userId': user_id,
                        'memoryCount': count,
                    })
            return users
        except Exception as e:
            log(f'Error listing users: {e}')
            return []

    def load_user_memory_entries(self, user_id, limit='100'):
        """Load memory entries for a user."""
        try:
            limit_int = int(limit)
            limit_int = max(1, min(limit_int, 1000))
        except (ValueError, TypeError):
            limit_int = 100
        
        try:
            collection = self._get_user_collection(user_id)
            results = collection.get(
                limit=limit_int,
                include=['documents', 'metadatas']
            )
            
            entries = []
            if results and results['ids']:
                for i, doc_id in enumerate(results['ids']):
                    metadata = results['metadatas'][i]
                    entries.append({
                        'id': doc_id,
                        'content': results['documents'][i],
                        'channelId': metadata.get('channel_id', 'unknown'),
                        'role': metadata.get('role', 'user'),
                        'author': metadata.get('author', 'unknown'),
                        'timestamp': int(metadata.get('timestamp', 0)),
                    })
            
            return {
                'userId': user_id,
                'count': len(entries),
                'entries': entries,
            }
        except Exception as e:
            log(f'Error loading memories for user {user_id}: {e}')
            return {
                'userId': user_id,
                'count': 0,
                'entries': [],
            }

    def reset_database(self):
        """Reset all memories and state."""
        with self._lock:
            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            
            # Backup ChromaDB
            chroma_backup = os.path.join(
                os.path.dirname(CHROMA_DB_PATH),
                f'chroma-db_backup_{timestamp}'
            )
            if os.path.exists(CHROMA_DB_PATH):
                shutil.copytree(CHROMA_DB_PATH, chroma_backup)
                log(f'Backed up ChromaDB to {chroma_backup}')
                shutil.rmtree(CHROMA_DB_PATH)
            
            # Reset ChromaDB
            os.makedirs(CHROMA_DB_PATH, exist_ok=True)
            self.chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
            
            # Reset SQLite
            with self._connect() as connection:
                connection.executescript('''
                    DELETE FROM channel_history;
                    DELETE FROM channel_state;
                    DELETE FROM runtime_settings;
                ''')
                connection.commit()
            
            log('Database reset complete.')
            
            return {
                'backupFile': chroma_backup,
                'timestamp': timestamp,
            }

    def migrate_legacy_json(self, legacy_path):
        """Migrate legacy JSON state (only channel state/history)."""
        if not legacy_path or not os.path.exists(legacy_path) or not self.is_empty():
            return False

        try:
            with open(legacy_path, 'r', encoding='utf8') as handle:
                legacy_state = json.load(handle)
        except Exception as error:
            log(f'Legacy JSON migration skipped: {error}')
            return False

        migrated = self.replace_state(legacy_state)
        log(
            f'Migrated legacy chatbot state from {legacy_path} '
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
    server_version = 'ChatbotMemoryService/2.0'

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
                    'backend': 'chromadb',
                    'chromaPath': CHROMA_DB_PATH,
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
        except Exception as error:
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
        except Exception as error:
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

            if parsed.path == '/memory/reset':
                result = self.server.database.reset_database()
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    'backupFile': result['backupFile'],
                    'timestamp': result['timestamp'],
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
        except Exception as error:
            self._handle_exception(error)

    def log_message(self, format_string, *args):
        return


def main():
    host = os.environ.get('CHATBOT_MEMORY_SERVICE_HOST', '127.0.0.1').strip() or '127.0.0.1'
    port = parse_int_env('CHATBOT_MEMORY_SERVICE_PORT', 8765)
    db_file = os.path.abspath(os.environ.get('CHATBOT_MEMORY_DB_FILE', 'data/chatbot-memory.sqlite3'))
    legacy_file = os.environ.get('CHATBOT_MEMORY_LEGACY_FILE') or os.environ.get('CHATBOT_MEMORY_FILE', '')
    legacy_file = os.path.abspath(legacy_file) if legacy_file else ''

    database = VectorMemoryDatabase(db_file)
    database.migrate_legacy_json(legacy_file)

    server = MemoryHttpServer((host, port), MemoryRequestHandler, database)
    log(f'{SERVICE_NAME} listening on http://{host}:{port}')
    log(f'Vector database (ChromaDB) path: {CHROMA_DB_PATH}')
    log(f'Memory admin UI: http://{host}:{port}/admin')
    log('Vector similarity search enabled for per-user memories.')

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log('Service stopped.')


if __name__ == '__main__':
    main()
