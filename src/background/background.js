/**
 * @file src/background/background.js
 * @description Background service worker for AutoForm AI v2.0.
 * Handles backend proxy requests, client identity management, and direct API fallback.
 */

// Backend Proxy Endpoints
const LOCAL_SERVER_URL = "http://localhost:3000";
const PRODUCTION_SERVER_URL = "https://web-production-d1895.up.railway.app";
const DEFAULT_SERVER_URL = PRODUCTION_SERVER_URL;

// Load MemoryRetriever Hybrid RAG Engine
try {
    importScripts('../services/memoryRetriever.js');
} catch (e) {
    try {
        importScripts('src/services/memoryRetriever.js');
    } catch (e2) {
        console.warn('[AutoForm] memoryRetriever load error:', e2.message);
    }
}

/**
 * Resolves the active backend proxy URL.
 * Automatically detects and prioritizes local development server on port 3000,
 * falling back to the production Railway proxy when local server is offline.
 * @returns {Promise<string>}
 */
async function getEffectiveServerUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['serverUrl'], async (stored) => {
            if (stored.serverUrl) {
                return resolve(stored.serverUrl);
            }
            try {
                const res = await fetch(`${LOCAL_SERVER_URL}/healthz`, {
                    signal: AbortSignal.timeout(600)
                });
                if (res.ok) {
                    return resolve(LOCAL_SERVER_URL);
                }
            } catch (e) {
                // Local dev server not reachable, fallback to cloud production
            }
            resolve(PRODUCTION_SERVER_URL);
        });
    });
}


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

    try {
        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/solve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-ID': clientId
            },
            body: JSON.stringify({
                clientId,
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
            throw new Error(data.error || `Server HTTP ${response.status}`);
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

    if (request.action === "SOLVE_SINGLE_QUESTION") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get([
                    'serverUrl', 
                    'customContext', 
                    'tone', 
                    'useDirectKey', 
                    'geminiApiKeys', 
                    'geminiApiKey'
                ]);

                // Build intelligent enriched context via Hybrid RAG engine
                const memoryResult = await buildMemoryContext(request.data, stored.customContext || '');
                const combinedContext = (typeof memoryResult === 'object' && memoryResult.context !== undefined)
                    ? memoryResult.context
                    : (typeof memoryResult === 'string' ? memoryResult : '');
                const retrievedSnippetIds = (typeof memoryResult === 'object' && Array.isArray(memoryResult.retrievedSnippetIds))
                    ? memoryResult.retrievedSnippetIds
                    : [];

                // If user enabled direct BYOK mode
                if (stored.useDirectKey) {
                    const keys = stored.geminiApiKeys || (stored.geminiApiKey ? [stored.geminiApiKey] : []);
                    if (keys.length === 0) {
                        sendResponse({ success: false, error: "Direct key mode enabled but no keys provided." });
                        return;
                    }
                    const res = await solveDirectGemini(request.data, keys, combinedContext);
                    res.retrievedSnippetIds = retrievedSnippetIds;
                    sendResponse(res);
                    return;
                }

                // Default: Solve via Multi-Provider Backend Proxy (Groq / Gemini / NVIDIA)
                const result = await solveViaBackendProxy(request.data, {
                    serverUrl: stored.serverUrl || DEFAULT_SERVER_URL,
                    customContext: combinedContext,
                    tone: stored.tone || 'accurate'
                });

                sendResponse({
                    success: true,
                    answer: result.answer,
                    answers: result.answers,
                    provider: result.provider,
                    latencyMs: result.latencyMs,
                    retrievedSnippetIds: retrievedSnippetIds
                });

            } catch (error) {
                console.error('[Background Solve Error]:', error.message);
                sendResponse({
                    success: false,
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
                const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/health`, {
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
                                files: ['src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
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

