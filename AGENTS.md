# AGENTS.md — AutoForm AI v2.0 Developer & LLM Architecture Guide

This guide is written for AI agents and LLMs working on the **AutoForm AI** repository.

---

## 1. System Overview

AutoForm AI v2.0 is a **Manifest V3 cross-browser extension** (Chrome, Firefox, Edge) supported by a **Node.js multi-provider backend proxy** (Groq, Gemini, OpenRouter, NVIDIA NIM) and a **Client-Side Hybrid RAG Memory Vault**.

### Key Architectural Concepts:
- **Zero-Config User Flow:** End users do not supply API keys; all inference is proxied securely through the backend server.
- **Intelligent Failover:** Server automatically routes `Groq` -> `Gemini` -> `OpenRouter` -> `NVIDIA` if rate-limited (`429`) or unavailable.
- **Sliding-Window Rate Limiting:** 150 questions/hour per client UUID with real-time countdown reset tracking.
- **Universal Form Engine (`formAdapters.js`):** Pluggable adapters for Google Forms, Greenhouse ATS, Lever ATS, and Generic Job/HTML Forms. Resolves questions via 10-tier cascading labels and dispatches through native prototype setters to bypass React/Vue/Angular synthetic event traps.
- **Client-Side Hybrid RAG (`memoryRetriever.js`):** User personal profile and memory snippets are stored locally in `chrome.storage.local`. The retriever tokenizes question text, classifies intent, cross-references choices, scores snippets using BM25/TF-IDF, and injects high-precision context dynamically.
- **Universal Manifest:** Compatible with Chromium (service worker), Firefox (background scripts), and mobile extension browsers (Kiwi, Firefox Android, Orion).
- **ARIA-First DOM Selectors:** Semantic ARIA attributes and `data-value` resolution to interact with Google Forms safely.

---

## 2. Repository Layout

```text
AutoForm-AI/
├── manifest.json                  # Universal MV3 extension manifest
├── package.json                   # Root package scripts & bundler
├── AGENTS.md                      # AI assistant guide (this file)
├── README.md                      # Human-facing documentation
│
├── server/                        # Production Backend Proxy Server
│   ├── package.json
│   ├── Dockerfile
│   ├── railway.json / render.yaml
│   ├── .env.example
│   ├── tests/                     # Automated test suites (100 tests, 23 suites)
│   │   ├── apiSecurity.test.js
│   │   ├── circuitBreaker.test.js
│   │   ├── formAdapters.test.js
│   │   ├── keyRotator.test.js
│   │   ├── memoryRetriever.test.js
│   │   ├── openrouter.test.js
│   │   ├── routerCircuitBreaker.test.js
│   │   └── routerKeyCooldown.test.js
│   └── src/
│       ├── index.js               # Express API server
│       ├── config.js              # Environment & multi-key manager
│       ├── providers/             # Base, Groq, Gemini, OpenRouter, NVIDIA adapters
│       ├── services/              # Router, CircuitBreaker, KeyRotator
│       └── middleware/            # Rate limiter & validator
│
├── src/                           # Browser Extension Source
│   ├── background/
│   │   └── background.js          # Service worker, proxy client & command listener
│   ├── content/
│   │   └── content.js             # Form scraping, instant slot autofill & runner
│   ├── services/
│   │   ├── formAdapters.js        # Universal Form Engine & ATS adapters
│   │   └── memoryRetriever.js     # Client-side Hybrid RAG & instant slot resolver
│   ├── options/
│   │   ├── options.html           # Memory Vault options interface
│   │   ├── options.js             # Auto-save, smart parser & card filters
│   │   └── options.css            # Responsive layout, micro-animations & tabs
│   └── popup/
│       ├── popup.html             # Popup template with instant profile & pacing controls
│       ├── popup.js               # Popup interactions, pacing & status checker
│       └── popup.css              # Dark minimalist styling
│
├── docs/
│   ├── ARCHITECTURE.md            # Deep architecture diagrams & sequence flows
│   └── SELECTORS.md               # Google Forms DOM selector dictionary
│
└── scripts/
    ├── validate_manifest.js       # Manifest & file path validator
    └── package_extension.js       # Release zip bundler (Chrome, Edge, Firefox)
```

---

## 3. Communication Protocols

### Extension Runtime Messages (`chrome.runtime`)

| Action | Sender | Receiver | Payload | Response |
|:---|:---|:---|:---|:---|
| `START_SOLVING` | `popup.js` / `background.js` | `content.js` | `{}` | `{ success: true, isSolving: true }` |
| `STOP_SOLVING` | `popup.js` | `content.js` | `{}` | `{ success: true, isSolving: false }` |
| `INSTANT_FILL_PROFILE` | `popup.js` | `content.js` | `{}` | `{ success: true, filledCount: number }` |
| `GET_SOLVER_STATUS` | `popup.js` | `content.js` | `{}` | `{ isSolving: boolean, questionCount: number }` |
| `CHECK_SERVER_HEALTH` | `popup.js` | `background.js` | `{}` | `{ success: boolean, data: object }` |
| `GET_CLIENT_QUOTA` | `popup.js` | `background.js` | `{}` | `{ success: boolean, quota: object }` |
| `SOLVE_SINGLE_QUESTION` | `content.js` | `background.js` | `{ id, question, type, choices }` | `{ success: true, answer: string, answers?: string[], provider: string, latencyMs: number }` |

### Keyboard Shortcuts (`chrome.commands`)
- **`Alt+Shift+F`** (Windows / Linux / macOS): Toggles AutoForm AI solving immediately on active Google Form tabs without opening the popup.

### Backend API Protocol (`server/`)

- **`POST /api/v1/solve`**:
  - Request Headers: `Content-Type: application/json`, `X-Client-ID: <uuid>`
  - Request Body: `{ clientId, question, type, choices, customContext, tone }`
  - Response: `{ success: true, answer: string, answers?: string[], provider: string, latencyMs: number }`
- **`GET /api/v1/health`**:
  - Returns active providers, circuit breaker statuses, and real-time metrics.
- **`GET /api/v1/quota`**:
  - Returns `{ used, limit: 150, remaining, resetMinutes }` for the client.

---

## 4. Memory & Local Hybrid RAG Architecture

### Storage Schema (`chrome.storage.local.get('memoryProfile')`)

```json
{
  "memoryProfile": {
    "identity": {
      "fullName": "Alex Rivera",
      "email": "alex@example.com",
      "phone": "+1 (555) 019-2834",
      "location": "San Francisco, CA"
    },
    "links": {
      "github": "https://github.com/...",
      "linkedin": "https://linkedin.com/in/...",
      "portfolio": "https://...",
      "twitter": "https://x.com/..."
    },
    "education": {
      "university": "UC Berkeley",
      "degree": "Bachelor of Science",
      "major": "Computer Science",
      "graduationYear": "2026",
      "gpa": "3.90"
    },
    "snippets": [
      {
        "id": "uuid",
        "category": "experience | project | skill | perspective | other",
        "title": "Role at Acme Corp",
        "content": "...",
        "tags": ["react", "typescript"],
        "createdAt": "2026-09-07T..."
      }
    ],
    "rawImport": "...",
    "updatedAt": "2026-09-07T..."
  }
}
```

### Retrieval & Whole-Form Reasoning Pipeline (`src/services/memoryRetriever.js`)

1. **Whole-Form Macro Understanding (`buildFormDigest`):** Scrapes form title, description, and overall question outline. Classifies macro intent (`FormMacroIntent`: Job Application, Academic, Survey, Event, Quiz, General) and injects a `[FORM MACRO CONTEXT & GOAL]` block into inference prompts.
2. **Rolling Answer History & Cross-Question Consistency:** Maintains rolling history of prior answers on the active form (`getBlockAnswer`, `priorAnswers.slice(-6)`), enforcing `[PREVIOUS ANSWERS IN THIS FORM]` and a `CRITICAL CONSISTENCY RULE` to prevent self-contradiction.
3. **Experience & Story Deduplication:** Tracks `usedSnippetIds` across open-ended essay questions. Prioritizes fresh, unused memory snippets over previously used ones and appends explicit deduplication instructions to ensure distinct anecdotes across essays.
4. **Deterministic Direct Slot Resolution:** If a question explicitly asks for Email, Phone, Name, GitHub, LinkedIn, Portfolio, University, GPA, or Grad Year, it produces a `[DIRECT MATCH FACT]` block.
5. **Intent Classification:** Identifies question intent (`CONTACT_LINK`, `EDUCATION`, `WORK_EXPERIENCE`, `PROJECTS`, `SKILLS`, `BEHAVIORAL_ESSAY`).
6. **Choice Cross-Referencing:** Cross-references multiple-choice / dropdown options with user graduation year (calculating academic level: Freshman/Sophomore/Junior/Senior), degrees, and skill tags.
7. **BM25 / TF-IDF Scoring:** Tokenizes query, filters form stopwords, and applies intent multipliers ($2.0\times$ to $2.5\times$) to matching snippet categories.
8. **Token Budgeting:** Caps context to ~400 words to maintain prompt efficiency.

---

## 5. Engineering Conventions

1. **Client-Side Privacy:** Never send the user's raw memory profile or full database over the network. Only dynamic, question-relevant context snippets are attached during inference.
2. **Structured Clone Compliance:** Never attach DOM `HTMLElement` references to message payloads passed to `chrome.runtime.sendMessage`.
3. **Resilient Selectors:** Maintain ARIA fallbacks (`div[role="listitem"]`, `[role="heading"]`, `[role="radio"]`, `[role="checkbox"]`) instead of relying solely on obfuscated classes.
4. **Mobile & Viewport Standards:** Keep input font sizes $\ge 16$px on screens $\le 600$px to prevent iOS Safari viewport zooming. Maintain $\ge 44$px touch targets.
5. **Always Run Validation & Tests:**
   - `npm test`: Must pass 100% (100 tests, 23 test suites).
   - `npm run validate`: Manifest and all referenced files must validate successfully.
   - `npm run package`: Generates release bundles for Chrome, Edge, and Firefox AMO in `dist/`.
