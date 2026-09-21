# AutoForm AI ⚡ (v2.0 Production)

> Zero-config, multi-provider AI assistant with Local Hybrid RAG Memory to automatically solve and fill Google Forms, job application boards (Greenhouse, Lever, Ashby, Workday), and universal web forms across Chrome, Firefox, Edge, and mobile extension browsers.

AutoForm AI is a cross-browser extension backed by a high-throughput proxy server that intelligently coordinates **Groq (Llama 3.3)**, **Google Gemini**, **OpenRouter**, and **NVIDIA NIM** with automatic failover, sub-second latency, and a privacy-first **Local Memory Vault** that remembers your personal profile and experiences without sending personal databases to the cloud.

---

## ✨ Features

- **⚡ Zero-Config & Instant:** Install and start filling forms immediately — no API keys or setup wizards required.
- **🌐 Universal Multi-Platform Form Engine:**
  - **Google Forms:** ARIA-first listitem cards, Material `[role="listbox"]` dropdowns, linear scales, multi-page forms, and custom "Other: [___]" text inputs.
  - **Greenhouse ATS (`boards.greenhouse.io`):** Core applicant fields, custom job questions, and dynamic file upload indicators.
  - **Lever ATS (`jobs.lever.co`):** Application questions, bracketed names (`urls[LinkedIn]`, `cards[...]`), and resume links.
  - **Generic Job Boards & Web Forms:** Workday, Ashby, BambooHR, and standard HTML `<form>` pages with automatic grouping of radio button sets, checkboxes, and `<select>` dropdowns.
  - **Modern Framework Integration:** Native property descriptor binding bypasses React 16/17/18, Vue, and Angular synthetic event traps.
- **⚡ One-Click Instant Slot Filling (0ms • 0 Quota):**
  - Directly matches standard identity, contact, and academic fields (Full Name, First/Last Name, Email, Phone, LinkedIn, GitHub, Portfolio, City, Country, University, Degree, Major, GPA, Graduation Year).
  - Fills recognized fields in 0ms client-side without consuming hourly AI solve quota or incurring network latency.
  - Dedicated **"Instant Profile Fill"** button in popup for immediate one-click autofill of personal details.
- **⏩ Configurable Fill Pacing & Speed:**
  - **Turbo** (~150ms delay): Ultra-fast automation for high-volume tasks.
  - **Natural** (~800ms delay): Balanced default with authentic pacing.
  - **Stealth Human** (~1.5s delay): Human-like speed with organic random jitter to mimic manual typing.
- **⌨️ Global Keyboard Shortcut:**
  - Press **`Alt+Shift+F`** on any Google Form to toggle AutoForm AI solving instantly without opening the extension popup.
- **🌐 Whole-Form Understanding & Multi-Question Reasoning:**
  - **Macro Form Synthesis:** Scrapes the form title, description, and full question outline before solving, classifying form intent (`Job Application`, `Academic`, `Survey`, `Event RSVP`, `Quiz`) to align answers with the form's overarching goal.
  - **Rolling Answer History & Cross-Question Consistency:** Tracks previously answered questions on the active form so downstream answers never contradict earlier choices, roles, dates, or tools.
  - **Experience & Story Deduplication:** Tracks used memory snippets across open-ended essay questions so the AI showcases distinct experiences rather than repeating the same anecdote.
- **🧠 Local Memory Vault & Hybrid RAG Engine:**
  - **100% Client-Side Privacy:** Stored exclusively in browser `chrome.storage.local`.
  - **1-Click AI Memory Export:** Instant prompt helper to export memories from **ChatGPT**, **Gemini**, or **Claude** directly into AutoForm AI.
  - **Smart Parser:** Automatically extracts contact details, URLs, academic history, and categorizes memory snippets (`experience`, `project`, `skill`, `perspective`).
  - **Intent Classification & BM25 Scoring:** Ranks and injects the most relevant profile facts and stories per question.
  - **Choice Cross-Referencing:** Calculates academic levels (Freshman–Senior) and matches degree / skill options directly against choices.
- **🤖 4-Engine Multi-Provider AI Routing:**
  - **Groq** (`llama-3.3-70b-versatile`): Sub-300ms ultra-fast primary inference.
  - **Google Gemini** (`gemini-2.5-flash-lite`): High-accuracy multimodal reasoning via `x-goog-api-key`.
  - **OpenRouter Free Tier** (`openrouter/free`): Zero-token auto-routing backup.
  - **NVIDIA NIM** (`meta/llama-3.1-70b-instruct`): Enterprise backup fallback.
- **🛡️ Circuit Breaker & Key Cooldowns:** 3-state circuit breaker (`CLOSED`/`OPEN`/`HALF_OPEN`) with canary auto-recovery prevents cascading timeouts, while intelligent 429 key cooldowns guarantee 100% uptime across rate spikes.
- **⚡ Advanced DOM Engine:**
  - Full support for Google Forms Material Design `[role="listbox"]` dropdowns, linear scales, radios, and checkboxes.
  - **Google Forms "Other: [___]" Handling:** Automatically selects custom "Other" options and fills the companion text input field.
  - **Smart Dropdown Verification:** Detects pre-filled dropdown selections to avoid redundant overwrites.
  - Client-side deterministic answer hash caching (0ms instant responses for recurring questions).
  - Automatic multi-page section navigation.
- **🌐 Universal Cross-Browser & Mobile Support:**
  - Compatible with **Google Chrome**, **Mozilla Firefox**, and **Microsoft Edge** on Manifest V3.
  - Fully responsive on mobile extension browsers (Kiwi, Firefox Android, Orion on iOS) with 44px touch targets and iOS auto-zoom prevention.
- **🎨 Modern Motion & UI/UX:**
  - Segmented tab navigation (`⚡ Instant Import`, `👤 Profile Details`, `🧠 Memory Cards`) with smooth GPU-accelerated spring transitions.
  - Draggable Floating Action Button (FAB) on Google Forms with magnetic edge snapping.
  - Sleek modal overlay with real percentage progress bar, question preview, and instant **"Stop & Cancel"** button.
- **🎯 Smart Preferences:** Customize answer tone (Accurate, Concise, Detailed) or supply persona context.
- **🔒 Production Hardened:** Security headers (`nosniff`, `DENY`, HSTS, disabled `X-Powered-By`), UUID `X-Request-Id` tracing, and `/healthz` liveness probes.

---

## 📂 Project Architecture

```text
AutoForm-AI/
├── manifest.json                  # Universal Manifest V3 (Chrome, Firefox, Edge)
├── package.json                   # Root scripts & extension bundler
├── AGENTS.md                      # Comprehensive AI/LLM developer guide
├── README.md                      # Human-facing documentation
│
├── server/                        # Production Backend Proxy Server
│   ├── package.json               # Express, CORS, Dotenv
│   ├── Dockerfile                 # Production container definition
│   ├── railway.json               # 1-click Railway deploy template
│   ├── render.yaml                # 1-click Render deploy template
│   ├── .env.example               # Server environment template
│   ├── tests/                     # Node.js automated test suites (85 tests, 22 suites)
│   │   ├── apiSecurity.test.js
│   │   ├── circuitBreaker.test.js
│   │   ├── formAdapters.test.js
│   │   ├── keyRotator.test.js
│   │   ├── memoryRetriever.test.js
│   │   ├── openrouter.test.js
│   │   ├── routerCircuitBreaker.test.js
│   │   └── routerKeyCooldown.test.js
│   └── src/
│       ├── index.js               # Express API server entry point
│       ├── config.js              # Multi-provider configuration & key parser
│       ├── providers/             # Base, Groq, Gemini, OpenRouter, NVIDIA adapters
│       ├── services/              # Router, CircuitBreaker, KeyRotator
│       └── middleware/            # Sliding-window rate limiter & validator
│
├── src/                           # Browser Extension Source
│   ├── background/
│   │   └── background.js          # Service worker, proxy client & RAG context injector
│   ├── content/
│   │   └── content.js             # Form scraping, DOM automation & modern UI overlay
│   ├── services/
│   │   ├── formAdapters.js        # Universal Form Engine (Google Forms, Greenhouse, Lever, Generic)
│   │   └── memoryRetriever.js     # Client-side Hybrid RAG engine (BM25, intent, slots)
│   ├── options/
│   │   ├── options.html           # Memory Vault full-tab manager
│   │   ├── options.css            # Responsive layout, micro-animations & tabs
│   │   └── options.js             # Auto-save, smart parser, and card filters
│   └── popup/
│       ├── popup.html             # Sleek modern popup interface
│       ├── popup.js               # Popup controller & form detector
│       └── popup.css              # Dark minimalist styling
│
├── docs/
│   ├── ARCHITECTURE.md            # Mermaid sequence diagrams & architecture specs
│   └── SELECTORS.md               # Google Forms ARIA DOM selector dictionary
│
└── scripts/
    ├── validate_manifest.js       # Manifest & file path validator
    └── package_extension.js       # Release zip packager (Chrome, Edge, Firefox)
```

---

## 🚀 Quickstart

### 1. Start the Backend Proxy Server

1. Navigate to the `server/` directory:
   ```bash
   cd server
   cp .env.example .env
   ```
2. Open `.env` and add your API keys (supports comma-separated keys for automatic round-robin rotation):
   ```env
   GROQ_API_KEYS=gsk_your_groq_key_here
   GEMINI_API_KEYS=AIzaSy_your_gemini_key_here
   OPENROUTER_API_KEYS=sk-or-your_openrouter_key_here
   NVIDIA_API_KEYS=nvapi-your_nvidia_key_here
   ```
3. Start the server:
   ```bash
   npm install
   npm start
   # Server runs on http://localhost:3000
   ```

### 2. Load Extension in Your Browser

#### Google Chrome / Microsoft Edge / Brave:
1. Navigate to `chrome://extensions` (or `edge://extensions`).
2. Toggle on **Developer mode** in the top right.
3. Click **Load unpacked** and select the root `AutoForm-AI` directory.

#### Mozilla Firefox:
1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select `manifest.json` in the root `AutoForm-AI` directory.

---

## 🎯 How to Use

### 1. Personalize Your Memory Vault
1. Click the AutoForm AI extension icon and select **Memory & Profile**.
2. Click **Copy Export Prompt** and send it to **ChatGPT**, **Gemini**, or **Claude**.
3. Paste the AI's response into the **Import Data** box and click **Parse & Save**.
4. Your identity, education, and career snippets are now ready for any form!

### 2. Fill Any Form
1. Open any [Google Form](https://docs.google.com/forms).
2. Click the floating **"⚡ AI Fill"** button on the bottom right (or click **"Fill Current Form"** from the popup).
3. Watch AutoForm AI intelligently complete all questions with real-time percentage progress!
4. Need to halt? Press the **Escape** key or click **"Stop & Cancel"** at any moment.

---

## 🛠️ Development & Testing

- **Run Server Resilience & Memory RAG Test Suite:**
  ```bash
  npm test
  ```
- **Validate extension manifest & assets:**
  ```bash
  npm run validate
  ```
- **Package multi-browser release bundles (`dist/`):**
  ```bash
  npm run package
  ```

---

## 🔒 Privacy & Security Guarantee

* **100% Local Storage:** Your Memory Vault data is stored exclusively in your browser's local `chrome.storage.local`.
* **Zero Telemetry / Tracking:** No analytics or behavioral logs are collected.
* **Minimal AI Payloads:** Only the specific memory context relevant to the active question is attached during inference.
