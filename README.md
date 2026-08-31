# AutoForm AI ⚡ (v2.0 Production)

> Zero-config, multi-provider AI assistant to automatically solve and fill Google Forms across Chrome, Firefox, and Edge.

AutoForm AI is a cross-browser extension backed by a high-throughput proxy server that intelligently coordinates **Groq (Llama 3)**, **Google Gemini**, and **NVIDIA NIM** with automatic failover, sub-second latency, and zero setup required for end users.

---

## ✨ Features

- **⚡ Zero-Config & Instant:** Users install the extension and start filling forms immediately — no API keys or setup wizards required.
- **🧠 Multi-Provider AI Engine:**
  - **Groq** (`llama-3.3-70b-versatile`): Sub-300ms ultra-fast inference (Primary).
  - **Google Gemini** (`gemini-2.5-flash-lite`): High-accuracy multimodal reasoning (Secondary).
  - **NVIDIA NIM** (`meta/llama-3.1-70b-instruct`): Enterprise backup fallback.
- **🔄 Auto-Failover & Health Monitoring:** If a provider experiences rate limits (`429`) or errors, the router automatically fails over to the next provider seamlessly.
- **🌐 Universal Cross-Browser Compatibility:** Ready for **Google Chrome**, **Mozilla Firefox**, and **Microsoft Edge** on Manifest V3.
- **🎨 Modern Dark UI/UX:**
  - Redesigned popup with live form scanner and question counter.
  - Interactive modal overlay with real percentage progress bar, question preview, and instant **"Stop & Cancel"** button.
  - Floating pill action button directly on Google Forms.
- **🎯 Smart Preferences:** Customize answer tone (Accurate, Concise, Detailed) or supply persona context (e.g., "Computer Science student").
- **🛡️ Rate-Limited & Secure:** Keys are protected on the backend; users receive generous hourly quotas with client-side rate limit tracking.

---

## 📂 Project Architecture

```text
AutoForm-AI/
├── manifest.json              # Universal Manifest V3 (Chrome, Firefox, Edge)
├── package.json               # Root scripts & extension bundler
├── AGENTS.md                  # Comprehensive AI/LLM developer guide
│
├── server/                    # Production Backend Proxy Server
│   ├── package.json           # Express, CORS, Dotenv
│   ├── Dockerfile             # Production container definition
│   ├── railway.json           # 1-click Railway deploy template
│   ├── render.yaml            # 1-click Render deploy template
│   ├── .env.example           # Server environment template
│   └── src/
│       ├── index.js           # Express API server entry point
│       ├── config.js          # Multi-provider configuration & key parser
│       ├── providers/         # Provider adapters (Groq, Gemini, NVIDIA)
│       ├── services/          # Multi-provider router & failover engine
│       └── middleware/        # Sliding-window rate limiter & validator
│
├── src/                       # Browser Extension
│   ├── background/
│   │   └── background.js      # Service worker & backend communication bridge
│   ├── content/
│   │   └── content.js         # Google Forms DOM automation & modern UI overlay
│   └── popup/
│       ├── popup.html         # Sleek modern popup interface
│       ├── popup.js           # Popup controller & form detector
│       └── popup.css          # Dark minimalist styling
│
├── docs/
│   ├── ARCHITECTURE.md        # Mermaid sequence diagrams & architecture specs
│   └── SELECTORS.md           # Google Forms ARIA DOM selector dictionary
│
└── scripts/
    ├── validate_manifest.js   # Manifest & file path validator
    └── package_extension.js   # Release zip packager
```

---

## 🚀 Quickstart

### 1. Start the Backend Proxy Server

1. Navigate to the `server/` directory:
   ```bash
   cd server
   cp .env.example .env
   ```
2. Open `.env` and add your API keys (supports comma-separated keys for multi-key rotation):
   ```env
   GROQ_API_KEYS=gsk_your_groq_key_here
   GEMINI_API_KEYS=AIzaSy_your_gemini_key_here
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

1. Open any [Google Form](https://docs.google.com/forms).
2. Click the floating **"⚡ AI Fill"** button on the bottom right (or click **"Fill Current Form"** from the extension popup).
3. Watch AutoForm AI intelligently complete all questions with real-time percentage progress!
4. Need to halt? Press the **Escape** key or click **"Stop & Cancel"** at any moment.

---

## ☁️ 1-Click Cloud Deployment

Deploy the backend to the cloud for free with zero maintenance:

| Platform | Deployment Guide |
|:---|:---|
| **Railway** | Connect your GitHub repository → Railway will automatically detect `server/railway.json`. Set environment variables in the Railway dashboard. |
| **Render** | Create a new Web Service pointing to `server/` with Node environment. Uses `server/render.yaml`. |
| **Docker** | `docker build -t autoform-ai-server server/` then `docker run -p 3000:3000 --env-file server/.env autoform-ai-server` |

Once deployed, update the **Backend Proxy URL** in the extension popup's Advanced Settings (or set `DEFAULT_SERVER_URL` in `src/background/background.js`).

---

## 🛠️ Development & NPM Scripts

- **Start backend in watch mode:**
  ```bash
  npm run server:dev
  ```
- **Validate extension manifest:**
  ```bash
  npm run validate
  ```
- **Package extension for release (`dist/autoform-ai.zip`):**
  ```bash
  npm run package
  ```

---

## 📄 License

MIT © [whoisadheep](https://github.com/whoisadheep)
