# AutoForm AI ⚡ (v2.0.3 Production)

> Zero-config, multi-provider AI assistant with Local Hybrid RAG Memory to automatically solve and fill Google Forms, job application boards (Greenhouse, Lever, Ashby, Workday), and universal web forms across Chrome, Firefox, Edge, and mobile extension browsers.

AutoForm AI is a cross-browser extension backed by a high-throughput proxy server that intelligently coordinates **Groq (Llama 3.3)**, **Google Gemini**, **OpenRouter**, and **NVIDIA NIM** with automatic failover, sub-second latency, and a privacy-first **Local Memory Vault** that remembers your personal profile and experiences without sending personal databases to the cloud.

---

## ✨ Features

- **⚡ Zero-Config & Instant:** Install and start filling forms immediately — no API keys or setup wizards required for end-users.
- **🔍 Preview & Verify Before Fill (Human-in-the-Loop AI Safety):**
  - **Full Solution Inspection:** Displays an elegant, Apple/Vercel-level modal with all proposed answers before any field is modified on the form.
  - **Intelligent Confidence Scoring & Trick Detection:** Automatically flags negative trick questions (`NOT`, `EXCEPT`, `LEAST`), complex multi-select checkboxes, legal/compensation choices, and open-ended essays without matching memories with amber `⚠️ Review Recommended` banners.
  - **In-Line Interactive Editing:** Tweak text inputs, switch radio choices, or adjust checkboxes directly inside the preview cards. Changes apply instantly.
  - **One-Click Quick Filters:** Jump straight to flagged items with the `⚠️ Needs Review` tab, or review verified answers with `✓ High Confidence`.
  - **Safe & Non-Destructive:** Apply all reviewed answers in one click (`Ctrl + Enter`) or discard completely (`Esc`) without altering the page.
  - **Configurable Toggle:** Enable or disable anytime via the popup Preferences toggle.
- **🔄 Dynamic Remote Configuration & Cloud Discovery:**
  - **Zero-Downtime Server Routing:** Discovers active backend proxies via GitHub-hosted remote configuration (`config/remote-config.json`) with intelligent local caching (6-hour TTL).
  - **Store-Independent Server Migrations:** Server host changes or failovers update instantly across all installed extensions worldwide without requiring browser store re-submissions.
  - **Server & Connection Dashboard:** Dedicated 4th tab in Options to inspect real-time connection status, ping latency (ms), active inference engines, force-refresh cloud config, or set custom self-hosted proxy URLs.
- **🌐 Universal Multi-Platform Form Engine:**
  - **Google Forms:** ARIA-first listitem cards, Material `[role="listbox"]` dropdowns, linear scales, multi-page forms, and custom "Other: [___]" text inputs.
  - **Greenhouse ATS (`boards.greenhouse.io`):** Core applicant fields, custom job questions, and dynamic file upload indicators.
  - **Lever ATS (`jobs.lever.co`):** Application questions, bracketed names (`urls[LinkedIn]`, `cards[...]`), and resume links.
  - **Generic Job Boards & Web Forms:** Workday, Ashby, BambooHR, and standard HTML `<form>` pages with automatic grouping of radio button sets, multi-select checkboxes, and `<select>` dropdowns.
  - **Framework-Resilient Synthetic Event Bypass:** Native property descriptor binding (`setNativeValue`) bypasses React 16/17/18, Vue, and Angular synthetic event traps.
  - **Strict Option Matching:** Enforces strict exact-boundary matching for short and numeric options to prevent substring collisions (e.g., choice `"2"` never false-matches `"21"`).
- **⚡ One-Click Instant Slot Filling (0ms • 0 Quota):**
  - Directly matches standard identity, contact, and academic fields (Full Name, First/Last Name, Email, Phone, WhatsApp, LinkedIn, GitHub, Portfolio, City, Country, University, College, Degree, Major/Department, GPA, Roll Number/USN, Graduation Year).
  - Fills recognized fields in 0ms client-side without consuming hourly AI solve quota or incurring network latency.
  - Dedicated **"Instant Profile Fill"** button in popup for immediate one-click autofill of personal details.
- **⏩ Configurable Fill Pacing & Speed:**
  - **Turbo** (~150ms delay): Ultra-fast automation for high-volume tasks.
  - **Natural** (~800ms delay): Balanced default with authentic pacing.
  - **Stealth Human** (~1.5s delay): Human-like speed with organic random jitter to mimic manual typing.
- **⌨️ Global Keyboard Shortcut:**
  - Press **`Alt+Shift+F`** (or **`Option+Shift+F`** on macOS) on any supported form to toggle AutoForm AI solving instantly without opening the extension popup.
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
- **🤖 Resilient Multi-Provider AI Routing:**
  - **OpenRouter Free Tier:** Prioritizes ultra-fast, high-accuracy free models (`liquid/lfm-2.5-2.6b:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-super-120b-a12b:free`) with safety classifier bypass guardrails.
  - **Groq** (`llama-3.3-70b-versatile`): Sub-300ms ultra-fast primary inference.
  - **Google Gemini** (`gemini-2.5-flash`): High-accuracy multimodal reasoning via `x-goog-api-key`.
  - **NVIDIA NIM** (`meta/llama-3.1-70b-instruct`): Enterprise backup fallback.
  - **Laya Offline Solver:** Embedded lightweight neural classifier for instant offline question handling.
- **🛡️ Circuit Breaker & Key Cooldowns:** 3-state circuit breaker (`CLOSED`/`OPEN`/`HALF_OPEN`) with canary auto-recovery prevents cascading timeouts, while intelligent 429 key cooldowns guarantee 100% uptime across rate spikes.
- **🧪 Universal Edge-Case Testbench:**
  - Built-in local quiz testbench (`npm run testbench` on `http://localhost:5000`) designed to stress-test non-Google forms, trick negative questions, native `<select>` dropdowns, multi-select checkboxes, obfuscated DOM wrappers, and open-ended technical essays with automated grading.
- **🌐 Universal Cross-Browser & Mobile Support:**
  - Manifest V3 compliant for **Google Chrome**, **Mozilla Firefox**, and **Microsoft Edge**.
  - Fully responsive on mobile extension browsers (Kiwi, Firefox Android, Orion on iOS) with 44px touch targets and iOS auto-zoom prevention.
- **🎨 Modern Motion & UI/UX:**
  - Segmented tab navigation (`⚡ Instant Import`, `👤 Profile Details`, `🧠 Memory Cards`, `🔌 Server & Connection`) with smooth transitions.
  - Draggable Floating Action Button (FAB) on Google Forms with magnetic edge snapping.
  - Sleek modal overlay with real percentage progress bar, question preview, and instant **"Stop & Cancel"** button.
  - Dynamic status banners for service announcements or maintenance notices.
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
├── config/
│   └── remote-config.json         # Dynamic cloud discovery configuration
│
├── testbench/                     # Edge-Case Universal Form Testbench
│   ├── index.html                 # Interactive test form with auto-grading
│   └── server.js                  # Local testbench server (http://localhost:5000)
│
├── server/                        # Production Backend Proxy Server
│   ├── package.json               # Express, CORS, Dotenv, Laya
│   ├── Dockerfile                 # Production container definition
│   ├── render.yaml                # 1-click Render deploy template
│   ├── railway.json               # 1-click Railway deploy template
│   ├── .env.example               # Server environment template
│   ├── tests/                     # Automated test suites (119 tests, 27 suites)
│   │   ├── apiSecurity.test.js    # Security headers & /config endpoint tests
│   │   ├── circuitBreaker.test.js
│   │   ├── formAdapters.test.js   # Universal Form Engine unit tests
│   │   ├── keyRotator.test.js
│   │   ├── laya.test.js
│   │   ├── memoryRetriever.test.js# Hybrid RAG & slot resolution tests
│   │   ├── openrouter.test.js
│   │   ├── previewConfidence.test.js # Confidence heuristics & preview tests
│   │   ├── routerCircuitBreaker.test.js
│   │   └── routerKeyCooldown.test.js
│   └── src/
│       ├── index.js               # Express API server entry point & /config endpoint
│       ├── config.js              # Multi-provider configuration & key parser
│       ├── providers/             # Base, Groq, Gemini, OpenRouter, NVIDIA, Laya
│       ├── services/              # Router, CircuitBreaker, KeyRotator
│       └── middleware/            # Sliding-window rate limiter & validator
│
├── src/                           # Browser Extension Source
│   ├── background/
│   │   └── background.js          # Service worker, remote config discovery & solver
│   ├── content/
│   │   └── content.js             # Form scraping, DOM automation & UI overlay
│   ├── services/
│   │   ├── formAdapters.js        # Universal Form Engine (Google Forms, Greenhouse, Lever, Generic)
│   │   └── memoryRetriever.js     # Client-side Hybrid RAG engine (BM25, intent, slots)
│   ├── options/
│   │   ├── options.html           # Memory Vault & Server Settings tabs
│   │   ├── options.css            # Responsive layout & theme styles
│   │   └── options.js             # Profile management & server diagnostics
│   └── popup/
│       ├── popup.html             # Sleek modern popup interface
│       ├── popup.js               # Popup controller & dynamic provider counter
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
   OPENROUTER_API_KEYS=sk-or-your_openrouter_key_here
   GEMINI_API_KEYS=AIzaSy_your_gemini_key_here
   GROQ_API_KEYS=gsk_your_groq_key_here
   NVIDIA_API_KEYS=nvapi-your_nvidia_key_here
   ```
3. Start the server:
   ```bash
   npm install
   npm start
   # Server runs on http://localhost:3000
   ```

*(In production, AutoForm AI runs on Render with automatic cloud discovery via `config/remote-config.json`).*

---

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

## 🧪 Testing Non-Google Forms with the Testbench

AutoForm AI includes a standalone universal testbench with tricky edge-cases (negative trick questions, native `<select>`, multi-select checkboxes, obfuscated containers, and technical essays):

1. Start the testbench server:
   ```bash
   npm run testbench
   ```
2. Open your browser and navigate to:
   ```text
   http://localhost:5000
   ```
3. Open the extension popup, verify that **`Web Form Detected`** is shown, and click **"Fill Current Form"**.
4. Click **"Grade My Quiz"** at the bottom to verify automated 100% scoring!

---

## 🎯 How to Use

### 1. Personalize Your Memory Vault
1. Click the AutoForm AI extension icon and select **Memory & Profile**.
2. Click **Copy Export Prompt** and send it to **ChatGPT**, **Gemini**, or **Claude**.
3. Paste the AI's response into the **Import Data** box and click **Parse & Save**.
4. Your identity, education, and career snippets are now ready for any form!

### 2. Fill Any Form
1. Open any [Google Form](https://docs.google.com/forms) or job application.
2. Click the floating **"⚡ AI Fill"** button on the bottom right (or click **"Fill Current Form"** from the popup, or press `Alt+Shift+F`).
3. Watch AutoForm AI intelligently complete all questions with real-time percentage progress!
4. Need to halt? Press the **Escape** key or click **"Stop & Cancel"** at any moment.

### 3. Server Diagnostics & Custom Endpoints
1. Open the extension Options page and switch to the **Server & Connection** tab.
2. Inspect your live ping latency (ms), active AI engines, and cloud config synchronization status.
3. Optionally configure your own self-hosted backend proxy URL or click **"Reset to Cloud Default"** anytime.

---

## 🛠️ Development & Testing

- **Run Server Resilience & Memory RAG Test Suite:**
  ```bash
  npm test
  # 110 tests across 25 suites passing 100%
  ```
- **Validate extension manifest & assets:**
  ```bash
  npm run validate
  ```
- **Package multi-browser release bundles (`dist/`):**
  ```bash
  npm run package
  # Generates dist/autoform-ai-edge.zip, dist/autoform-ai-firefox.zip, dist/autoform-ai.zip
  ```

---

## 🔒 Privacy & Security Guarantee

* **100% Local Storage:** Your Memory Vault data is stored exclusively in your browser's local `chrome.storage.local`.
* **Zero Telemetry / Tracking:** No user tracking, analytics, or behavioral cookies are collected.
* **Transient AI Payloads:** Only the specific memory context relevant to the active question is attached during inference. No personal databases are ever stored on cloud servers.
