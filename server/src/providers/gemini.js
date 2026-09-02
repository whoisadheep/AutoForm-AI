/**
 * @file server/src/providers/gemini.js
 * @description Google Gemini API adapter with dynamic multi-model fallback.
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class GeminiProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
        this.activeModel = config.model;
        this.candidates = Array.from(new Set([config.model, ...(config.fallbackModels || [])]));
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No Gemini API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        let lastError = null;

        const modelsToTry = [this.activeModel, ...this.candidates.filter(m => m !== this.activeModel)];

        for (const model of modelsToTry) {
            const url = `${this.config.endpoint}/${model}:generateContent?key=${apiKey}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 12000);

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{ text: systemPrompt }]
                        },
                        contents: [{
                            parts: [{ text: userPrompt }]
                        }],
                        generationConfig: {
                            responseMimeType: 'application/json',
                            temperature: 0.2,
                            maxOutputTokens: 1024
                        }
                    }),
                    signal: controller.signal
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    lastError = new Error(`Gemini HTTP ${res.status}: ${errBody}`);
                    if (res.status === 404 || res.status === 410 || errBody.includes('NOT_FOUND') || errBody.includes('no longer available')) {
                        console.warn(`[Gemini] Model ${model} unavailable (${res.status}), trying fallback candidate...`);
                        continue;
                    }
                    throw lastError;
                }

                const data = await res.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                this.activeModel = model;
                return parseAiResponse(text, questionData.type);

            } catch (err) {
                if (err.name === 'AbortError') {
                    throw new Error(`Gemini timeout after ${this.config.timeoutMs || 12000}ms`);
                }
                lastError = err;
                if (!err.message.includes('404') && !err.message.includes('410') && !err.message.includes('NOT_FOUND')) {
                    throw err;
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('All Gemini candidate models failed');
    }
}

module.exports = GeminiProvider;
