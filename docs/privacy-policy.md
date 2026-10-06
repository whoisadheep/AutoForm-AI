# Privacy Policy for AutoForm AI

**Last Updated:** [LAST UPDATED DATE]  
**Developer / Maintainer:** [YOUR FULL NAME]  
**Contact:** [YOUR CONTACT EMAIL]  
**Location:** [YOUR CITY, STATE, COUNTRY]  
**Website / Repository:** https://github.com/whoisadheep/AutoForm-AI

---

## 1. Overview & Commitment

AutoForm AI ("the Extension", "we", "us", or "our") is designed to help job applicants and individuals fill web forms and job applications faster with AI assistance and local memory. We are committed to transparency and data minimization.

This Privacy Policy explains what information is collected, how it is processed, where it is stored, and how you maintain full control over your data.

---

## 2. Information We Store Locally on Your Device

AutoForm AI uses a **local-first architecture**. The following information is stored directly on your personal computer in browser local storage (`chrome.storage.local`) and is **never stored in a central user profile database on our servers**:

1. **Profile Data & Personal Links:** Full name, phone number, address/location, academic history (university, degree, major, graduation year, GPA), LinkedIn URL, GitHub URL, portfolio URL, and other personal links you enter.
2. **Resume Documents:** Resume files you import (PDF, Word `.docx`, or plain text) are converted to a binary Data URL and stored exclusively in your local browser storage (`unlimitedStorage`).
3. **Memory Cards & Career Snippets:** Work experiences, project summaries, technical skills, and custom stories that you add or import.
4. **Local Extension Preferences:** Pacing speed (Turbo, Natural, Slow), answer style (Accurate, Concise, Detailed), floating button visibility, excluded website domains, and custom context.

---

## 3. Account Information & Authentication

When you choose to sign in to AutoForm AI:
- **Google Sign-In:** We use Google OAuth 2.0 via `chrome.identity.launchWebAuthFlow`. When you authenticate, we retrieve and store your **Google account email address** and unique Google subject identifier (`sub`).
- **Session Tokens:** Our backend issues a secure signed session token (JWT) to authenticate subsequent form fill requests from the extension.
- **Purpose:** Your email address is stored exclusively to manage your user account, verify active Pro entitlements, and enforce monthly usage quotas. We never access your Google contacts, Google Drive, emails, or calendar.

---

## 4. How Form Questions, Personal Context, and AI Inference Work

When you trigger AI-assisted form filling on a webpage:
1. **Transmitted Data Categories:** Each AI inference request transmits two categories of data:
   - **Website Content:** The form's question text, field type, and available choices.
   - **Personally Identifiable Information (PII):** Only the specific memory snippets from your local profile that are directly relevant to the question (such as your full name, contact information, education history, portfolio links, or matching work and project experience anecdotes). AutoForm AI never transmits your entire profile or database; only minimal, question-matched context is injected dynamically.
2. **Encrypted Ephemeral Transmission:** This context is transmitted securely over TLS 1.3 to our backend proxy server (`https://autoform-ai.onrender.com/api/v1/solve`) and routed to upstream AI inference providers. **We never log, retain, or store question text, form URLs, answers, or profile documents on our servers.**
3. **Third-Party AI Inference Providers & Model Training Policies:**
   - **Groq Inc. ([api.groq.com](https://groq.com/privacy-policy/)):** Primary provider. Groq does not retain inference data by default, may keep reliability/abuse logs for up to 30 days unless Zero Data Retention is enabled in Data Controls, and does not train on API data. See [Groq Data Controls](https://console.groq.com/docs/data-controls).
   - **Google Gemini API ([generativelanguage.googleapis.com](https://ai.google.dev/gemini-api/terms)):** When configured with a paid Google Cloud project billing account, Google does not train models on customer API requests. Under free/unpaid Google AI Studio trial tiers, Google's terms specify that prompts and responses may be reviewed by human annotators and used to train Google models.
   - **OpenRouter ([openrouter.ai](https://openrouter.ai/privacy)):** Secondary fallback for general non-personal questions. OpenRouter itself does not train, but certain free upstream model hosts have independent retention policies.
   - **NVIDIA NIM ([integrate.api.nvidia.com](https://www.nvidia.com/en-us/agreements/enterprise-software/api-trial-terms/)):** Trial catalog terms note that prompts may be retained to improve NVIDIA products. Used exclusively as an optional fallback for non-personal questions.
4. **Data-Sensitivity Routing Rule:** Any form filling request that contains user profile or personal memory context (PII) is strictly restricted to zero-retention routes (Groq with Zero Data Retention enabled; or paid Gemini with billing enabled). If no zero-retention provider is available, AutoForm AI halts and returns a retryable error instead of falling back to secondary non-zero-retention providers.

---

## 5. Usage Limits, Counting, and Telemetry

To operate a sustainable free tier and prevent automated abuse:
- **Form Usage Counting:** To enforce the monthly free quota (10 AI-assisted forms per calendar month in IST) and Pro fair-use caps, our server records form fill events linked directly to your user account. Each event records only:
  - Your user account ID
  - The broad form category (e.g., `google_forms`, `greenhouse`, `lever`, or `generic`)
  - A success or failure status flag
  - Timestamp of the session
- **Limit-Hit Events:** When an account reaches its 10-form monthly free limit or daily solve limit, the server records a lightweight limit-hit event (user ID, date) to track quota exhaustion. Form counting is required for quota enforcement.
- **No Question or Content Logging:** Form counting records only the high-level category of the form adapter. Question text, answers, field names, and URLs are never recorded.
- **Instant Profile Fill (Free & Unlimited):** Instant Profile Fill operates entirely on-device without contacting AI models and is completely free and unlimited.
- **Optional Daily Summary Switch:** The Options page includes a setting titled *"Share daily instant-fill counts"*. When enabled, the extension sends a single aggregate count of daily on-device instant profile fills linked to your account to help us monitor form adapter compatibility across web standards. If disabled, no instant-fill counts are sent. Form counting for AI fills remains active to enforce monthly quotas.
- **Guest Trial Enforcement:** The server allows two guest form sessions per network in a rolling 30-day period. It stores only a one-way HMAC-SHA256 hash of the client IP and a random session identifier; raw IP addresses, questions, answers, and URLs are not stored. People sharing a network share this guest allowance. Expired trial hashes are removed after 30 days. Daily guest solve abuse counters remain separate and are deleted within 7 days.
- **Temporary Legacy IP Abuse Counters (Deleted within 7 Days):** For backward-compatibility requests from older extension versions without Google authentication, temporary IP-based abuse counters are tracked by storing a one-way HMAC-SHA256 cryptographic hash of the client IP (salted with a private server secret). Raw IP addresses are never stored in the database, and all IP counter records are automatically deleted within 7 days.

---

## 6. Payments and Entitlements

Paid passes (such as the 14-day, 30-day, or 90-day Pro access passes) are processed securely through **Razorpay**:
- **Payment Processing:** When purchasing a pass, transactions take place directly on Razorpay's PCI-DSS compliant checkout. We never receive, process, or store your credit/debit card numbers, bank credentials, or UPI PINs.
- **Entitlement Records:** Upon payment capture or verification, our server records your Razorpay Order ID, Razorpay Payment ID, payment status, payment amount, currency, and the start and expiration timestamps of your Pro entitlement linked to your user account ID.

---

## 7. Your Data Rights & Complete Account Deletion

You have complete control over your personal data:
- **Local Data Deletion:** You can delete all locally stored profile details, resumes, and memory cards at any time by clicking **"Clear All Memory"** in the extension Options page.
- **Server Account & Data Deletion:** You can permanently delete your user account, stored email, and all associated usage records from our server at any time:
  - Click the **"Delete Account"** button under *Privacy & Data Controls* in the extension Options page, or
  - Submit an authenticated request to `DELETE /api/v1/auth/me`.
  - Upon deletion, your user record, email, and linked usage history are permanently erased from our database.
- **Contact Request:** You may also email `[YOUR CONTACT EMAIL]` to request manual deletion of any account records.

---

## 8. Third-Party Services & Links

AutoForm AI integrates with the following third-party infrastructure providers:
- **Google Cloud Platform:** OAuth 2.0 authentication and Gemini AI inference API.
- **Groq Inc.:** Fast inference processing via Groq API.
- **OpenRouter & NVIDIA NIM:** Secondary and enterprise AI inference fallback.
- **Razorpay Payments:** Payment gateway for one-time Pro passes.
- **Hosting Provider (Render):** Backend server hosting with TLS 1.3 encryption.

---

## 9. Security

All communication between the extension, backend proxy, and AI providers occurs over encrypted **HTTPS (TLS 1.3)**. The server implements strict HTTP security headers (`nosniff`, `X-Frame-Options: DENY`, HSTS) and protects against injection.

---

## 10. Children's Privacy

AutoForm AI is intended for individuals applying for jobs, internships, or completing standard web forms. We do not knowingly collect personal information from individuals under the age of 13.

---

## 11. Contact Information

If you have questions, concerns, or requests regarding this Privacy Policy or your data, please contact:

- **Name:** [YOUR FULL NAME]  
- **Email:** [YOUR CONTACT EMAIL]  
- **Location:** [YOUR CITY, STATE, COUNTRY]  
- **GitHub Repository:** [https://github.com/whoisadheep/AutoForm-AI](https://github.com/whoisadheep/AutoForm-AI)
