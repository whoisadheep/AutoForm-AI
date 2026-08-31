/**
 * @file src/background/background.js
 * @description Background service worker for AutoForm AI v2.0.
 * Handles backend proxy requests, client identity management, and direct API fallback.
 */

// Default Cloud Backend Proxy URL (editable via extension settings)
const DEFAULT_SERVER_URL = "http://localhost:3000";

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
 * Solves a question using the backend AI proxy server (Groq / Gemini / NVIDIA).
 * @param {Object} questionData
 * @param {Object} preferences
 * @returns {Promise<Object>}
 */
async function solveViaBackendProxy(questionData, preferences = {}) {
    const clientId = await getOrCreateClientId();
    const serverUrl = preferences.serverUrl || DEFAULT_SERVER_URL;

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
async function solveDirectGemini(questionData, keys) {
    const currentKey = keys[0];
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${currentKey}`;

    const optionsText = questionData.choices && questionData.choices.length > 0
        ? `AVAILABLE OPTIONS (Select EXACTLY one):\n${questionData.choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
        : 'Open-ended question.';

    const promptText = `QUESTION: "${questionData.question}"
TYPE: ${questionData.type}
${optionsText}

Return ONLY a valid JSON object matching: {"answer": "exact text"}`;

    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

/**
 * Listener for extension runtime messages.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === "SOLVE_SINGLE_QUESTION") {
        chrome.storage.local.get([
            'serverUrl', 
            'customContext', 
            'tone', 
            'useDirectKey', 
            'geminiApiKeys', 
            'geminiApiKey'
        ], async (stored) => {
            try {
                // If user enabled direct BYOK mode
                if (stored.useDirectKey) {
                    const keys = stored.geminiApiKeys || (stored.geminiApiKey ? [stored.geminiApiKey] : []);
                    if (keys.length === 0) {
                        sendResponse({ success: false, error: "Direct key mode enabled but no keys provided." });
                        return;
                    }
                    const res = await solveDirectGemini(request.data, keys);
                    sendResponse(res);
                    return;
                }

                // Default: Solve via Multi-Provider Backend Proxy (Groq / Gemini / NVIDIA)
                const result = await solveViaBackendProxy(request.data, {
                    serverUrl: stored.serverUrl || DEFAULT_SERVER_URL,
                    customContext: stored.customContext || '',
                    tone: stored.tone || 'accurate'
                });

                sendResponse({
                    success: true,
                    answer: result.answer,
                    answers: result.answers,
                    provider: result.provider,
                    latencyMs: result.latencyMs
                });

            } catch (error) {
                console.error('[Background Solve Error]:', error.message);
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to solve question'
                });
            }
        });

        return true; // Keep message channel open
    }

    if (request.action === "CHECK_SERVER_HEALTH") {
        chrome.storage.local.get(['serverUrl'], async (stored) => {
            const serverUrl = stored.serverUrl || DEFAULT_SERVER_URL;
            try {
                const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/health`, {
                    signal: AbortSignal.timeout(4000)
                });
                const data = await res.json();
                sendResponse({ success: res.ok, data });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        });
        return true;
    }
});
