# Privacy Policy for AutoForm AI

**Last Updated:** September 1, 2026  
**Developer:** whoisadheep (https://github.com/whoisadheep/AutoForm-AI)

AutoForm AI ("the Extension", "we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how our browser extension collects, processes, and protects your information.

---

## 1. Overview & Core Principles

- **No User Tracking:** We do not track your browsing history, identity, or personal behavior.
- **Zero Monetization of Data:** We do not sell, rent, or trade any user data to third parties or advertising networks.
- **Ephemeral AI Processing:** Form questions are processed strictly in real-time to generate responses and are not stored permanently.

---

## 2. Information We Process

### A. Form Data (Ephemeral Processing)
When you click **"Fill Current Form"** or trigger form solving, the extension reads the question text and available multiple-choice options on your active Google Form tab. This data is transmitted to our AI proxy server solely to compute the most accurate response and is discarded immediately after the response is returned.

### B. Local Extension Storage (`chrome.storage.local`)
The extension stores minimal configuration data locally on your device:
- **User Preferences:** Selected answer style (Accurate, Concise, Detailed) and optional persona context.
- **Anonymous Client Identifier:** A locally generated random UUID used solely for sliding-window rate limiting to prevent API abuse.

*This data remains on your local machine and is never uploaded to any centralized user database.*

---

## 3. Third-Party AI Services

To provide real-time inference, question data is proxied through secure enterprise AI APIs:
- **Groq Inc.** (Llama 3 models)
- **Google Cloud / Google AI** (Gemini models)
- **NVIDIA NIM** (Meta Llama models)

All API transmissions use TLS/HTTPS encryption. None of our integrated providers use user prompt data to train foundational models under standard commercial API terms.

---

## 4. Permissions Requested & Justification

| Permission | Justification |
|:---|:---|
| `activeTab` | Required to detect whether the current tab is a Google Form and interact with form fields upon user request. |
| `scripting` | Required to execute the automation engine that selects answers and inputs text on the form. |
| `storage` | Required to persist your local user preferences (such as answer tone and persona). |
| `host_permissions` | Required to communicate with Google Forms (`https://docs.google.com/forms/*`) and our secure inference backend. |

---

## 5. Data Security

All network communications between the browser extension, the backend proxy, and AI providers are encrypted in transit using industry-standard **HTTPS / TLS 1.3**.

---

## 6. Children's Privacy

AutoForm AI does not knowingly collect or solicit any personal information from children under the age of 13.

---

## 7. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be published in this repository and reflected in future extension updates.

---

## 8. Contact Us

If you have any questions or feedback regarding this Privacy Policy, please open an issue or reach out via our GitHub repository:
- **GitHub:** [https://github.com/whoisadheep/AutoForm-AI](https://github.com/whoisadheep/AutoForm-AI)
