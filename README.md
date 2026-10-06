# AutoForm AI ⚡ (v2.0.5 Production)

> Fill job applications and forms faster with multi-provider AI, local memory, and smart resume auto-attach across Chrome, Firefox, Edge, and mobile extension browsers.

AutoForm AI is a cross-browser extension backed by a high-throughput proxy server that intelligently coordinates **Groq (Llama 3.3)**, **Google Gemini**, **OpenRouter**, and **NVIDIA NIM** with automatic failover, sub-second latency, and a privacy-first **Local Memory Vault** that remembers your personal profile and experiences without sending personal databases to the cloud.

---

## ✨ Features

- **⚡ Zero-Config & Instant:** Install and start filling forms immediately — no API keys or setup wizards required for end-users.
- **📄 Smart Resume Vault & Universal File Auto-Attach (`<input type="file">`):**
  - **Drag-and-Drop Resume Ingestion:** Upload resumes in PDF, Word (.docx), or plain text format directly in the extension Options page.
  - **Dual-Path AI & Heuristic Parser:** Server-assisted LLM extraction (`POST /api/v1/parse-resume`) automatically parses identity, contact links, education, and career memory snippets, with instant client-side offline regex fallback.
  - **Native Local Binary Storage:** Stores the file safely in `chrome.storage.local` with `unlimitedStorage` permissions — zero cloud database footprint.
  - **Universal ATS File Injection:** Automatically detects resume/CV upload fields across Greenhouse, Lever, Workday, Ashby, and generic HTML forms, reconstructing native `File` objects via the HTML5 `DataTransfer` API and triggering React/Vue synthetic events.
  - **Preview & Verification:** Shows a dedicated resume file card with filename, file size, download button, and auto-attach status in the preview modal.
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
  - Fills recognized fields in 0ms client-side without consuming monthly AI form fill quota or incurring network latency.
  - Dedicated **"Instant Profile Fill"** button in popup for immediate one-click autofill of personal details.
- **⏩ Configurable Fill Pacing & Speed:**
  - **Turbo** (~150ms delay): Ultra-fast automation for high-volume tasks.
  - **Natural** (~800ms delay): Balanced default with authentic pacing.
  - **Slow** (~1.5s delay): Relaxed pacing for easy visual verification.
- **⌨️ Global Keyboard Shortcut:**
  - Press **`Alt+Shift+F`** (or **`Option+Shift+F`** on macOS) on any supported form to toggle AutoForm AI filling instantly without opening the extension popup.
- **🌐 Whole-Form Understanding & Multi-Question Reasoning:**
  - **Macro Form Synthesis:** Scrapes the form title, description, and full question outline before filling, classifying form intent (`Job Application`, `Academic`, `Survey`, `Event RSVP`, `General Form`) to align answers with the form's overarching goal.
  - **Rolling Answer History & Cross-Question Consistency:** Tracks previously answered questions on the active form so downstream answers never contradict earlier choices, roles, dates, or tools.
  - **Experience & Story Deduplication:** Tracks used memory snippets across open-ended essay questions so the AI showcases distinct experiences rather than repeating the same anecdote.
- **🧠 Local Memory Vault & Hybrid RAG Engine:**
  - **Local-First Privacy:** Stored exclusively in browser `chrome.storage.local`.
  - **1-Click AI Memory Export:** Instant prompt helper to export memories from **ChatGPT**, **Gemini**, or **Claude** directly into AutoForm AI.
  - **Smart Parser:** Automatically extracts contact details, URLs, academic history, and categorizes memory snippets (`experience`, `project`, `skill`, `perspective`).
  - **Intent Classification & BM25 Scoring:** Ranks and injects the most relevant profile facts and stories per question.
  - **Choice Cross-Referencing:** Calculates academic levels (Freshman–Senior) and matches degree / skill options directly against choices.
- **🤖 Resilient Multi-Provider AI Routing (Failover Priority Chain):**
  - **Laya Offline Engine:** Embedded lightweight neural classifier for instant offline question handling.
  - **Groq** (`llama-3.3-70b-versatile`): Sub-300ms ultra-fast primary inference. Zero data retention by default, no training on API data.
  - **Google Gemini** (`gemini-2.5-flash`): High-accuracy multimodal reasoning via `x-goog-api-key`.
  - **OpenRouter Free Tier:** Secondary fallback for general non-personal questions (`liquid/lfm-2.5-2.6b:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`).
  - **NVIDIA NIM** (`meta/llama-3.3-70b-instruct`): Enterprise backup fallback for general questions.
- **🛡️ Circuit Breaker & Key Cooldowns:** 3-state circuit breaker (`CLOSED`/`OPEN`/`HALF_OPEN`) with canary auto-recovery prevents cascading timeouts, while intelligent 429 key cooldowns guarantee 100% uptime across rate spikes.
- **🧪 Universal Edge-Case Testbench:**
  - Built-in local form testbench (`npm run testbench` on `http://localhost:5000`) designed to stress-test non-Google forms, trick negative questions, native `<select>` dropdowns, multi-select checkboxes, obfuscated DOM wrappers, and open-ended technical essays with automated verification.
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
│   ├── tests/                     # Automated test suites (134 tests, 31 suites)
│   │   ├── apiSecurity.test.js    # Security headers & /config endpoint tests
│   │   ├── circuitBreaker.test.js
│   │   ├── formAdapters.test.js   # Universal Form Engine unit tests
│   │   ├── keyRotator.test.js
│   │   ├── laya.test.js
│   │   ├── memoryRetriever.test.js# Hybrid RAG & slot resolution tests
│   │   ├── openrouter.test.js
│   │   ├── previewConfidence.test.js # Confidence heuristics & preview tests
│   │   ├── resumeUpload.test.js   # Resume extraction & file injection tests
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
│   │   └── background.js          # Service worker, remote config discovery & API client
│   ├── content/
│   │   └── content.js             # Form scraping, DOM automation & UI overlay
│   ├── services/
│   │   ├── formAdapters.js        # Universal Form Engine (Google Forms, Greenhouse, Lever, Generic)
│   │   ├── memoryRetriever.js     # Client-side Hybrid RAG engine (BM25, intent, slots)
│   │   └── resumeExtractor.js     # Multi-format resume parser & file auto-attacher
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
4. Click **"Submit & Verify"** on the testbench to verify automated form completion!

---

## 🎯 How to Use

### 1. Upload Your Resume or Personalize Memory Vault
1. Click the AutoForm AI extension icon and select **Memory & Profile**.
2. **Instant Resume Upload:** Drag and drop your resume (PDF, Word `.docx`, or `.txt`) into the **Smart Resume Vault**. The AI extracts your contact links, identity, education, and career achievements into your memory vault, and stores your resume binary locally.
3. **Alternative Manual / AI Export:** Click **Copy Export Prompt** and send it to **ChatGPT**, **Gemini**, or **Claude**, then paste the response into the **Import Data** box.
4. Your identity, education, career snippets, and resume attachment are now ready for any job board or form!

### 2. Fill Any Form
1. Open any [Google Form](https://docs.google.com/forms) or job application (Greenhouse, Lever, Workday, etc.).
2. Click the floating **"⚡ AI Fill"** button on the bottom right (or click **"Fill Current Form"** from the popup, or press `Alt+Shift+F`).
3. AutoForm AI automatically analyzes form fields, generates answers tailored to your profile, detects resume upload fields, attaches your stored resume via native HTML5 file binding, and presents the human-in-the-loop preview modal for quick review!
4. Review answers, adjust any flagged items, and apply with 1 click (`Ctrl + Enter`).
5. Need to halt? Press the **Escape** key or click **"Stop & Cancel"** at any moment.

### 3. Server Diagnostics & Custom Endpoints
1. Open the extension Options page and switch to the **Server & Connection** tab.
2. Inspect your live ping latency (ms), active AI engines, and cloud config synchronization status.
3. Optionally configure your own self-hosted backend proxy URL or click **"Reset to Cloud Default"** anytime.

---

## 🛠️ Development & Testing

- **Run Server Resilience & Memory RAG Test Suite:**
  ```bash
  npm test
  # 213 tests across 59 suites passing 100% (PostgreSQL & in-memory)
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

## 🔒 Privacy & Data Practices

* **Inference Payloads & Data Sensitivity:** When you use AI-assisted filling, each request transmits two categories of data: (1) **Website content** (question text and choices), and (2) **Personally Identifiable Information (PII)** (only the relevant profile context required to answer it, such as name, contact, education, and specific experience anecdotes). AutoForm AI never sends your whole profile at once. Any request containing personal context is strictly restricted to zero-retention routes (Groq with Zero Data Retention enabled; or paid Gemini). Groq does not retain inference data by default, may keep reliability/abuse logs for up to 30 days unless Zero Data Retention is enabled in Data Controls, and does not train on API data. General non-personal questions can fail over to Gemini, OpenRouter, and NVIDIA NIM. We never log or store question text, form answers, form URLs, or profile documents on the server.
* **User Accounts & Form Counting:** When you sign in with Google, your account email is stored to manage your account and authentication session. To enforce the monthly free quota (10 forms/month) and Pro usage limits, form fill counts, form categories (e.g. Google Forms, Greenhouse, Lever, Generic), and limit-hit events (when a limit is reached) are recorded and linked to your account. Form counting is required for quota enforcement.
* **Optional Daily Instant-Fill Summary:** The existing "Instant Profile Fill" feature runs entirely on-device and is free and unlimited. The Options page provides a switch to share a daily aggregate count of instant fills linked to your account to help us monitor adapter reliability across different websites.
* **Temporary Legacy IP Abuse Counters (Deleted within 7 Days):** For backward-compatibility requests from older extension versions without Google authentication, temporary IP-based abuse counters are tracked by storing a one-way HMAC-SHA256 cryptographic hash of the client IP (salted with a private server secret). Raw IP addresses are never stored in the database, and all IP counter records are automatically deleted within 7 days.
* **Payment Processing:** Pro passes are processed securely by Razorpay. We store only standard payment metadata (Order ID, Payment ID, payment status, amount, currency, and entitlement dates). We never receive or store payment card numbers, bank credentials, or UPI PINs.
* **Full Data Control:** You can delete your account and all associated server usage records anytime via the Options page or by calling `DELETE /api/v1/auth/me`. You can also clear all local browser data in one click.
