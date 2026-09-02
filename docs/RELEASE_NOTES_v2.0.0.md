# 🚀 AutoForm AI v2.0.0 — Official Release Notes

We are thrilled to introduce **AutoForm AI v2.0.0**, a complete architectural overhaul and redesign that turns AutoForm AI into a zero-config, ultra-fast, cross-browser AI assistant for Google Forms.

---

## 🌟 What's New in v2.0.0

### 1. ⚡ Zero-Config Architecture (No API Keys Needed)
- **Instant Onboarding:** End users no longer need to generate, copy, or paste Google AI Studio API keys.
- **Cloud Proxy Backend:** Inference is securely proxied through an intelligent backend server hosted on Railway with automatic load distribution.

### 2. 🧠 Multi-Provider AI Engine & Self-Healing Failover
- **Tri-Engine Routing:** Seamlessly balances and routes requests across:
  - **Groq Inc.** (`llama-3.1-8b-instant`, `openai/gpt-oss-120b`) — sub-200ms ultra-fast inference.
  - **Google Gemini** (`gemini-3.5-flash-lite`, `gemini-2.5-flash`) — high-accuracy semantic reasoning.
  - **NVIDIA NIM** (`meta/llama-3.3-70b-instruct`) — deep STEM, math, and logic processing.
- **Self-Healing Model Fallback:** Automatically detects model deprecations or HTTP `404`/`410` errors and cascades through active models with zero downtime.

### 3. 🎨 Modern Inspector UI/UX Redesign
- **Figma & DevTools Aesthetic:** Clean, distraction-free light interface built with crisp borders, soft diffused elevation, and Royal Violet (`#7241ff`) accents.
- **Zero Distractions:** Completely eliminated all emojis and colored dots in favor of clean typographic status indicators (`Ready`, `Checking`, `Offline`).
- **In-Page Redesign:** Redesigned floating page pill and progress modal overlay with real-time percentage indicators.

### 4. 📱 Full Tablet & Smartphone Responsiveness
- **Adaptive Layouts:** Fluid responsiveness across desktop, tablets (iPad, Galaxy Tab), and smartphones (Firefox for Android, Kiwi).
- **Touch Accessible:** Standard 44px touch targets and safe area insets (`env(safe-area-inset)`) to avoid collisions with gesture bars or virtual keyboards.
- **Smart Sizing:** Prevents unwanted mobile zoom on form controls with calibrated font sizes.

### 5. 🌐 Universal Cross-Browser Compatibility (Manifest V3)
- **Official Store Bundles:** Dedicated releases for **Microsoft Edge**, **Google Chrome**, and **Mozilla Firefox**.
- **Firefox AMO Certified:** Strict compliance with Mozilla's `strict_min_version: "142.0"` and built-in `data_collection_permissions`.
- **Enhanced Security:** 100% eliminated dynamic `innerHTML` calls across all content and popup scripts in favor of safe DOM methods.

### 6. 🔒 Privacy by Design
- Zero tracking or user profiling.
- Form questions and answers are processed ephemerally in real-time and never saved or sold.

---

## 📦 Store & Release Assets

- **Microsoft Edge Store Package:** `dist/autoform-ai-edge.zip`
- **Chrome Web Store Package:** `dist/autoform-ai-chrome.zip`
- **Mozilla Firefox AMO Package:** `dist/autoform-ai-firefox.zip`
- **Universal Package:** `dist/autoform-ai.zip`

---

**Full Changelog**: https://github.com/whoisadheep/AutoForm-AI/commits/v2.0.0
