/**
 * @file server/src/providers/base.js
 * @description Base utilities and prompt builders for AI provider adapters.
 */

/**
 * Builds a robust, standardized prompt for solving form questions.
 * @param {Object} params
 * @param {string} params.question - The question prompt
 * @param {string} params.type - 'multiple_choice', 'checkbox', 'text_input', 'dropdown', 'scale'
 * @param {string[]} [params.choices] - List of available options
 * @param {string} [params.customContext] - Optional user background (e.g., "I am a high school student")
 * @param {string} [params.tone] - 'accurate', 'concise', 'detailed'
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildPrompt({ question, type, choices = [], customContext = '', tone = 'accurate' }) {
    const systemPrompt = `You are AutoForm AI, an intelligent and precise assistant specialized in accurately completing forms, quizzes, surveys, and assessments.
Your task is to analyze form questions and return strictly a valid JSON object matching the required format.`;

    let instructions = '';
    let choicesText = '';

    if (type === 'checkbox') {
        choicesText = choices.length > 0 
            ? `AVAILABLE OPTIONS:\n${choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
            : 'No explicit options provided.';
        instructions = `This is a multi-select question (checkbox). Select all choices that apply.
Return a JSON array of exact option strings under "answers".
Format: {"answers": ["Exact Option A", "Exact Option B"]}`;
    } else if (choices && choices.length > 0) {
        choicesText = `AVAILABLE OPTIONS:\n${choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`;
        instructions = `This is a single-select question. Select EXACTLY ONE matching option from the list above.
Do not modify or rephrase the option text.
Format: {"answer": "Exact option string"}`;
    } else {
        choicesText = 'Open-ended text input.';
        const lengthGuidance = tone === 'concise' 
            ? 'Keep the answer very short and direct (1-2 sentences).'
            : tone === 'detailed'
            ? 'Provide a comprehensive and well-explained answer (2-4 paragraphs).'
            : 'Provide a clear, accurate, and natural response.';
        instructions = `Provide an appropriate and accurate written answer. ${lengthGuidance}
CRITICAL ACCURACY RULE: If the question asks for personal or contact facts (Email, Gmail, Phone, WhatsApp, Name, Department, Year of Study), use the exact verified details from USER CONTEXT & VERIFIED MEMORY. NEVER invent dummy or placeholder data like example@gmail.com, 1234567890, or placeholder names.
Format: {"answer": "Your text response here"}`;
    }

    const contextPart = customContext 
        ? `\nUSER CONTEXT & VERIFIED MEMORY:\n${customContext}\n(CRITICAL: Prioritize the user's verified profile details and relevant memories above. Never contradict or invent placeholder contact information.)\n` 
        : '';

    const userPrompt = `QUESTION: "${question}"
TYPE: ${type}
${contextPart}
${choicesText}

INSTRUCTIONS:
${instructions}
Ensure the output is ONLY a valid JSON object without markdown fences.`;

    return { systemPrompt, userPrompt };
}

/**
 * Extracts and parses a JSON response from an AI model output string.
 * @param {string} rawText 
 * @param {string} type 
 * @returns {{ answer?: string, answers?: string[] }}
 */
function parseAiResponse(rawText, type, choices = []) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('Empty response from AI model');
    }

    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    if (!match) {
        // If options/choices were provided, check if model simply echoed one of the choices
        if (choices && choices.length > 0) {
            const matchedChoice = choices.find(c => 
                clean.toLowerCase() === c.toLowerCase() || 
                new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(clean)
            );
            if (matchedChoice) {
                return type === 'checkbox' ? { answers: [matchedChoice] } : { answer: matchedChoice };
            }
            throw new Error(`AI returned non-JSON output that matches no options: "${clean.slice(0, 80)}"`);
        }

        // Fallback for open-ended text input
        if (type === 'checkbox') {
            return { answers: [clean.split('\n')[0].trim()] };
        }
        return { answer: clean };
    }

    const parsed = JSON.parse(match[0]);
    if (type === 'checkbox' && parsed.answers && Array.isArray(parsed.answers)) {
        return { answers: parsed.answers.map(String) };
    }

    if (parsed.answer !== undefined) {
        return { answer: String(parsed.answer).trim() };
    }

    if (parsed.answers && Array.isArray(parsed.answers)) {
        return { answer: String(parsed.answers[0]).trim() };
    }

    throw new Error('JSON response does not contain "answer" or "answers" key');
}

/**
 * Intelligent key rotator with rate-limit tracking (429) and cooldown mitigation.
 */
class KeyRotator {
    /**
     * @param {string[]} keys - List of API keys
     * @param {number} [defaultCooldownMs=60000] - Base cooldown duration for rate-limited keys
     */
    constructor(keys = [], defaultCooldownMs = 60000) {
        this.keys = keys;
        this.index = 0;
        this.defaultCooldownMs = defaultCooldownMs;

        /** @type {Map<string, { cooldownUntil: number, consecutive429s: number, lastUsed: number|null }>} */
        this.keyStates = new Map();
        for (const k of keys) {
            this.keyStates.set(k, { cooldownUntil: 0, consecutive429s: 0, lastUsed: null });
        }
    }

    /**
     * Retrieves the next available, healthy API key.
     * Automatically skips keys in cooldown.
     * @returns {string|null}
     */
    getKey() {
        if (!this.keys || this.keys.length === 0) return null;

        const now = Date.now();
        const len = this.keys.length;

        // Search for a healthy key starting from current index
        for (let i = 0; i < len; i++) {
            const candidateIdx = (this.index + i) % len;
            const key = this.keys[candidateIdx];
            const state = this.keyStates.get(key) || { cooldownUntil: 0 };

            if (now >= state.cooldownUntil) {
                this.index = (candidateIdx + 1) % len;
                state.lastUsed = now;
                return key;
            }
        }

        // All keys are currently in cooldown!
        return null;
    }

    /**
     * Marks an API key as rate-limited (429) with a cooldown duration.
     * @param {string} key
     * @param {number} [retryAfterSeconds] - Optional duration from Retry-After header
     */
    markKeyRateLimited(key, retryAfterSeconds) {
        if (!key) return;
        const state = this.keyStates.get(key) || { cooldownUntil: 0, consecutive429s: 0, lastUsed: null };
        const now = Date.now();

        state.consecutive429s = (state.consecutive429s || 0) + 1;
        // Exponential multiplier for repeated 429s, capped at 10x
        const multiplier = Math.min(Math.pow(1.5, state.consecutive429s - 1), 10);
        const cooldownMs = retryAfterSeconds && !isNaN(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : Math.round(this.defaultCooldownMs * multiplier);

        state.cooldownUntil = now + cooldownMs;
        this.keyStates.set(key, state);

        const masked = key.length > 8 ? `...${key.slice(-4)}` : '***';
        console.warn(`[KeyRotator] Key ${masked} rate-limited (429). Placed on cooldown for ${Math.round(cooldownMs / 1000)}s.`);
    }

    /**
     * Marks an API key execution as successful, resetting any 429 penalty counters.
     * @param {string} key
     */
    markKeySuccess(key) {
        if (!key) return;
        const state = this.keyStates.get(key);
        if (state) {
            state.consecutive429s = 0;
            state.cooldownUntil = 0;
        }
    }

    /**
     * Checks if provider has any configured keys.
     * @returns {boolean}
     */
    hasKeys() {
        return this.keys && this.keys.length > 0;
    }

    /**
     * Checks if provider has at least one key not currently on cooldown.
     * @returns {boolean}
     */
    hasAvailableKey() {
        if (!this.hasKeys()) return false;
        const now = Date.now();
        return this.keys.some(k => {
            const s = this.keyStates.get(k);
            return !s || now >= s.cooldownUntil;
        });
    }

    /**
     * Returns a summary status of all keys (without leaking secrets).
     * @returns {Array<{ index: number, available: boolean, cooldownSecondsRemaining: number }>}
     */
    getStatus() {
        const now = Date.now();
        return this.keys.map((k, idx) => {
            const s = this.keyStates.get(k) || { cooldownUntil: 0 };
            const remaining = Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000));
            return {
                index: idx + 1,
                available: remaining === 0,
                cooldownSecondsRemaining: remaining
            };
        });
    }
}

module.exports = {
    buildPrompt,
    parseAiResponse,
    KeyRotator
};
