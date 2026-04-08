# Vector Memory System - Quick Start

## What Changed?

Lumi's memory went from **keyword search** to **semantic similarity search** using vectors.

### Before
```
Query: "brain"
Results: Only memories with word "brain"
```

### Now (Semantic)
```
Query: "What about brain stuff?"
Results: Memories about: lobotomy, intelligence, consciousness, etc.
         (even if they don't use the word "brain"!)
```

## Installation Status: ✅ COMPLETE

✅ ChromaDB installed  
✅ sentence-transformers installed  
✅ All 429 memories migrated  
✅ Vector embeddings generated  
✅ Tests passing  

**No action needed!** The system is ready to use.

## How to Use

### Start the Bot Normally
```bash
npm start
```

The vector memory service starts automatically. That's it!

### Manual Testing
```bash
# Test the service independently
CHATBOT_MEMORY_SERVICE_PORT=8766 python python/chatbot_memory_service_vector.py

# Run verification
python python/verify_migration.py
```

## Technical Details

| Component | Details |
|-----------|---------|
| **Database** | ChromaDB (Parquet format) |
| **Storage** | `data/chroma-db/` |
| **Embedding Model** | all-MiniLM-L6-v2 (384-dim) |
| **Memories Migrated** | 429 total, 10 users |
| **Search Time** | <500ms per query |
| **First Startup** | ~30-40s (downloads model) |
| **Subsequent Startup** | <5s (cached) |

## Example: How Semantic Search Works

**User memory**: "i love coding Python"  
**Query 1**: "programming" → ✅ Match! (similar meaning to coding)  
**Query 2**: "snake" → ❌ No match (different meaning despite word overlap)  
**Query 3**: "what languages?" → ✅ Match! (semantic relation to Python)

## Performance

- **Per-user collection**: Independent vector search
- **Ranking**: 80% semantic similarity + 20% recency  
- **Limit**: Up to 50 results per search

## File Reference

| File | Purpose |
|------|---------|
| `python/chatbot_memory_service_vector.py` | Main service |
| `data/chroma-db/` | Stored vectors + metadata |
| `data/chatbot-memory.sqlite3` | Channel state/history (unchanged) |
| `data/memories-backup.json` | Backup of all memories |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| First startup slow | Model downloads (~90MB). Subsequent runs cached. |
| "No matches" on search | Query needs 2+ words. Try more descriptive query. |
| Port 8765 in use | Change: `CHATBOT_MEMORY_SERVICE_PORT=8766` |
| Service won't start | Check Python venv: `source .venv/bin/activate` (Linux/Mac) or `.venv\Scripts\Activate.ps1` (Windows) |

## Migration Notes

- **All 429 memories preserved** ✅
- **No memories lost** ✅
- **Backup created** (`memories-backup.json`) ✅
- **User isolation maintained** ✅
- **Metadata intact** ✅

## Next Time You...

**Start the bot**: Service auto-spawns, using vector search  
**Query memory**: Semantic similarity used (not just keywords)  
**Add memories**: Automatically embedded and stored in ChromaDB  
**Reset memories**: Old backup created, fresh database initialized  

---

**Questions?** See `VECTOR_MEMORY_README.md` for full documentation.

---

✨ Lumi's memories are now **semantic and smart!** ✨
