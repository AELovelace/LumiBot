#!/usr/bin/env python3
"""
Migration script to convert SQLite memories to ChromaDB vector database.
This script preserves all existing memories while enabling semantic search.
"""

import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
except ImportError:
    print('Error: chromadb and sentence-transformers are required.')
    print('Install with: pip install chromadb sentence-transformers')
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
SQLITE_DB_PATH = os.path.join(PARENT_DIR, 'data', 'chatbot-memory.sqlite3')
CHROMA_DB_PATH = os.path.join(PARENT_DIR, 'data', 'chroma-db')
JSON_BACKUP_PATH = os.path.join(PARENT_DIR, 'data', 'memories-backup.json')

# Initialize ChromaDB
client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

# Initialize embedding model
print('Loading embedding model (this may take a moment on first run)...')
model = SentenceTransformer('all-MiniLM-L6-v2')
print('Embedding model loaded.')


def log(message):
    timestamp = datetime.now().isoformat()
    print(f'[{timestamp}] {message}')


def extract_memories_from_sqlite():
    """Extract all memories from SQLite database."""
    if not os.path.exists(SQLITE_DB_PATH):
        log(f'SQLite database not found at {SQLITE_DB_PATH}')
        return {}

    memories = {}
    
    try:
        conn = sqlite3.connect(SQLITE_DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Get list of user memory tables
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'user_memory_u_%'"
        )
        tables = cursor.fetchall()
        
        log(f'Found {len(tables)} user memory tables in SQLite')
        
        for table_row in tables:
            table_name = table_row[0]
            # Extract user_id from table name (format: user_memory_u_<user_id>_<hash>)
            parts = table_name.split('_')
            if len(parts) >= 3 and parts[0] == 'user' and parts[1] == 'memory' and parts[2] == 'u':
                user_id = parts[3]  # The numeric Discord user ID
            else:
                user_id = table_name.replace('user_memory_', '')
            
            cursor.execute(f'SELECT * FROM "{table_name}" ORDER BY rowid')
            rows = cursor.fetchall()
            
            # Get column names
            columns = [description[0] for description in cursor.description]
            
            memories[user_id] = []
            for row in rows:
                content = row['content'] if 'content' in columns else ''
                if content.strip():  # Only include rows with non-empty content
                    memories[user_id].append({
                        'channel_id': row['channel_id'] if 'channel_id' in columns else 'unknown',
                        'role': row['role'] if 'role' in columns else 'user',
                        'author_id': row['author_id'] if 'author_id' in columns else user_id,
                        'author': row['author'] if 'author' in columns else 'unknown',
                        'content': content,
                        'timestamp': row['timestamp'] if 'timestamp' in columns else int(time.time() * 1000),
                    })
            
            log(f'Extracted {len(memories[user_id])} memories for user {user_id}')

        conn.close()
        return memories

    except Exception as e:
        log(f'Error reading SQLite database: {e}')
        import traceback
        traceback.print_exc()
        return {}


def migrate_memories_to_chroma(memories):
    """Migrate memories to ChromaDB with vector embeddings."""
    if not memories:
        log('No memories to migrate.')
        return 0

    total_migrated = 0

    for user_id, user_memories in memories.items():
        if not user_memories:
            continue

        log(f'Migrating {len(user_memories)} memories for user {user_id}...')
        
        # Create a collection for this user
        collection_name = f'memories_{user_id}'.replace('-', '_')
        
        # Delete existing collection if it exists
        try:
            client.delete_collection(name=collection_name)
            log(f'Removed existing collection {collection_name}')
        except:
            pass  # Collection may not exist on first run
        
        collection = client.get_or_create_collection(
            name=collection_name,
            metadata={'user_id': user_id, 'description': f'Memories for user {user_id}'}
        )

        # Prepare batch data
        ids = []
        documents = []
        metadatas = []
        
        for idx, memory in enumerate(user_memories):
            # Create unique ID
            memory_id = f'{user_id}_{idx}_{int(memory["timestamp"])}'
            ids.append(memory_id)
            documents.append(memory['content'])
            metadatas.append({
                'user_id': user_id,
                'channel_id': memory['channel_id'],
                'role': memory['role'],
                'author_id': memory['author_id'],
                'author': memory['author'],
                'timestamp': str(memory['timestamp']),
            })

        # Add to ChromaDB (embeddings are generated automatically)
        try:
            collection.add(
                ids=ids,
                documents=documents,
                metadatas=metadatas
            )
            total_migrated += len(user_memories)
            log(f'Successfully migrated {len(user_memories)} memories to chromadb collection {collection_name}')
        except Exception as e:
            log(f'Error migrating memories for user {user_id}: {e}')

    return total_migrated


def backup_memories_as_json(memories):
    """Create a JSON backup of all memories."""
    try:
        with open(JSON_BACKUP_PATH, 'w', encoding='utf-8') as f:
            json.dump(memories, f, indent=2, ensure_ascii=False, default=str)
        log(f'Created backup of memories at {JSON_BACKUP_PATH}')
    except Exception as e:
        log(f'Warning: Could not create JSON backup: {e}')


def main():
    log('Starting migration from SQLite to ChromaDB...')
    
    # Extract memories
    memories = extract_memories_from_sqlite()
    
    if not memories:
        log('No memories found to migrate.')
        return
    
    total_memories = sum(len(m) for m in memories.values())
    log(f'Found {total_memories} total memories across {len(memories)} users')
    
    # Backup as JSON
    backup_memories_as_json(memories)
    
    # Migrate to ChromaDB
    migrated = migrate_memories_to_chroma(memories)
    
    log(f'Migration complete! Migrated {migrated} memories to ChromaDB.')
    log(f'Vector database stored at: {CHROMA_DB_PATH}')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log(f'Fatal error: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
