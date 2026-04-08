# Vector Memory System for Lumi Discord Bot

## Overview

The bot now uses **ChromaDB** with **sentence-transformers** embeddings for semantic memory retrieval. Instead of keyword-based matching, Lumi can now find memories based on **semantic similarity**, enabling more natural and contextual recall of conversations.

### What Changed

- **Old System**: SQLite-based keyword/token matching for memory search
- **New System**: ChromaDB vector database with semantic similarity search using `all-MiniLM-L6-v2` embeddings

### Key Benefits

1. **Semantic Understanding**: Memories are recalled based on meaning, not just keywords
   - Query: "What did we talk about brain stuff?" matches memories about "lobotomy" despite different words

2. **Better Context Recovery**: Similar concepts cluster together in vector space
   - Related topics are found even if wording differs

3. **User Memory Isolation**: Each user has their own vector collection stored in ChromaDB
   - Lumi maintains separate memory spaces per user

4. **Backward Compatible**: Existing memories are automatically migrated with embeddings preserved

## Migration & Setup

### 1. Dependencies Installed

```bash
pip install chromadb sentence-transformers
```

These were installed in the Python virtual environment.

### 2. Migration Script Executed

```bash
python python/migrate_to_vector_db.py
```

**Results:**
- ✓ Extracted 429 memories across 10 Discord users
- ✓ Generated vector embeddings for all memories using `all-MiniLM-L6-v2`
- ✓ Stored in ChromaDB at `data/chroma-db/`
- ✓ Created JSON backup at `data/memories-backup.json`

### 3. New Memory Service

The new vector memory service runs as `chatbot_memory_service_vector.py`:

```bash
python python/chatbot_memory_service_vector.py
```

**Updated Configuration in chatbotStateStore.js:**
- Service name: `chatbot-memory-vector`
- Script path: `python/chatbot_memory_service_vector.py`

## Architecture

### File Structure

```
data/
  chatbot-memory.sqlite3          # State/history only (channel data)
  chroma-db/                      # Vector database (user memories)
    collections.parquet
    databases.parquet
    ...

python/
  chatbot_memory_service_vector.py # New vector-enabled service
  migrate_to_vector_db.py          # Migration script
  test_vector_search.py            # Test suite
```

### Data Flow

1. **Memory Storage** (`/memory/log`):
   - Entry is added to ChromaDB
   - Embedding generated automatically by ChromaDB (using sentence-transformers)
   - Metadata stored (user_id, channel_id, author, etc.)

2. **Memory Search** (`/memory/search`):
   - Query text is embedded using same model
   - Vector similarity search finds top-k matches
   - Results ranked by: 80% semantic similarity + 20% recency

3. **State Management** (`/state`):
   - Channel history and settings remain in SQLite
   - Synced periodically like before

### API Endpoints

All endpoints remain backward compatible:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (shows backend: chromadb) |
| `/memory/users` | GET | List users with memory counts |
| `/memory/user/{userId}` | GET | Load all memories for a user |
| `/memory/search` | POST | Search memories with vector similarity |
| `/memory/log` | POST | Add new memory entry |
| `/memory/reset` | POST | Reset all memories (creates backup) |
| `/state` | GET/PUT | Load/save channel state |

### Similarity Scoring

Results are scored based on:

$$\text{score} = 0.8 \times \text{(semantic similarity)} + 0.2 \times \text{(recency)}$$

Where:
- **Semantic similarity**: Cosine distance between query and memory embeddings (0-1)
- **Recency**: Document freshness over 30 days (0-1, where 1 = just now)

This balances finding semantically relevant memories while slightly preferring recent ones.

## Testing

### Quick Test

```bash
python python/test_vector_search.py
```

Output shows:
- Health check ✓
- User memory inventory ✓
- Vector similarity search with scores ✓

### Example Search

```
Query: "What did we talk about brain stuff?"

Results:
- Score: 0.8629 - "a lobotomy... separate your left and right brain :3"
- Score: 0.5624 - "lobotomy? heard that one before. left brain handles the math..."
- Score: 0.3540 - [other related memories]
```

## Memory Embedding Model

**Model**: `sentence-transformers/all-MiniLM-L6-v2`

- Dimensions: 384
- Size: ~90MB
- Training: Released 2022, trained on semantic similarity datasets
- Performance: Balanced between speed and quality
- First load: Downloads model from Hugging Face (~90MB)
- Subsequent loads: Cached in `/home/.cache/huggingface/hub/`

## Configuration

### Environment Variables

Same as before, but now uses ChromaDB:

```bash
CHATBOT_MEMORY_SERVICE_HOST=127.0.0.1
CHATBOT_MEMORY_SERVICE_PORT=8765
CHATBOT_MEMORY_DB_FILE=data/chatbot-memory.sqlite3  # For state only
CHATBOT_MEMORY_SEARCH_LIMIT=6    # Results per search
CHATBOT_MEMORY_RECALL_LIMIT=20   # Results for deep recall
CHATBOT_MEMORY_FLUSH_MS=5000     # State write interval
```

## Performance Notes

### Startup Time
- First run: ~30-40s (downloads & caches embedding model)
- Subsequent runs: <5s (model cached)

### Search Performance
- Per-user collection: <500ms for semantic search
- Supports queries up to 50 character limit
- Deep recalls search all users (larger latency)

### Vector Database
- Stored in plain Parquet format (portable)
- Auto-indexed by ChromaDB
- No additional dependencies needed to persist/restore

## Maintenance

### Backup Existing Memories

Automatic backups created when:
- Migration runs: `data/memories-backup.json`
- Records reset: `data/chroma-db_backup_YYYYMMDD_HHMMSS/`

### Restore from Backup

To restore from JSON backup (if needed):

```bash
# Stop the service
# Delete data/chroma-db/
# Re-run migration (it looks for SQLite):
python python/migrate_to_vector_db.py
# Or manually restore from memories-backup.json
```

### Clearing All Memories

```bash
curl -X POST http://localhost:8765/memory/reset
```

This creates a backup before clearing.

## Troubleshooting

### "No matches found" on deepfetch

- Vector search only matches within user's memories by default
- Empty query returns recent memories (by recency score)
- Short/common queries may have lower similarity scores

### Slow startup

- First startup downloads 90MB embedding model
- Check internet connection if stuck
- Model caches in `~/.cache/huggingface/hub/`

### Port already in use

```bash
# Check what's using port 8765
netstat -ano | findstr "8765"
# Kill it: taskkill /PID [PID] /F
# Or change port: CHATBOT_MEMORY_SERVICE_PORT=8766
```

## Future Enhancements

Potential improvements:
- [ ] Reranking results with cross-encoder for better accuracy
- [ ] Hybrid search (combine vector + keyword matching)
- [ ] Memory summarization for long contexts
- [ ] Temporal memory decay (older memories weighted down)
- [ ] Multi-turn memory context (conversation chains)
- [ ] Memory importance scoring by Lumi
