/**
 * @file src/background/background.js
 * @description Background service worker for AutoForm AI v2.0.
 * Handles backend proxy requests, client identity management, and direct API fallback.
 */

// Backend Proxy Endpoints
const LOCAL_SERVER_URL = "http://localhost:3000";
const HARDCODED_FALLBACK_URL = "https://autoform-ai.onrender.com";
const REMOTE_CONFIG_URL = "https://raw.githubusercontent.com/whoisadheep/AutoForm-AI/main/config/remote-config.json";
const CONFIG_CACHE_KEY = '_remoteConfig';
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours default, overridable by server

// Security: Allow-list of approved domain origins for remote configuration.
// Extensions must only fetch config from verified, authoritative AutoForm AI sources.
const ALLOWED_REMOTE_CONFIG_ORIGINS = [
    'https://raw.githubusercontent.com/whoisadheep/AutoForm-AI/',
    'https://whoisadheep.github.io/AutoForm-AI/',
    'https://autoform-ai.onrender.com/'
];

/**
 * Validates that a remote config URL strictly belongs to an approved domain origin.
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedRemoteConfigUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        return ALLOWED_REMOTE_CONFIG_ORIGINS.some(allowed => url.startsWith(allowed));
    } catch {
        return false;
    }
}

/**
 * Validates that a backend proxy server URL has an allowed protocol and structure.
 * @param {string} url
 * @returns {boolean}
 */
function isValidServerUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:') return true;
        if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
        return false;
    } catch {
        return false;
    }
}

// Load MemoryRetriever Hybrid RAG Engine
if (typeof importScripts === 'function') {
    try {
        importScripts('../services/memoryRetriever.js');
    } catch (e) {
        try {
            importScripts('src/services/memoryRetriever.js');
        } catch (e2) {
            console.warn('[AutoForm] memoryRetriever load error:', e2.message);
        }
    }
}

// Load AuthService (Cloud Auth, Quota & Review Engine)
if (typeof importScripts === 'function') {
    try {
        importScripts('../services/authService.js');
    } catch (e) {
        try {
            importScripts('src/services/authService.js');
        } catch (e2) {
            console.warn('[AutoForm] authService load error:', e2.message);
        }
    }
}

// ---------------------------------------------------------------------------
// Remote Configuration System
// Fetches backend URL from GitHub-hosted config, caches locally, and falls back
// gracefully. Allows server migrations without extension store updates.
// ---------------------------------------------------------------------------

/**
 * Fetches and caches the remote configuration from GitHub.
 * Returns cached config if fresh, otherwise fetches new config.
 * @returns {Promise<Object|null>} Remote config object or null if unavailable
 */
async function fetchRemoteConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([CONFIG_CACHE_KEY], async (stored) => {
            const cached = stored[CONFIG_CACHE_KEY];
            const now = Date.now();

            // Use cache if fresh
            if (cached && cached.fetchedAt && (now - cached.fetchedAt) < (cached.configTtlMs || CONFIG_TTL_MS)) {
                return resolve(cached);
            }

            // Fetch fresh config from GitHub
            if (!isAllowedRemoteConfigUrl(REMOTE_CONFIG_URL)) {
                console.error('[AutoForm Security] Blocked remote config fetch: URL is not in allowed domain list:', REMOTE_CONFIG_URL);
                return resolve(cached || null);
            }

            try {
                const res = await fetch(REMOTE_CONFIG_URL, {
                    signal: AbortSignal.timeout(5000),
                    cache: 'no-cache'
                });
                if (res.ok) {
                    const config = await res.json();
                    const enriched = {
                        ...config,
                        fetchedAt: now,
                        configTtlMs: (config.configTtlMinutes || 360) * 60 * 1000
                    };
                    chrome.storage.local.set({ [CONFIG_CACHE_KEY]: enriched });
                    console.log('[AutoForm] Remote config synced:', config.activeServerUrl);
                    return resolve(enriched);
                }
            } catch (e) {
                console.warn('[AutoForm] Remote config fetch failed:', e.message);
            }

            // Return stale cache if available, otherwise null
            resolve(cached || null);
        });
    });
}

/**
 * Resolves the active backend proxy URL with intelligent fallback chain:
 * 1. User-configured custom URL (from options page)
 * 2. Local dev server on port 3000 (auto-detected)
 * 3. Remote config activeServerUrl (from GitHub)
 * 4. Remote config fallbackServerUrls (tried in order)
 * 5. Hardcoded fallback URL (last resort)
 * @returns {Promise<string>}
 */
async function getEffectiveServerUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['customServerUrl'], async (stored) => {
            // 1. User-configured custom server URL (set from Options page)
            if (stored.customServerUrl && stored.customServerUrl.trim()) {
                const clean = stored.customServerUrl.trim().replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
                if (isValidServerUrl(clean)) {
                    return resolve(clean);
                } else {
                    console.warn('[AutoForm Security] Invalid custom server URL rejected:', clean);
                }
            }

            // 2. Local dev server auto-detection
            try {
                const res = await fetch(`${LOCAL_SERVER_URL}/healthz`, {
                    signal: AbortSignal.timeout(600)
                });
                if (res.ok) {
                    return resolve(LOCAL_SERVER_URL);
                }
            } catch (e) {
                // Local dev server not reachable
            }

            // 3. Remote config from GitHub
            const remoteConfig = await fetchRemoteConfig();
            if (remoteConfig && remoteConfig.activeServerUrl && isValidServerUrl(remoteConfig.activeServerUrl)) {
                // Try primary server
                try {
                    const res = await fetch(`${remoteConfig.activeServerUrl.replace(/\/+$/, '')}/healthz`, {
                        signal: AbortSignal.timeout(8000)
                    });
                    if (res.ok) {
                        return resolve(remoteConfig.activeServerUrl.replace(/\/+$/, ''));
                    }
                } catch (e) {
                    // Primary from remote config is down
                }

                // 4. Try fallback URLs from remote config
                const fallbacks = (remoteConfig.fallbackServerUrls || []).filter(isValidServerUrl);
                for (const fallbackUrl of fallbacks) {
                    try {
                        const res = await fetch(`${fallbackUrl.replace(/\/+$/, '')}/healthz`, {
                            signal: AbortSignal.timeout(8000)
                        });
                        if (res.ok) {
                            return resolve(fallbackUrl.replace(/\/+$/, ''));
                        }
                    } catch (e) {
                        // Fallback also down, try next
                    }
                }

                // Even if health check failed, still use primary (might be waking from cold start)
                return resolve(remoteConfig.activeServerUrl.replace(/\/+$/, ''));
            }

            // 5. Hardcoded last-resort fallback
            resolve(HARDCODED_FALLBACK_URL);
        });
    });
}

/**
 * Returns the cached remote config object (maintenance mode, announcements, etc.).
 * @returns {Promise<Object|null>}
 */
async function getRemoteConfig() {
    return fetchRemoteConfig();
}

// Sync remote config on service worker startup
fetchRemoteConfig().catch(() => {});


/**
 * Ensures an anonymous client ID is generated and stored for rate limiting.
 * @returns {Promise<string>}
 */
async function getOrCreateClientId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['clientId'], (res) => {
            if (res.clientId) {
                resolve(res.clientId);
            } else {
                const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
                    ? crypto.randomUUID() 
                    : 'client_' + Math.random().toString(36).substring(2, 15);
                chrome.storage.local.set({ clientId: newId }, () => {
                    resolve(newId);
                });
            }
        });
    });
}

/**
 * Builds an intelligent contextual memory string from the user's stored profile.
 * Uses the Hybrid RAG MemoryRetriever engine to classify intent, rank snippets,
 * cross-reference choices, and budget tokens.
 * @param {Object} questionData - { question, type, choices }
 * @param {string} customContext - Manual user persona / instructions
 * @returns {Promise<string>} Structured memory context block
 */
async function buildMemoryContext(questionData = {}, customContext = '') {
    return new Promise((resolve) => {
        chrome.storage.local.get(['memoryProfile'], (stored) => {
            const profile = stored.memoryProfile;
            const hasPrior = questionData.priorAnswers && questionData.priorAnswers.length > 0;
            if (!profile && !customContext && !questionData.formDigest && !hasPrior) {
                return resolve({ context: '', retrievedSnippetIds: [] });
            }

            const retriever = (typeof MemoryRetriever !== 'undefined') 
                ? MemoryRetriever 
                : (typeof globalThis !== 'undefined' ? globalThis.MemoryRetriever : null);

            if (retriever && typeof retriever.buildSmartMemoryContext === 'function') {
                const smartResult = retriever.buildSmartMemoryContext({
                    question: questionData.question || '',
                    type: questionData.type || '',
                    choices: questionData.choices || [],
                    memoryProfile: profile,
                    customContext: customContext || '',
                    formDigest: questionData.formDigest || null,
                    priorAnswers: questionData.priorAnswers || [],
                    usedSnippetIds: questionData.usedSnippetIds || [],
                    returnMetadata: true
                });
                if (typeof smartResult === 'object' && smartResult.context !== undefined) {
                    return resolve(smartResult);
                }
                return resolve({ context: smartResult || '', retrievedSnippetIds: [] });
            }

            // Fallback simple concatenation if retriever not loaded
            const parts = [];
            if (customContext) parts.push(customContext);
            if (profile?.identity?.fullName) parts.push(`Name: ${profile.identity.fullName}`);
            if (profile?.identity?.email) parts.push(`Email: ${profile.identity.email}`);
            if (profile?.identity?.phone) parts.push(`Phone: ${profile.identity.phone}`);
            resolve({ context: parts.join('. '), retrievedSnippetIds: [] });
        });
    });
}

/**
 * Solves a question using the backend AI proxy server (Groq / Gemini / NVIDIA).
 * @param {Object} questionData
 * @param {Object} preferences
 * @returns {Promise<Object>}
 */
async function solveViaBackendProxy(questionData, preferences = {}) {
    const clientId = await getOrCreateClientId();
    const serverUrl = preferences.serverUrl || await getEffectiveServerUrl();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const userPlan = preferences.userPlan || 'free';
    const userId = preferences.userId || clientId;
    const sessionToken = preferences.sessionToken || '';
    const formSessionToken = preferences.formSessionToken || '';
    const guestTrial = Boolean(preferences.guestTrial);

    try {
        const headers = {
            'Content-Type': 'application/json',
            'X-Client-ID': clientId,
            'X-User-ID': userId,
            'X-User-Plan': userPlan
        };
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
        }
        if (formSessionToken) {
            headers['X-Form-Session-Token'] = formSessionToken;
        }
        if (guestTrial) headers['X-AutoForm-Guest-Trial'] = '1';

        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/solve`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                clientId,
                userId,
                userPlan,
                formSessionToken: formSessionToken || undefined,
                question: questionData.question,
                type: questionData.type,
                choices: questionData.choices || [],
                customContext: preferences.customContext || '',
                tone: preferences.tone || 'accurate'
            }),
            signal: controller.signal
        });

        const data = await response.json();

        if (!response.ok) {
            const err = new Error(data.error || `Server HTTP ${response.status}`);
            err.statusCode = response.status;
            err.code = data.code;
            err.data = data;
            throw err;
        }

        return data;

    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Fallback direct Gemini API solve (for BYOK / offline mode).
 * @param {Object} questionData
 * @param {string[]} keys
 * @returns {Promise<Object>}
 */
async function solveDirectGemini(questionData, keys, customContext = '') {
    const currentKey = keys[0];
    const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

    const optionsText = questionData.choices && questionData.choices.length > 0
        ? `AVAILABLE OPTIONS (Select EXACTLY one):\n${questionData.choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
        : 'Open-ended question.';

    const contextPart = customContext 
        ? `\nUSER CONTEXT & VERIFIED MEMORY:\n${customContext}\n(CRITICAL: Always use verified profile details for email, phone, whatsapp, department, and year. Never output dummy placeholders like example@gmail.com)\n` 
        : '';

    const promptText = `QUESTION: "${questionData.question}"
TYPE: ${questionData.type}
${contextPart}
${optionsText}

Return ONLY a valid JSON object matching: {"answer": "exact text"}`;

    const response = await fetch(API_URL, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "x-goog-api-key": currentKey
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }]
        })
    });

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("No response text from Gemini");

    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid JSON in AI response");

    const parsed = JSON.parse(match[0]);
    return {
        success: true,
        answer: String(parsed.answer || parsed.answers?.[0] || '').trim(),
        provider: 'gemini-direct'
    };
}

// ---------------------------------------------------------------------------
// Keep-Alive Connection Listener for Active Solving Sessions
// ---------------------------------------------------------------------------
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === 'autoform-keepalive') {
            port.onDisconnect.addListener(() => {
                // Port cleanly closed when solving completes or tab unloads
            });
        }
    });
}

/**
 * Listener for extension runtime messages.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === "PING") {
        sendResponse({ success: true, status: "alive" });
        return false;
    }

    if (request.action === "START_FORM_SESSION") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(['sessionToken', 'authUser', 'quota', 'guestTrialCompletedForms']);
                const sessionToken = stored.sessionToken;

                if (!sessionToken) {
                    const completedForms = Number(stored.guestTrialCompletedForms || 0);
                    if (completedForms < 2) {
                        sendResponse({ success: true, guestTrial: true, quota: { limit: 2, remaining: 2 - completedForms } });
                        return;
                    }
                    sendResponse({
                        success: false,
                        code: "AUTH_REQUIRED",
                        error: "Your two free form trials are complete. Sign in with Google to continue."
                    });
                    return;
                }

                const serverUrl = await getEffectiveServerUrl();
                const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/form/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${sessionToken}`
                    },
                    body: JSON.stringify({ formCategory: request.formCategory || 'generic' }),
                    signal: AbortSignal.timeout(8000)
                });

                const data = await res.json();

                if (res.status === 401) {
                    await chrome.storage.local.remove(['sessionToken', 'authUser', 'quota']);
                    sendResponse({
                        success: false,
                        code: "AUTH_REQUIRED",
                        error: "Your session has expired. Please sign in with Google again."
                    });
                    return;
                }

                if (res.status === 403 || data.code === 'QUOTA_EXCEEDED') {
                    sendResponse({
                        success: false,
                        code: "QUOTA_EXCEEDED",
                        error: data.error || data.message || "Monthly free quota reached (10 of 10 forms used). Upgrade to Pro for unlimited forms.",
                        quota: data.quota
                    });
                    return;
                }

                if (!res.ok || !data.success) {
                    sendResponse({
                        success: false,
                        error: data.error || `Failed to start form session (HTTP ${res.status})`
                    });
                    return;
                }

                if (data.quota) {
                    chrome.storage.local.set({ quota: data.quota });
                }

                sendResponse({
                    success: true,
                    sessionToken: data.sessionToken,
                    expiresAt: data.expiresAt,
                    quota: data.quota
                });
            } catch (err) {
                sendResponse({
                    success: false,
                    error: err.message || "Network error starting form session"
                });
            }
        })();
        return true;
    }

    if (request.action === "RELEASE_FORM_SESSION") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(['sessionToken']);
                if (stored.sessionToken && request.sessionToken) {
                    const serverUrl = await getEffectiveServerUrl();
                    await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/form/release`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${stored.sessionToken}`
                        },
                        body: JSON.stringify({ sessionToken: request.sessionToken }),
                        signal: AbortSignal.timeout(4000)
                    });
                }
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === "OPEN_CHECKOUT_PAGE") {
        (async () => {
            try {
                const planLinks = {
                    'pass_14d': 'https://rzp.io/rzp/5vXylVtV',
                    'pass_30d': 'https://rzp.io/rzp/5qbZBgFs',
                    'pass_90d': 'https://rzp.io/rzp/nGBFHJtG'
                };
                const url = request.url || planLinks[request.plan] || planLinks['pass_30d'];
                chrome.tabs.create({ url });
                sendResponse({ success: true, url });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (request.action === "SOLVE_SINGLE_QUESTION") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get([
                    'sessionToken',
                    'authUser',
                    'quota',
                    'serverUrl', 
                    'customContext', 
                    'tone', 
                    'useDirectKey', 
                    'geminiApiKeys', 
                    'geminiApiKey'
                ]);

                // Direct BYOK mode bypasses cloud proxy
                if (stored.useDirectKey) {
                    const keys = stored.geminiApiKeys || (stored.geminiApiKey ? [stored.geminiApiKey] : []);
                    if (keys.length === 0) {
                        sendResponse({ success: false, error: "Direct key mode enabled but no keys provided." });
                        return;
                    }
                    const memoryResult = await buildMemoryContext(request.data, stored.customContext || '');
                    const combinedContext = (typeof memoryResult === 'object' && memoryResult.context !== undefined)
                        ? memoryResult.context
                        : (typeof memoryResult === 'string' ? memoryResult : '');
                    const res = await solveDirectGemini(request.data, keys, combinedContext);
                    res.retrievedSnippetIds = (typeof memoryResult === 'object' && Array.isArray(memoryResult.retrievedSnippetIds))
                        ? memoryResult.retrievedSnippetIds
                        : [];
                    sendResponse(res);
                    return;
                }

                // Only an active guest trial can solve without an account.
                if (!stored.sessionToken && !request.guestTrial) {
                    sendResponse({
                        success: false,
                        code: "AUTH_REQUIRED",
                        error: "Please sign in with Google in the extension popup to use AI form filling."
                    });
                    return;
                }

                // Build intelligent enriched context via Hybrid RAG engine
                const memoryResult = await buildMemoryContext(request.data, stored.customContext || '');
                const combinedContext = (typeof memoryResult === 'object' && memoryResult.context !== undefined)
                    ? memoryResult.context
                    : (typeof memoryResult === 'string' ? memoryResult : '');
                const retrievedSnippetIds = (typeof memoryResult === 'object' && Array.isArray(memoryResult.retrievedSnippetIds))
                    ? memoryResult.retrievedSnippetIds
                    : [];

                const authUser = stored.authUser || { plan: 'free' };
                const effectiveServerUrl = await getEffectiveServerUrl();
                const formSessionToken = request.formSessionToken || '';

                const result = await solveViaBackendProxy(request.data, {
                    serverUrl: effectiveServerUrl,
                    sessionToken: stored.sessionToken,
                    formSessionToken: formSessionToken,
                    customContext: combinedContext,
                    tone: stored.tone || 'accurate',
                    userPlan: authUser.plan || 'free',
                    userId: authUser.id,
                    guestTrial: Boolean(request.guestTrial)
                });

                // Record successful solve in local metrics
                if (typeof recordQuestionSolved === 'function') {
                    await recordQuestionSolved();
                }

                sendResponse({
                    success: true,
                    answer: result.answer,
                    answers: result.answers,
                    provider: result.provider,
                    latencyMs: result.latencyMs,
                    confidence: result.confidence || 'high',
                    reasoning: result.reasoning || '',
                    retrievedSnippetIds: retrievedSnippetIds
                });

            } catch (error) {
                console.error('[Background Solve Error]:', error.message);
                if (error.statusCode === 401) {
                    await chrome.storage.local.remove(['sessionToken', 'authUser', 'quota']);
                    sendResponse({
                        success: false,
                        code: "AUTH_REQUIRED",
                        error: "Your session has expired. Please sign in with Google again."
                    });
                    return;
                }
                if (error.code === 'QUOTA_EXCEEDED' || error.statusCode === 403) {
                    sendResponse({
                        success: false,
                        code: "QUOTA_EXCEEDED",
                        isQuotaExceeded: true,
                        error: error.message || "Monthly form quota reached."
                    });
                    return;
                }
                sendResponse({
                    success: false,
                    code: error.code || "SOLVE_ERROR",
                    error: error.message || 'Failed to solve question'
                });
            }
        })();

        return true; // Keep message channel open for async response
    }

    if (request.action === "CHECK_SERVER_HEALTH") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                const remoteConfig = await getRemoteConfig();
                const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/health`, {
                    signal: AbortSignal.timeout(12000)
                });
                const data = await res.json();
                sendResponse({
                    success: res.ok,
                    data,
                    serverUrl,
                    maintenance: remoteConfig?.maintenanceMode || false,
                    maintenanceMessage: remoteConfig?.maintenanceMessage || '',
                    announcement: remoteConfig?.announcement || ''
                });
            } catch (e) {
                const remoteConfig = await getRemoteConfig().catch(() => null);
                sendResponse({
                    success: false,
                    error: e.message,
                    maintenance: remoteConfig?.maintenanceMode || false,
                    maintenanceMessage: remoteConfig?.maintenanceMessage || '',
                    announcement: remoteConfig?.announcement || ''
                });
            }
        })();
        return true;
    }

    if (request.action === "GET_CLIENT_QUOTA") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                const clientId = await getOrCreateClientId();
                const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/quota?clientId=${encodeURIComponent(clientId)}`, {
                    headers: { 'X-Client-ID': clientId },
                    signal: AbortSignal.timeout(4000)
                });
                const data = await res.json();
                sendResponse({ success: res.ok, data, serverUrl });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "GET_REMOTE_CONFIG") {
        (async () => {
            try {
                const config = await getRemoteConfig();
                const serverUrl = await getEffectiveServerUrl();
                sendResponse({ success: true, config, serverUrl });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "FORCE_REFRESH_CONFIG") {
        (async () => {
            try {
                // Clear cache to force fresh fetch
                await chrome.storage.local.remove(CONFIG_CACHE_KEY);
                const config = await fetchRemoteConfig();
                const serverUrl = await getEffectiveServerUrl();
                sendResponse({ success: true, config, serverUrl });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "SET_CUSTOM_SERVER_URL") {
        (async () => {
            try {
                const url = request.url;
                if (url && url.trim()) {
                    const clean = url.trim().replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
                    await chrome.storage.local.set({ customServerUrl: clean });
                } else {
                    await chrome.storage.local.remove('customServerUrl');
                }
                const serverUrl = await getEffectiveServerUrl();
                sendResponse({ success: true, serverUrl });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "RECORD_INSTANT_FILL") {
        (async () => {
            try {
                const count = request.count || 1;
                chrome.storage.local.get(['shareDailyInstantFillSummary', '_instantFillDailyStats', 'sessionToken'], async (stored) => {
                    // Respect user privacy opt-out toggle from Options
                    if (stored.shareDailyInstantFillSummary === false) return;

                    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
                    const istDate = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

                    let stats = stored._instantFillDailyStats || { date: istDate, count: 0 };
                    if (stats.date !== istDate) {
                        stats = { date: istDate, count: 0 };
                    }

                    stats.count += count;
                    await chrome.storage.local.set({ _instantFillDailyStats: stats });

                    // Only send summary if user has an active session token (signed-in user)
                    if (stored.sessionToken) {
                        try {
                            const serverUrl = await getEffectiveServerUrl();
                            await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/usage/instant-fill-summary`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${stored.sessionToken}`
                                },
                                body: JSON.stringify({ count: stats.count, date: stats.date })
                            });
                        } catch (_) {}
                    }
                });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "TEST_SERVER_CONNECTION") {
        (async () => {
            const testUrl = request.url || await getEffectiveServerUrl();
            const startTime = Date.now();
            try {
                const res = await fetch(`${testUrl.replace(/\/+$/, '')}/api/v1/health`, {
                    signal: AbortSignal.timeout(15000)
                });
                const data = await res.json();
                const latencyMs = Date.now() - startTime;
                sendResponse({ success: res.ok, data, latencyMs, serverUrl: testUrl });
            } catch (e) {
                const latencyMs = Date.now() - startTime;
                sendResponse({ success: false, error: e.message, latencyMs, serverUrl: testUrl });
            }
        })();
        return true;
    }

    if (request.action === "PARSE_RESUME") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/parse-resume`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        resumeText: request.resumeText,
                        fileName: request.fileName
                    }),
                    signal: AbortSignal.timeout(18000)
                });
                const data = await res.json();
                sendResponse(data);
            } catch (e) {
                sendResponse({ success: false, error: e.message, fallback: true });
            }
        })();
        return true;
    }

    if (request.action === "GET_STORED_RESUME") {
        chrome.storage.local.get(['storedResume'], (data) => {
            sendResponse({ success: true, storedResume: data.storedResume || null });
        });
        return true;
    }

    if (request.action === "SAVE_STORED_RESUME") {
        chrome.storage.local.set({ storedResume: request.storedResume }, () => {
            sendResponse({ success: !chrome.runtime.lastError });
        });
        return true;
    }

    if (request.action === "DELETE_STORED_RESUME") {
        chrome.storage.local.remove(['storedResume'], () => {
            sendResponse({ success: !chrome.runtime.lastError });
        });
        return true;
    }

    // ---------------------------------------------------------------------------
    // Auth & Subscription Plan Handlers
    // ---------------------------------------------------------------------------

    if (request.action === "GET_AUTH_STATUS") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(['sessionToken', 'authUser', 'quota', 'guestTrialCompletedForms']);
                let user = stored.authUser || { plan: 'free' };
                let quota = stored.quota || { limit: 10, used: 0, remaining: 10, isPro: false, plan: 'free' };

                if (stored.sessionToken && !stored.sessionToken.startsWith('mock-')) {
                    try {
                        const serverUrl = await getEffectiveServerUrl();
                        const meRes = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/auth/me`, {
                            headers: { 'Authorization': `Bearer ${stored.sessionToken}` },
                            signal: AbortSignal.timeout(3500)
                        });
                        if (meRes.ok) {
                            const meData = await meRes.json();
                            if (meData.success) {
                                user = { ...user, ...meData.user };
                                quota = meData.quota || quota;
                                await chrome.storage.local.set({ authUser: user, quota });
                            }
                        } else if (meRes.status === 401) {
                            await chrome.storage.local.remove(['sessionToken', 'authUser', 'quota']);
                            user = { plan: 'free' };
                            quota = { limit: 10, used: 0, remaining: 10, isPro: false, plan: 'free' };
                        }
                    } catch (_) {}
                }

                sendResponse({
                    success: true,
                    isAuthenticated: !!stored.sessionToken || !!user.id,
                    user,
                    quota,
                    guestTrialCompletedForms: Number(stored.guestTrialCompletedForms || 0)
                });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "SIGN_IN_GOOGLE") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                let googleClientId = '';
                try {
                    const cfgRes = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/config`, {
                        signal: AbortSignal.timeout(3000)
                    });
                    if (cfgRes.ok) {
                        const cfgData = await cfgRes.json();
                        googleClientId = cfgData.googleClientId || '';
                    }
                } catch (_) {}

                if (!googleClientId) {
                    const remoteCfg = await getRemoteConfig().catch(() => null);
                    googleClientId = remoteCfg?.googleClientId || '124825767907-8i59japp45ibhclluloh8bs5ididjmkp.apps.googleusercontent.com';
                }

                let authResult = { success: false, error: 'Authentication service not initialized.' };
                const authFn = (typeof signInWithGoogle === 'function')
                    ? signInWithGoogle
                    : (typeof globalThis.AutoFormAuth !== 'undefined' && typeof globalThis.AutoFormAuth.signInWithGoogle === 'function')
                        ? globalThis.AutoFormAuth.signInWithGoogle
                        : null;

                if (authFn) {
                    authResult = await authFn({
                        serverUrl,
                        googleClientId
                    });
                }
                sendResponse(authResult);
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "SIGN_OUT") {
        (async () => {
            try {
                const signOutFn = (typeof signOut === 'function')
                    ? signOut
                    : (typeof globalThis.AutoFormAuth !== 'undefined' && typeof globalThis.AutoFormAuth.signOut === 'function')
                        ? globalThis.AutoFormAuth.signOut
                        : null;

                if (signOutFn) await signOutFn();
                sendResponse({
                    success: true,
                    user: { plan: 'free' },
                    quota: { limit: 10, used: 0, remaining: 10, isPro: false, plan: 'free' }
                });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "UPGRADE_TO_PRO") {
        (async () => {
            try {
                const user = typeof updateUserPlan === 'function'
                    ? await updateUserPlan('pro', request.details || {})
                    : { plan: 'pro' };
                const stats = typeof getStoredUsageStats === 'function' ? await getStoredUsageStats() : {};
                const quota = typeof getMonthlyQuotaStatus === 'function' ? getMonthlyQuotaStatus(user, stats) : { used: 0, limit: Infinity, remaining: Infinity, isPro: true };
                sendResponse({ success: true, user, stats, quota });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "VERIFY_PAYMENT") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                let verifyResult = { success: false, error: 'Verification failed' };
                if (typeof verifyAndActivateRazorpayPayment === 'function') {
                    verifyResult = await verifyAndActivateRazorpayPayment(request.paymentId, { serverUrl });
                }
                const user = typeof getStoredAuthUser === 'function' ? await getStoredAuthUser() : { plan: verifyResult.success ? 'pro' : 'free' };
                const stats = typeof getStoredUsageStats === 'function' ? await getStoredUsageStats() : {};
                const quota = typeof getMonthlyQuotaStatus === 'function' ? getMonthlyQuotaStatus(user, stats) : { isPro: user.plan === 'pro' };
                sendResponse({ ...verifyResult, user, stats, quota });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ---------------------------------------------------------------------------
    // Smart Delight Review Prompt Handlers
    // ---------------------------------------------------------------------------

    if (request.action === "RECORD_FORM_COMPLETED") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(['sessionToken', 'guestTrialCompletedForms']);
                if (!stored.sessionToken) {
                    const completedForms = Math.min(2, Number(stored.guestTrialCompletedForms || 0) + 1);
                    await chrome.storage.local.set({ guestTrialCompletedForms: completedForms });
                    sendResponse({ success: true, shouldShowReview: false, guestTrialCompletedForms: completedForms });
                    return;
                }
                const stats = typeof recordFormCompleted === 'function' ? await recordFormCompleted() : {};
                const shouldShowReview = typeof shouldShowReviewPrompt === 'function' ? shouldShowReviewPrompt(stats) : false;
                sendResponse({ success: true, stats, shouldShowReview });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "UPDATE_REVIEW_STATE") {
        (async () => {
            try {
                const stats = typeof updateReviewPromptState === 'function'
                    ? await updateReviewPromptState(request.state)
                    : {};
                sendResponse({ success: true, stats });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === "DELETE_ACCOUNT") {
        (async () => {
            try {
                const serverUrl = await getEffectiveServerUrl();
                const user = typeof getStoredAuthUser === 'function' ? await getStoredAuthUser() : null;
                const tokenData = await new Promise(r => chrome.storage.local.get(['sessionToken', 'authToken'], r));
                const token = tokenData?.sessionToken || tokenData?.authToken;
                const clientId = await getOrCreateClientId();

                try {
                    await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                            'X-Client-ID': clientId
                        },
                        body: JSON.stringify({ email: user?.email, clientId })
                    });
                } catch (netErr) {
                    console.warn('[AutoForm Background] Server account deletion notice offline/failed:', netErr.message);
                }

                // Clear all local auth credentials, session tokens, and user profile state
                if (typeof signOutUser === 'function') {
                    await signOutUser();
                } else {
                    await chrome.storage.local.remove(['authUser', 'sessionToken', 'authToken', 'userPlan']);
                }

                sendResponse({ success: true, message: 'Account and associated server records deleted successfully.' });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }
});

// ---------------------------------------------------------------------------
// Global Keyboard Shortcut Command Listener (Alt+Shift+F)
// ---------------------------------------------------------------------------
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
        if (command === "start_solving") {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tab = tabs[0];
                if (tab && tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('edge://')) {
                    chrome.tabs.sendMessage(tab.id, { action: "START_SOLVING" }, (res) => {
                        if (chrome.runtime.lastError) {
                            // Script might need on-demand injection
                            chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                files: ['src/services/resumeExtractor.js', 'src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
                            }).then(() => {
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(tab.id, { action: "START_SOLVING" });
                                }, 250);
                            }).catch(() => {});
                        }
                    });
                }
            } catch (err) {
                console.warn('[AutoForm Background] Command dispatch error:', err.message);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Automatic Razorpay Payment Success Tab Listener
// Watches for payment completion across tabs and automatically activates Pro
// ---------------------------------------------------------------------------
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const targetUrl = changeInfo.url || tab?.url;
        if (!targetUrl || !targetUrl.startsWith('http')) return;

        try {
            const urlObj = new URL(targetUrl);
            const pid = urlObj.searchParams.get('razorpay_payment_id') ||
                        urlObj.searchParams.get('payment_id') ||
                        urlObj.searchParams.get('paymentId');

            if (pid && pid.startsWith('pay_')) {
                chrome.storage.local.get(['_lastActivatedPaymentId'], async (stored) => {
                    if (stored._lastActivatedPaymentId === pid) return;
                    await chrome.storage.local.set({ _lastActivatedPaymentId: pid });

                    console.log('[AutoForm Background] Auto-activating detected Razorpay payment:', pid);
                    const serverUrl = await getEffectiveServerUrl();
                    if (typeof verifyAndActivateRazorpayPayment === 'function') {
                        await verifyAndActivateRazorpayPayment(pid, { serverUrl });
                    }
                });
            }
        } catch (_) {}
    });
}
