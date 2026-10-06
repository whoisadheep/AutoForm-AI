# AutoForm AI — Store Reviewer Permissions & Host Justification

This document provides concise, one-sentence justifications for every permission and host requested by the AutoForm AI browser extension manifest (`manifest.json`), formatted specifically for Chrome Web Store, Microsoft Edge Add-ons, and Mozilla Add-ons (AMO) review teams.

---

## 1. API Permissions (`permissions`)

| Permission | One-Sentence Reviewer Justification |
| :--- | :--- |
| `scripting` | Required to programmatically execute autofill, DOM selection, and custom field binding scripts across dynamic single-page web forms and applicant tracking systems. |
| `activeTab` | Required to safely inspect the user's active form page and dispatch autofill commands only when explicitly invoked by user interaction (clicking the extension icon, popup buttons, or pressing Alt+Shift+F). |
| `storage` | Required to persist user account session tokens, local memory cards, pacing preferences, and UI settings locally within the browser. |
| `unlimitedStorage` | Required to store the user's resume file (PDF, Word, or plain text) locally as a binary Data URL without being blocked by the standard 5MB browser extension storage quota. |
| `identity` | Required to facilitate secure Google OAuth 2.0 authentication (`chrome.identity.launchWebAuthFlow`) so users can sign in and link their monthly form usage quota. |

---

## 2. Host Permissions (`host_permissions`)

| Host Pattern | One-Sentence Reviewer Justification |
| :--- | :--- |
| `https://docs.google.com/*` | Required to inspect question elements, radio groups, checkboxes, and text inputs on Google Forms to provide automated AI form filling. |
| `https://autoform-ai.onrender.com/*` | Required to securely communicate with the official production AutoForm AI backend proxy for API health checks, quota synchronization, and encrypted AI inference. |
| `https://raw.githubusercontent.com/*` | Required to fetch dynamic remote configuration, model status updates, and service announcements without requiring extension store updates. |

---

## 3. Data Collection Declarations (Firefox AMO)

Under `browser_specific_settings.gecko.data_collection_permissions`:
- **`required`**:
  - `personallyIdentifyingInfo`: Minimal user profile snippets (name, contact, education, experience anecdotes) matching the specific form question, transmitted ephemerally to zero-retention AI providers to generate answers.
  - `websiteContent`: Form question text, field names, and multiple-choice options transmitted ephemerally to AI providers to generate answers.
- **`optional`**:
  - `authenticationInfo`: Google account email, Google user ID (`sub`), and signed JWT session tokens for authentication and quota management, collected only when the user voluntarily signs in.
  - `financialAndPaymentInfo`: Razorpay Order ID, Payment ID, payment amount, and currency recorded to verify one-time Pro pass purchases, processed only when the user voluntarily upgrades.
  - `technicalAndInteraction`: Daily aggregate counts of on-device instant profile fills and technical diagnostics, transmitted only if the user explicitly enables the toggle in extension Options.

---

## 4. Compliance with Chrome Web Store Remote Code Execution Policy

AutoForm AI complies 100% with Chrome Web Store's policy prohibiting the execution of remotely hosted code:
- **No Dynamic Code Execution:** The extension never uses `eval()`, `new Function()`, `setTimeout(string)`, dynamic `import()`, or DOM `<script>` injection.
- **100% Local Bundled Logic:** All executable JavaScript, HTML templates, CSS styles, and content scripts are bundled directly inside the extension archive uploaded to the store.
- **Data-Only Remote Payloads:** Any data fetched over the network (`config/remote-config.json` hosted on GitHub and API responses from `https://autoform-ai.onrender.com/api/v1/*`) consists strictly of JSON data payloads (endpoint URL strings, boolean maintenance flags, numeric rate limit counters).
- **Safe DOM Text Rendering:** All text values received from remote configurations (e.g. maintenance alerts or service announcements) are rendered strictly via `element.textContent`, completely preventing HTML parsing or DOM-based script execution.

