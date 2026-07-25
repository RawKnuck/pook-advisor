# The Pook Advisor (`pook.raunakjalan.com`)

An AI Strategic Advisor grounded in the philosophy, essays, and wisdom of **The Book of Pook** (`bookofpook.com`). Designed for inner game, dating, mindset, self-improvement, and understanding attraction dynamics.

---

## 🏛️ System Architecture & RAG Pipeline

```mermaid
graph TD
    User([User Query / Image Context]) --> NextAuth[NextAuth Authentication]
    NextAuth --> API[/api/chat Endpoint]
    API --> Embed[Google Gemini Embedding 2]
    Embed --> VectorDB[(Supabase PostgreSQL pgvector)]
    VectorDB -->|Cosine Match Top 8 Chunks| RAG[RAG System Prompt Context]
    RAG --> LLM[Google Gemini 2.5 Flash]
    LLM --> Response[Strategic Counsel Response]
```

### Key Technical Specs:
- **Chunk RAG Retrieval**: 72 chapters from *The Book of Pook* chunked into semantic units with 3072-dimensional vector embeddings (`gemini-embedding-2`).
- **Prompt Caching**: System prompt instructions cached in `pook_chats` per session with turn-count invalidation every 10 turns.
- **Multimodal Context**: Base64 image paste, file upload, drag-and-drop, and full-screen lightbox preview.
- **Sliding History Cap**: Last 20 messages retrieved to eliminate token bloat and maintain fast response times.
- **Dynamic Snapping**: Instant scroll alignment to the last user query on turn updates.

---

## 🚀 Setup & Local Development

1. **Environment Variables** (`.env`):
```env
DATABASE_URL=postgresql://postgres:...@db.xzntjcttcijvpdytoopk.supabase.co:5432/postgres
GEMINI_API_KEY=your_gemini_api_key
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

2. **Install & Run**:
```bash
npm install
npm run dev
```

---

## 📜 Deployment

- Deployed on **Vercel** connected to GitHub repository [`RawKnuck/pook-advisor`](https://github.com/RawKnuck/pook-advisor).
- Domain: `pook.raunakjalan.com`.
