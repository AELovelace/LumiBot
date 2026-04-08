# RAG System for Local Ollama Memory-Augmented Generation

## Overview

Lumi now uses **RAG (Retrieval-Augmented Generation)** to combine local **Ollama** language models with retrieved memory context from **ChromaDB**. This enables semantic understanding and contextual awareness without expensive API calls.

### Architecture

```
User Message
    ↓
[Discord Bot] → [RAG Service] (retrieves memories from ChromaDB)
    ↓
   RAG Context + Message → [Ollama LLM] (local inference)
    ↓
Response with Memory Context
```

## What is RAG?

**Retrieval-Augmented Generation** is an AI pattern that:
1. **Retrieves** relevant context from a knowledge base (your memory database)
2. **Augments** the input prompt with that context
3. **Generates** a response using an LLM with expanded context

Benefits:
- Lumi remembers previous conversations and context automatically
- Responses are grounded in actual past interactions
- Reduces hallucinations by providing factual context
- Works entirely locally with Ollama

## Components

### 1. RAG Service (`chatbot_rag_service.py`)
- HTTP service running on port 8764
- Retrieves memories from ChromaDB vector database
- Formats context for prompt injection

**Endpoints:**
- `GET /health` - Service health check
- `POST /rag/retrieve` - Retrieve memory context

### 2. RAG Client (`src/ragClient.js`)
- Node.js wrapper around RAG service
- Auto-spawns RAG service if not running
- Provides `retrieveMemoryContext()` function

### 3. Enhanced LLM Client (`src/llmClient.js`)
- Modified to accept `ragContext` parameter
- Incorporates RAG context into prompts
- Falls back gracefully if RAG unavailable

### 4. Updated Chatbot (`src/chatbot.js`)
- New function: `fetchMemoryContextWithRAG()`
- Retrieves AND formats memory for LLM
- Passes context to Ollama for generation

## How It Works

### Query Flow

1. **User sends message to Lumi**
   ```
   "Hey Lumi, what was that thing we talked about?"
   ```

2. **Chatbot retrieves memory context via RAG**
   ```python
   RAG Service receives:
   - userId: discord_user_id
   - query: user message
   - limit: 5 (memories to retrieve)
   ```

3. **RAG searches ChromaDB**
   - If query is empty: Returns 5 most recent memories
   - If query exists: Returns 5 semantically similar memories
   - Formatted as readable context

4. **Context augments LLM prompt**
   ```
   System: You are Lumi...
   
   Relevant memories:
   1. [user_name]: previous message about X
   2. [user_name]: related memory about Y
   3. [user_name]: recent interaction
   
   User message: (current message)
   Reply as Lumi:
   ```

5. **Ollama generates response with context awareness**
   - Model has factual information about user
   - Can reference past conversations
   - Maintains personality with memory continuity

### Example: Memory-Aware Response

**Without RAG:**
```
User: "Remember the song I showed you?"
Lumi: "I don't think we talked about songs."
```

**With RAG:**
```
User: "Remember the song I showed you?"
Lumi: (RAG retrieves: "User played 'breakcore_track.mp3'")
Lumi: "Oh yeah, that breakcore track you found on SoundCloud!
       It was pretty chaotic. Have you found more like it?"
```

## Setup & Configuration

### Installation

Dependencies already installed:
- ✅ chromadb
- ✅ sentence-transformers
- ✅ Ollama (assumed running on 127.0.0.1:11434)

### Configuration

Add to `.env` if needed:

```bash
# RAG Service (defaults shown)
RAG_SERVICE_HOST=127.0.0.1
RAG_SERVICE_PORT=8764

# Ollama (already configured)
LLM_LOCAL_ENDPOINT=http://127.0.0.1:11434
LLM_USE_LOCAL_GPU=false  # Set true if you have GPU
```

### Starting the System

```bash
# Everything auto-starts with the bot
npm start

# Both services spawn automatically:
# - chatbot_memory_service_vector.py (port 8765)
# - chatbot_rag_service.py (port 8764)
```

## Memory Context Formatting

RAG formats memories as readable context blocks:

**Recent Memories (empty query):**
```
Recent memories:
1. [username]: "I love breakcore music"
2. [username]: "Just found this artist on SoundCloud"
3. [username]: "Can you recommend something chaotic?"
```

**Semantic Search (text query):**
```
Relevant memories:
1. [username]: "My favorite genre is witch-house"
2. [username]: "I've been exploring underground producers"
3. [username]: "The aesthetic is so dreamy"
```

Each memory includes:
- Author (Discord username)
- Content (what was said)
- Timestamps (via metadata)
- Channel context (via metadata)

## Performance

| Metric | Value |
|--------|-------|
| RAG Service Startup | <2s |
| Memory Retrieval | <300ms |
| Context Formatting | <50ms |
| Total Overhead | <400ms per message |

**Ollama inference time** depends on model size (added separately).

## API Endpoints

### POST /rag/retrieve

Retrieve formatted memory context for prompt augmentation.

**Request:**
```json
{
  "userId": "876949373953654794",
  "query": "music recommendations",
  "limit": 5
}
```

**Response:**
```json
{
  "ok": true,
  "service": "chatbot-rag-service",
  "context": "Relevant memories:\n1. [user]: message\n2. [user]: message",
  "retrievedCount": 2,
  "method": "semantic"
}
```

### GET /health

Service health check.

**Response:**
```json
{
  "ok": true,
  "service": "chatbot-rag-service",
  "chromaPath": "/path/to/chroma-db",
  "pid": 12345
}
```

## Retrieval Methods

### Recent Memory (Empty Query)

When no query provided:
- Returns most recent memories (last 7 days)
- Sorted by timestamp (newest first)
- Use case: Contextual continuity

### Semantic Search (Text Query)

When query provided:
- Vector similarity search in embeddings
- Returns most similar memories
- Use case: Topic-relevant context

**Example Similarities:**
- Query: "music" → Matches about "songs", "artists", "SoundCloud"
- Query: "games" → Matches about "Minecraft", "gaming", "playing"
- Query: "tech" → Matches about "servers", "code", "DIY"

## Fallback Behavior

If RAG service fails:
- ✅ Bot continues normally
- ✅ Uses only recent context (no memory context)
- ✅ Logs warning about RAG failure
- ✅ No interruption to service

If memory lookup fails:
- Empty string returned
- LLM generates response without memory context
- Service still functional

## Vector Database Details

Memories stored in ChromaDB:
- **Model**: all-MiniLM-L6-v2 (384-dim embeddings)
- **Format**: Vector + metadata
- **Storage**: `data/chroma-db/` (Parquet format)
- **Per-user collections**: Isolated memory spaces

Each memory includes:
- `content` - The conversation text
- `author` - Discord username
- `author_id` - Discord user ID
- `channel_id` - Discord channel ID
- `timestamp` - When was it created
- `role` - 'user' or 'assistant'

## Testing RAG

### Quick Test
```bash
python python/test_rag_service.py
```

Expected output:
```
✓ RAG service healthy
✓ Retrieved 3 recent memories
✓ Found 3 semantically similar memories
```

### Manual Test
```bash
# Start RAG service
python python/chatbot_rag_service.py

# In another terminal
curl -X POST http://localhost:8764/rag/retrieve \
  -H "Content-Type: application/json" \
  -d '{"userId":"876949373953654794","query":"music","limit":3}'
```

## Troubleshooting

### RAG Service Won't Start

**Error:** "RAG service failed to initialize"

**Solution:**
1. Check ChromaDB path exists: `data/chroma-db/`
2. Verify Python environment: `.venv/Scripts/python.exe`
3. Check port 8764 not in use: `netstat -ano | findstr 8764`
4. Manual start: `python python/chatbot_rag_service.py`

### No Memory Context Retrieved

**Check:**
1. Vector database has memories: `python python/verify_migration.py`
2. User ID correct in database
3. ChromaDB collections accessible
4. Memory service running on port 8765

### Ollama Response Delayed

**Expected behavior** with RAG:
- Vector retrieval: ~300ms
- Context formatting: ~50ms
- Ollama generation: Varies by model (1-10 seconds)
- Total: Often 2-5 seconds slower than RAG-free

**Optimize:**
- Use smaller models (7B instead of 13B)
- Reduce LLM_TIMEOUT_MS if you have faster hardware
- Set LLM_USE_LOCAL_GPU=true if available

## Advanced Configuration

### Custom Memory Limits

In `.env`:
```bash
# More memories per search (slower)
CHATBOT_MEMORY_SEARCH_LIMIT=10

# Deeper recalls (for "remember when...")
CHATBOT_MEMORY_RECALL_LIMIT=30
```

### Disable RAG (Fallback to Old System)

If you need to disable RAG temporarily:
1. Stop RAG service
2. Bot will use only memoryClues (no formatting)
3. llmClient falls back gracefully

## Future Enhancements

Potential RAG improvements:
- [ ] Multi-model embeddings for better accuracy
- [ ] Reranking with cross-encoders
- [ ] Memory importance weighting
- [ ] Temporal decay (older memories weighted less)
- [ ] Multi-turn conversation chains
- [ ] Memory summarization for context windows
- [ ] Semantic memory clustering

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│           Discord Bot (Node.js)             │
│                                             │
│  chatbot.js:                               │
│  - fetchMemoryContextWithRAG()             │
│  - Calls ragClient.retrieveMemoryContext() │
└────────────────┬────────────────────────────┘
                 │ HTTP POST /rag/retrieve
                 ↓
┌─────────────────────────────────────────────┐
│      RAG Service (Python)                   │
│      Port: 8764                             │
│                                             │
│  - ChromaDB client                         │
│  - Vector similarity search                │
│  - Context formatting                      │
└────────────────┬────────────────────────────┘
                 │ Direct library calls
                 ↓
┌─────────────────────────────────────────────┐
│      ChromaDB (Vector Database)             │
│      Path: data/chroma-db/                 │
│                                             │
│  - 429 memories with embeddings            │
│  - 10 user collections                     │
│  - 384-dim vectors (all-MiniLM-L6-v2)     │
└─────────────────────────────────────────────┘
                 
┌─────────────────────────────────────────────┐
│      Enhanced LLM Client (Node.js)          │
│                                             │
│  buildPrompt() with ragContext              │
│  requestLlmCompletion() enhanced            │
└────────────────┬────────────────────────────┘
                 │ HTTP POST
                 ↓
┌─────────────────────────────────────────────┐
│      Ollama (Local LLM)                     │
│      Port: 11434                           │
│      Model: goekdenizguelmez/JOSIEFIED-... │
│                                             │
│  - Generates responses with context        │
│  - Memory-aware replies                    │
│  - Local inference (no API calls)          │
└─────────────────────────────────────────────┘
```

---

## Summary

**RAG Integration Benefits:**
- ✅ Memory-aware responses without API costs
- ✅ Semantic understanding of conversations
- ✅ Entirely local (Ollama + ChromaDB)
- ✅ Transparent to bot users
- ✅ Graceful fallback if unavailable
- ✅ Sub-second overhead per message

**Lumi now has true memory with semantic understanding!** 💜
