# SadGirlPlayer — Architecture

> Internal reference for the AI chatbot pipeline, memory systems, and supporting infrastructure.

---

## High-Level System Overview

```mermaid
graph TB
    subgraph Discord["Discord Gateway"]
        DM["Incoming Message"]
        DR["Outgoing Reply"]
    end

    subgraph Bot["Node.js Bot Process"]
        IDX["index.js — bootstrap"]
        CMD["commands.js"]
        CB["chatbot.js — decision engine"]
        LLM["llmClient.js — prompt & normalize"]
        MOD["moderation.js"]
        CP["controlPlane.js — slash admin"]
        TR["thoughtRelay.js"]
        GC["giphyClient.js"]
        BS["braveSearch.js"]
        RC["ragClient.js"]
        CSS["chatbotStateStore.js"]
        NP["nowPlaying.js"]
        SB["starboard.js"]
    end

    subgraph Python["Python Services (localhost)"]
        MEM["chatbot_memory_service_vector.py\n:8765 — SQLite + ChromaDB"]
        RAG["chatbot_rag_service.py\n:8764 — RAG retrieval"]
    end

    subgraph LLMInfra["Ollama LLM Backends"]
        EP1["Endpoint 1\n(remote/local)"]
        EP2["Endpoint 2\n(failover)"]
    end

    subgraph External["External APIs"]
        GIPHY["Giphy API"]
        BRAVE["Brave Search API"]
    end

    DM --> IDX --> CMD
    CMD --> CB
    CB --> MOD
    CB --> LLM
    CB --> BS
    CB --> NP
    LLM --> EP1
    LLM --> EP2
    LLM --> TR
    CB --> RC --> RAG
    CB --> CSS --> MEM
    CB --> GC --> GIPHY
    BS --> BRAVE
    CB --> DR
    IDX --> CP
    IDX --> SB
```

---

## AI Message Lifecycle

The full journey of a single Discord message through the AI pipeline:

```mermaid
flowchart TD
    A["Discord message arrives"] --> B{"Channel whitelisted?"}
    B -- No --> Z1["Ignore"]
    B -- Yes --> C{"Input moderation"}
    C -- "blocked (empty / too long / blocklist / invite link)" --> Z2["Drop silently"]
    C -- allowed --> D["Push to channel history\n+ persist user memory entry"]

    D --> E{"shouldAttemptReply()"}
    E -- No --> Z3["Log skip reason"]
    E -- Yes --> F["sendTyping()"]

    F --> G{"Detect intent"}
    G -- "Song rec intent" --> SR["Now-playing recommendation\nvia nowPlaying.js"]
    G -- "GIF intent" --> GI["Direct GIF via Giphy"]
    G -- "Web search intent" --> WS["Brave Search flow"]
    G -- "Normal chat" --> NC["Standard LLM flow"]

    SR --> MOD_OUT
    GI --> MOD_OUT
    WS --> NC
    NC --> H["Gather context\n(parallel)"]

    H --> H1["fetchMemoryCluesForPrompt()\nvia chatbotStateStore → ChromaDB"]
    H --> H2["fetchMemoryContextWithRAG()\nvia ragClient → RAG service"]
    H --> H3["fetchUserContextProfileForPrompt()\nvia chatbotStateStore"]

    H1 & H2 & H3 --> I["requestLlmCompletion()"]
    I --> J["buildPrompt()"]
    J --> K["POST /api/generate\n→ Ollama endpoint"]
    K --> L["Raw model completion"]

    L --> M["Response normalization\npipeline"]
    M --> MOD_OUT{"Output moderation"}

    MOD_OUT -- blocked --> Z4["Log & discard"]
    MOD_OUT -- allowed --> N{"maybeAppendGif()"}
    N -- "chance gate passes" --> O["requestGifSuggestion()\n→ LLM returns JSON\n→ fetchGiphyGifUrl()"]
    N -- "skip" --> P
    O --> P["splitMessage()\n→ message.reply()"]

    P --> Q["Update channel state\n+ persist assistant memory"]
```

---

## Reply Decision Engine

How `shouldAttemptReply()` decides whether Lumi speaks:

```mermaid
flowchart TD
    START["Incoming message"] --> COOL{"In cooldown?\n(cooldownMs or followupCooldownMs)"}
    COOL -- Yes --> SKIP["Skip — cooldown"]
    COOL -- No --> DIRECT{"Directly @mentioned\nor replied-to?"}

    DIRECT -- Yes --> REPLY["Reply ✓ — reason: direct"]
    DIRECT -- No --> INTEREST["computeInterestScore()"]

    INTEREST --> IS["Score from:\n• has ? (+2)\n• question word (+2)\n• Lumi/opinion/help (+2)\n• personal statement (+1)\n• exclamation (+1)\n• length ≥ 12 (+1)"]

    IS --> CONV["+ computeConversationScore()\nfrom recent history window"]

    CONV --> MOM["+ computeMomentum()\nboost & threshold relief"]

    MOM --> EFF{"Effective interest\n≥ adjusted threshold?"}
    EFF -- Yes --> REPLY2["Reply ✓ — reason: interest"]
    EFF -- No --> RAND{"Random roll\n< effectiveReplyChance?"}
    RAND -- Yes --> REPLY3["Reply ✓ — reason: random"]
    RAND -- No --> NOPE["Skip — no trigger"]
```

---

## Prompt Assembly

How `buildPrompt()` constructs the final prompt string sent to Ollama:

```mermaid
flowchart TD
    A["buildPrompt()"] --> S1["System: persona\n(hot-reloaded from .env)"]
    S1 --> S2["System: conciseness rules\n+ anti-repetition\n+ anti-roleplay\n+ no fabricated links"]

    S2 --> UP{"User context\nprofile available?"}
    UP -- Yes --> S3["System: soft user profile\n(known facts, preferences,\nongoing topics, style hints)"]
    UP -- No --> RAG_CHECK

    S3 --> RAG_CHECK{"RAG context\navailable?"}
    RAG_CHECK -- Yes --> S4["System: memory context\n(formatted by RAG service)"]
    RAG_CHECK -- No --> MC{"Memory clues\navailable?"}
    MC -- Yes --> S5["System: use clues cautiously"]
    MC -- No --> S6["(skip memory section)"]

    S4 --> REC
    S5 --> REC
    S6 --> REC

    REC["System: recall vs context-first\n(deepRecall flag)"]
    REC --> HIST["Recent chat context:\nrendered history window"]
    HIST --> CLUE["Long-term memory clues:\nnumbered list or 'none'"]
    CLUE --> SEARCH{"Search results\navailable?"}
    SEARCH -- Yes --> SR["Web search results block\n+ citation instruction"]
    SEARCH -- No --> UM
    SR --> UM["User message: <content>"]
    UM --> REPLY["Reply as Lumi:"]
```

---

## Response Normalization Pipeline

The multi-stage sanitization chain inside `normalizeResponse()`:

```mermaid
flowchart TD
    RAW["Raw model output"] --> LEAK{"Reasoning leak\ndetected?\n(≥2 planning phrases)"}

    LEAK -- Yes --> QUOTE["Extract last quoted\ncandidate reply"]
    LEAK -- No --> STRIP

    QUOTE --> THOUGHT_RELAY["Route planning text\n→ thoughtRelay.js\n→ thoughts channel"]
    QUOTE --> STRIP

    STRIP["stripThinkingTags()\nremove <think>…</think>\nor recover from unclosed tags"]
    STRIP --> BAN["stripBannedReplyPhrases()\n'you know who you are' etc."]
    BAN --> REASON["stripReasoningArtifactPrefixes()\n'Final draft:', 'CoT:' etc."]
    REASON --> STAGE["stripStageDirections()\n*pauses*, (whispers), etc."]
    STAGE --> ECHO["stripPromptEchoAndTranscriptArtifacts()\ncut at 'User message:' etc.\nremove speaker-label lines"]

    ECHO --> DIV["diversifyAgainstRecentAssistantHistory()\nprune repeated edge sentences\nvs last 4 assistant messages"]

    DIV --> DELIN["applySpeakerDelineators()\nstrip 'Lumi:' labels"]
    DELIN --> CENSOR["censorLeadingSelfName()\n'Lumi…' → 'l***…'"]
    CENSOR --> COMPACT["compactWhitespacePreserveNewlines()"]

    COMPACT --> DELOOP["collapseRepeatedPhraseLoops()\ncollapse 5+ repeated phrases"]
    DELOOP --> DEGEN{"isDegenerateRepetitiveOutput()?\n(unique token ratio < 0.22\nor ≥ 6 consecutive repeats)"}

    DEGEN -- Yes --> EMPTY["Return '' → triggers\nfallback or retry"]
    DEGEN -- No --> CLAMP["clampToSentenceLimit()\n(max 10 sentences)"]
    CLAMP --> MAXCHAR["Truncate to maxResponseChars"]
    MAXCHAR --> OUT["Cleaned reply text"]
```

---

## Memory & RAG Architecture

```mermaid
graph LR
    subgraph NodeJS["Node.js Process"]
        CSS["chatbotStateStore.js"]
        RC["ragClient.js"]
        CB["chatbot.js"]
    end

    subgraph VectorService["Memory Service :8765"]
        direction TB
        HTTP1["HTTP API"]
        SQLITE["SQLite\n(state + user memory rows)"]
        CHROMA["ChromaDB\n(vector embeddings)"]
        EMB["sentence-transformers\nall-MiniLM-L6-v2"]

        HTTP1 --> SQLITE
        HTTP1 --> CHROMA
        CHROMA --> EMB
    end

    subgraph RAGService["RAG Service :8764"]
        direction TB
        HTTP2["HTTP API"]
        CHROMA2["ChromaDB\n(shared data dir)"]

        HTTP2 --> CHROMA2
    end

    CB -- "append / search / profile" --> CSS
    CSS -- "HTTP JSON" --> HTTP1
    CB -- "retrieveMemoryContext()" --> RC
    RC -- "POST /rag/retrieve" --> HTTP2
```

### Memory Write Path

```mermaid
sequenceDiagram
    participant U as Discord User
    participant CB as chatbot.js
    participant CSS as chatbotStateStore
    participant MEM as Memory Service

    U ->> CB: message
    CB ->> CB: pushHistoryEntry() (in-memory ring buffer)
    CB ->> CSS: appendUserMemoryEntry()
    CSS ->> MEM: POST /memory/log
    MEM ->> MEM: INSERT into SQLite + upsert ChromaDB vector
    CB ->> CB: scheduleStateSave() (debounced)
    CB ->> CSS: PUT /state (full snapshot)
    CSS ->> MEM: write state JSON to SQLite
```

### Memory Read Path (per reply)

```mermaid
sequenceDiagram
    participant CB as chatbot.js
    participant CSS as chatbotStateStore
    participant MEM as Memory Service
    participant RC as ragClient.js
    participant RAG as RAG Service

    par Parallel context gathering
        CB ->> CSS: searchUserMemory()
        CSS ->> MEM: POST /memory/search
        MEM ->> MEM: ChromaDB vector similarity search
        MEM -->> CSS: matches[]
        CSS -->> CB: memoryClues[]
    and
        CB ->> RC: retrieveMemoryContext()
        RC ->> RAG: POST /rag/retrieve
        RAG ->> RAG: ChromaDB query + format context
        RAG -->> RC: context string
        RC -->> CB: ragContext
    and
        CB ->> CSS: fetchUserPromptProfile()
        CSS ->> MEM: POST /memory/profile
        MEM ->> MEM: aggregate user profile from history
        MEM -->> CSS: profile object
        CSS -->> CB: userContextProfile
    end

    CB ->> CB: buildPrompt() with all 3 context sources
```

---

## LLM Endpoint Strategy

```mermaid
flowchart TD
    A["requestLlmCompletion()"] --> B{"LLM_USE_LOCAL_GPU?"}
    B -- Yes --> C["Build local-first endpoint list:\n1. local GPU endpoint\n2. remote endpoints (failover)"]
    B -- No --> D["Round-robin across\nLLM_ENDPOINTS"]

    C --> E["Attempt loop\n(up to LLM_RETRY_LIMIT + 1)"]
    D --> E

    E --> F["POST /api/generate\n• model: CHATBOT_MODEL\n• stream: false\n• prompt: assembled string"]

    F --> G{"HTTP OK?"}
    G -- No --> H["Log failure, sleep(backoff)"]
    H --> E
    G -- Yes --> I{"Empty response?"}
    I -- Yes --> H
    I -- No --> J["Extract thoughts → relay\nNormalize response"]

    J --> K{"Normalized empty?"}
    K -- Yes --> L["recoverFallbackResponse()"]
    L --> M{"Fallback found?"}
    M -- No --> H
    M -- Yes --> N["Return fallback"]
    K -- No --> N2["Return normalized"]
```

---

## GIF Attachment Pipeline

```mermaid
flowchart LR
    A["Normalized LLM reply"] --> B{"GIF enabled\n& Giphy key set?"}
    B -- No --> OUT["Reply as-is"]
    B -- Yes --> C{"Random chance\n< chatbotGifChance?"}
    C -- No --> OUT
    C -- Yes --> D["requestGifSuggestion()\n→ LLM returns JSON:\n{useGif, query}"]
    D --> E{"useGif == true?"}
    E -- No --> OUT
    E -- Yes --> F["fetchGiphyGifUrl(query)\n→ Giphy Translate API"]
    F --> G{"Got URL?"}
    G -- No --> OUT
    G -- Yes --> H["Append GIF URL to reply\n→ output moderation check"]
    H --> OUT2["Final reply + GIF"]
```

---

## Web Search Flow

```mermaid
flowchart TD
    A["Message matches\nSEARCH_INTENT_PATTERN"] --> B["checkSearchAllowed(userId)"]
    B --> C{"Allowed?"}

    C -- "global-daily-limit\nor user-daily-limit\nor cooldown" --> D["Generate in-character\nrate-limit response via LLM\n(systemOverride prompt)"]
    D --> E["Reply with limit message"]

    C -- allowed --> F["executeBraveSearch(query)\n→ Brave Search API"]
    F --> G["formatSearchResultsForPrompt()"]
    G --> H["incrementSearchCount()"]
    H --> I["Pass searchResults into\nnormal LLM completion flow"]
    I --> J["LLM cites sources\nin character"]
```

---

## Thought Relay System

```mermaid
flowchart LR
    A["Raw LLM completion"] --> B["extractThoughtSegments()"]
    B --> C{"Has <think> tags\nor reasoning-leak\npattern?"}

    C -- No --> D["(no thoughts to relay)"]
    C -- Yes --> E["relayThoughtSegments()"]
    E --> F["For each THOUGHTS_CHANNEL_ID"]
    F --> G["buildThoughtMessage()\n[thought] kind | model | endpoint"]
    G --> H["channel.send()\n(allowedMentions: none)"]
```

---

## Audio & Voice Pipeline (overview)

```mermaid
flowchart TD
    A["sb!play <input>"] --> B{"Input type?"}
    B -- "YouTube URL" --> C["yt-dlp → extract audio URL"]
    B -- "SoundCloud URL" --> C
    B -- "search terms" --> D["YouTube search\n→ first result"] --> C
    B -- "HTTP/HLS stream" --> E["Direct stream URL"]
    B -- "no arg" --> F["DEFAULT_STREAM_URL"]

    C --> G["FFmpeg → Opus transcode\n(128 kbps)"]
    E --> G
    F --> G

    G --> H["Discord voice connection\nvia @discordjs/voice"]
    H --> I["AudioPlayer → voice channel"]

    I --> J{"Queue empty?"}
    J -- No --> K["Next track → C/E"]
    J -- "Yes + default stream" --> F
    J -- "Yes, no default" --> L["Disconnect"]
```

---

## Service Lifecycle

```mermaid
sequenceDiagram
    participant IDX as index.js
    participant CSS as chatbotStateStore
    participant MEM as Memory Service (Python)
    participant RC as ragClient
    participant RAG as RAG Service (Python)
    participant TR as thoughtRelay

    IDX ->> TR: setThoughtRelayClient(discordClient)
    IDX ->> IDX: client.login()

    Note over IDX: On first chatbot message:
    IDX ->> CSS: loadChatbotState()
    CSS ->> CSS: resolvePythonCandidates()
    CSS ->> MEM: spawn chatbot_memory_service_vector.py
    MEM ->> MEM: bind :8765 (or fallback port)
    CSS ->> MEM: GET /health (poll until ready)
    CSS ->> MEM: GET /state
    MEM -->> CSS: saved state JSON

    Note over IDX: On RAG-needing message:
    IDX ->> RC: retrieveMemoryContext()
    RC ->> RAG: spawn chatbot_rag_service.py
    RAG ->> RAG: bind :8764
    RC ->> RAG: GET /health (poll until ready)

    Note over IDX: On shutdown (SIGINT/SIGTERM):
    IDX ->> CSS: flushStateSave()
    IDX ->> CSS: closeChatbotStateStore()
    CSS ->> MEM: (process terminates)
```

---

## File Responsibility Map

| File | Role |
|------|------|
| `src/index.js` | Bootstrap, Discord client, event routing, graceful shutdown |
| `src/chatbot.js` | Message handling, reply decision engine, intent detection, context orchestration |
| `src/llmClient.js` | Prompt building, Ollama API calls, response normalization pipeline, GIF suggestion |
| `src/chatbotStateStore.js` | Python memory-service lifecycle, HTTP bridge to memory/vector DB |
| `src/ragClient.js` | Python RAG-service lifecycle, HTTP bridge to RAG retrieval |
| `src/thoughtRelay.js` | Routes extracted `<think>` / leaked reasoning text to Discord thoughts channel |
| `src/moderation.js` | Input/output filtering (length, blocklist, mentions, invite links) |
| `src/braveSearch.js` | Brave Search API wrapper, rate limiting (global + per-user + cooldown) |
| `src/giphyClient.js` | Giphy Translate API wrapper |
| `src/controlPlane.js` | Slash-command admin UI (`/lumi-status`, `/lumi-set`, `/lumi-toggle`, etc.) |
| `src/config.js` | Environment variable parsing, runtime config object, persona hot-reload |
| `src/nowPlaying.js` | Polls external song-info URL for now-playing context |
| `src/voice.js` | Discord voice connections, FFmpeg/yt-dlp audio pipeline |
| `src/queue.js` | Per-guild track queue management |
| `src/commands.js` | Prefix command handler (`sb!play`, `sb!stop`, etc.) + slash interaction routing |
| `src/starboard.js` | Reaction-based message reposting |
| `src/welcome.js` | New-member greeting |
| `python/chatbot_memory_service_vector.py` | SQLite state + ChromaDB vector memory HTTP service |
| `python/chatbot_rag_service.py` | RAG retrieval HTTP service over ChromaDB |
