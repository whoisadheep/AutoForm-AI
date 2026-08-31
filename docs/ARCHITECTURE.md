# AutoForm AI v2.0 Architecture & Design Specification

AutoForm AI v2.0 is a production-ready, zero-configuration form automation ecosystem consisting of a universal browser extension (MV3) and an intelligent multi-provider backend proxy.

---

## 1. System Architecture Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Popup as Extension Popup (popup.js)
    participant Content as Content Script (content.js)
    participant BG as Background Service Worker (background.js)
    participant Server as Backend Proxy (server/src/index.js)
    participant Router as Provider Router (router.js)
    participant AI as Groq / Gemini / NVIDIA

    User->>Content: Clicks "⚡ AI Fill" (or "Fill Current Form" in Popup)
    Content->>Content: Extract questions & show modern progress modal (0%)
    
    loop For each unsolved question
        Content->>BG: chrome.runtime.sendMessage("SOLVE_SINGLE_QUESTION", questionData)
        BG->>Server: POST /api/v1/solve { clientId, question, type, choices, tone, customContext }
        Server->>Server: Rate Limiter (sliding window) & Input Sanitization
        Server->>Router: route(questionData)
        
        alt Primary Provider (Groq Llama-3.3)
            Router->>AI: POST Groq /v1/chat/completions (~250ms)
            AI-->>Router: JSON answer
        else Failover: Secondary Provider (Google Gemini)
            Router->>AI: POST Gemini generateContent (~600ms)
            AI-->>Router: JSON answer
        else Failover: Tertiary Provider (NVIDIA NIM)
            Router->>AI: POST NVIDIA NIM /v1/chat/completions
            AI-->>Router: JSON answer
        end

        Router-->>Server: Result { answer, provider, latencyMs }
        Server-->>BG: HTTP 200 { success: true, answer, provider, latencyMs }
        BG-->>Content: Response { success: true, answer, provider, latencyMs }
        
        Content->>Content: Locate matching widget (ARIA / label / input)
        Content->>Content: Dispatch synthetic events (click / input / change / blur)
        Content->>Content: Update Progress UI (% bar, question preview, provider badge)
        Content->>Content: Responsive non-blocking sleep (800ms)
    end
    
    Content->>User: Update progress to 100% & display completion toast notification
```

---

## 2. Component Breakdown

### 1. `server/` (Production Multi-Provider Proxy)
- **Zero Client Keys:** API keys reside exclusively in server environment variables.
- **Provider Adapters:**
  - `src/providers/groq.js`: High-speed Llama 3.3 inference (~200-300ms).
  - `src/providers/gemini.js`: Google Gemini 2.5 Flash Lite multimodal reasoning.
  - `src/providers/nvidia.js`: NVIDIA NIM enterprise hosted models.
- **Failover Router (`src/services/router.js`):** Automatically detects `429`/`503`/timeout errors and tries alternative providers in priority order without user intervention.
- **Sliding-Window Rate Limiter (`src/middleware/rateLimiter.js`):** Manages per-client hourly quotas with automatic memory cleanup.

### 2. `src/content/content.js` (DOM Engine & UI)
- **Resilient ARIA Selector Strategy:** Queries `div[role="listitem"]`, `[role="heading"]`, and `[role="radio"]` / `[role="checkbox"]` with `data-value` resolution to survive Google Forms theme changes.
- **Modern Progress Overlay:** Displays live percentage completion, current question snippet, and active provider badge.
- **Cancellation:** Supports immediate cancellation via the overlay button, floating button, popup, or `Escape` key.

### 3. `src/popup/` (User Interface)
- **Zero-Config Dashboard:** Automatically detects active Google Forms with real-time question count badges.
- **Tone & Persona Customization:** Allows users to adjust answer verbosity and custom context.
- **Custom Server Support:** Expandable settings allow pointing the extension to any hosted proxy or switching to direct BYOK mode.

---

## 3. Communication Protocols

| Message Action | Source | Target | Payload | Response |
|:---|:---|:---|:---|:---|
| `START_SOLVING` | Popup | Content | `{}` | `{ success: true, isSolving: true }` |
| `STOP_SOLVING` | Popup | Content | `{}` | `{ success: true, isSolving: false }` |
| `GET_SOLVER_STATUS` | Popup | Content | `{}` | `{ isSolving: boolean, questionCount: number }` |
| `CHECK_SERVER_HEALTH` | Popup | Background | `{}` | `{ success: boolean, data: object }` |
| `SOLVE_SINGLE_QUESTION` | Content | Background | `{ id, question, type, choices }` | `{ success: true, answer, answers, provider, latencyMs }` |
