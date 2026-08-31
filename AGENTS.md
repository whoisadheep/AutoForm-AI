# AGENTS.md — AutoForm AI v2.0 Developer & LLM Architecture Guide

This guide is written for AI agents and LLMs working on the **AutoForm AI** repository.

---

## 1. System Overview

AutoForm AI v2.0 is a **Manifest V3 cross-browser extension** (Chrome, Firefox, Edge) supported by a **Node.js multi-provider backend proxy** (Groq, Gemini, NVIDIA NIM).

### Key Architectural Concepts:
- **Zero-Config User Flow:** End users do not supply API keys; all inference is proxied securely through the backend server.
- **Intelligent Failover:** Server automatically tries `Groq` -> `Gemini` -> `NVIDIA` if rate-limited (`429`) or unavailable.
- **Universal Manifest:** Compatible with both Chromium (service worker) and Firefox (background scripts) using MV3.
- **ARIA-First DOM Selectors:** Uses semantic ARIA attributes and `data-value` resolution to interact with Google Forms safely.

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
│   └── src/
│       ├── index.js               # Express API server
│       ├── config.js              # Environment & multi-key manager
│       ├── providers/             # Base, Groq, Gemini, NVIDIA adapters
│       ├── services/              # Multi-provider router & failover
│       └── middleware/            # Rate limiter & validator
│
├── src/                           # Browser Extension Source
│   ├── background/
│   │   └── background.js          # Service worker & proxy client
│   ├── content/
│   │   └── content.js             # Form scraping & automation engine
│   └── popup/
│       ├── popup.html             # Sleek modern popup template
│       ├── popup.js               # Popup interactions & status checker
│       └── popup.css              # Dark minimalist styling
│
├── docs/
│   ├── ARCHITECTURE.md            # Deep architecture diagrams & sequence flows
│   └── SELECTORS.md               # Google Forms DOM selector dictionary
│
└── scripts/
    ├── validate_manifest.js       # Manifest & file path validator
    └── package_extension.js       # Release zip bundler
```

---

## 3. Communication Protocols

### Extension Runtime Messages (`chrome.runtime`)

| Action | Sender | Receiver | Payload | Response |
|:---|:---|:---|:---|:---|
| `START_SOLVING` | `popup.js` | `content.js` | `{}` | `{ success: true, isSolving: true }` |
| `STOP_SOLVING` | `popup.js` | `content.js` | `{}` | `{ success: true, isSolving: false }` |
| `GET_SOLVER_STATUS` | `popup.js` | `content.js` | `{}` | `{ isSolving: boolean, questionCount: number }` |
| `CHECK_SERVER_HEALTH` | `popup.js` | `background.js` | `{}` | `{ success: boolean, data: object }` |
| `SOLVE_SINGLE_QUESTION` | `content.js` | `background.js` | `{ id, question, type, choices }` | `{ success: true, answer: string, answers?: string[], provider: string, latencyMs: number }` |

### Backend API Protocol (`server/`)

- **`POST /api/v1/solve`**:
  - Request Headers: `Content-Type: application/json`, `X-Client-ID: <uuid>`
  - Request Body: `{ clientId, question, type, choices, customContext, tone }`
  - Response: `{ success: true, answer: string, answers?: string[], provider: string, latencyMs: number }`
- **`GET /api/v1/health`**:
  - Returns active providers and real-time latency / success metrics.
- **`GET /api/v1/quota`**:
  - Returns remaining hourly questions for the requesting client.

---

## 4. Engineering Conventions

1. **Structured Clone Compliance:** Never attach DOM `HTMLElement` references to message payloads passed to `chrome.runtime.sendMessage`.
2. **Resilient Selectors:** Maintain ARIA fallbacks (`div[role="listitem"]`, `[role="heading"]`, `[role="radio"]`, `[role="checkbox"]`) instead of relying solely on obfuscated classes.
3. **Always Run Validation:** Execute `npm run validate` after modifying extension paths or manifest fields.
