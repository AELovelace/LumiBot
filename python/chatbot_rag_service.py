#!/usr/bin/env python3
"""
RAG (Retrieval-Augmented Generation) service for memory-enhanced LLM responses.
Integrates ChromaDB vector memories with Ollama for context-aware generation.
"""

import json
import os
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import threading

try:
    import chromadb
except ImportError:
    print('Error: chromadb is required.')
    print('Install with: pip install chromadb')
    sys.exit(1)

SERVICE_NAME = 'chatbot-rag-service'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DB_PATH = os.path.join(os.path.dirname(BASE_DIR), 'data', 'chroma-db')

# ChromaDB client
client = chromadb.PersistentClient(path=CHROMA_DB_PATH)


def log(message):
    print(f'[{SERVICE_NAME}] {message}', flush=True)


def parse_int_env(name, default):
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


class RAGDatabase:
    """RAG service using ChromaDB for memory retrieval."""
    
    def __init__(self):
        self._lock = threading.RLock()
    
    def _get_user_collection(self, user_id):
        """Get or create a ChromaDB collection for a user."""
        collection_name = f'memories_{user_id}'.replace('-', '_').replace(' ', '_')
        return client.get_or_create_collection(
            name=collection_name,
            metadata={'user_id': user_id, 'type': 'user_memories'}
        )
    
    def retrieve_context(self, payload):
        """
        Retrieve memory context for RAG augmentation.
        
        Returns formatted context string for use in LLM prompt.
        """
        if not isinstance(payload, dict):
            raise ValueError('Payload must be a JSON object.')
        
        user_id = str(payload.get('userId', '')).strip()
        if not user_id:
            raise ValueError('userId is required.')
        
        query = payload.get('query', '')
        query = query if isinstance(query, str) else str(query or '')
        limit = payload.get('limit', 5)
        
        try:
            limit = int(limit)
            limit = max(1, min(limit, 20))
        except (ValueError, TypeError):
            limit = 5
        
        try:
            collection = self._get_user_collection(user_id)
            
            # If no query, return recent memories
            if not query.strip():
                results = collection.get(
                    limit=limit,
                    include=['documents', 'metadatas']
                )
                
                if not results or not results['ids']:
                    return {
                        'context': '',
                        'retrievedCount': 0,
                        'method': 'recent',
                    }
                
                # Format recent memories
                context_lines = ['Recent memories:']
                for i, doc in enumerate(results['documents'], 1):
                    author = results['metadatas'][i-1].get('author', 'unknown')
                    context_lines.append(f"{i}. [{author}]: {doc}")
                
                return {
                    'context': '\n'.join(context_lines),
                    'retrievedCount': len(results['ids']),
                    'method': 'recent',
                }
            
            # Vector similarity search
            results = collection.query(
                query_texts=[query],
                n_results=limit,
                include=['documents', 'metadatas']
            )
            
            if not results or not results['ids'] or not results['ids'][0]:
                return {
                    'context': '',
                    'retrievedCount': 0,
                    'method': 'semantic',
                }
            
            # Format semantic search results
            context_lines = ['Relevant memories:']
            for i, doc in enumerate(results['documents'][0], 1):
                author = results['metadatas'][0][i-1].get('author', 'unknown')
                context_lines.append(f"{i}. [{author}]: {doc}")
            
            return {
                'context': '\n'.join(context_lines),
                'retrievedCount': len(results['ids'][0]),
                'method': 'semantic',
            }
            
        except Exception as e:
            log(f'Error retrieving context for user {user_id}: {e}')
            return {
                'context': '',
                'retrievedCount': 0,
                'error': str(e),
                'method': 'semantic',
            }


class RAGHttpServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, request_handler_class, rag_db):
        super().__init__(server_address, request_handler_class)
        self.rag_db = rag_db


class RAGRequestHandler(BaseHTTPRequestHandler):
    server_version = 'ChatbotRAGService/1.0'

    def _send_json(self, status_code, payload):
        rendered = json.dumps(payload, ensure_ascii=False).encode('utf8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
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
            if parsed.path == '/health':
                self._send_json(HTTPStatus.OK, {
                    'ok': True,
                    'service': SERVICE_NAME,
                    'chromaPath': CHROMA_DB_PATH,
                    'pid': os.getpid(),
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

    def do_POST(self):
        parsed = urlparse(self.path)

        try:
            if parsed.path == '/rag/retrieve':
                payload = self._read_json_body()
                result = self.server.rag_db.retrieve_context(payload)
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
        except Exception as error:
            self._handle_exception(error)

    def log_message(self, format_string, *args):
        return


def main():
    host = os.environ.get('RAG_SERVICE_HOST', '127.0.0.1').strip() or '127.0.0.1'
    port = parse_int_env('RAG_SERVICE_PORT', 8764)

    rag_db = RAGDatabase()
    server = RAGHttpServer((host, port), RAGRequestHandler, rag_db)
    
    log(f'{SERVICE_NAME} listening on http://{host}:{port}')
    log(f'ChromaDB path: {CHROMA_DB_PATH}')
    log('RAG retrieval endpoint: /rag/retrieve')

    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log('Service stopped.')


if __name__ == '__main__':
    main()
