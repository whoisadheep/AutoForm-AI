/**
 * @file server/src/providers/groq.js
 * @description Groq API adapter with dynamic multi-model fallback.
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class GroqProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
        this.activeModel = config.model;
        this.candidates = Array.from(new Set([config.model, ...(config.fallbackModels || [])]));
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No Groq API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        let lastError = null;

        const modelsToTry = [this.activeModel, ...this.candidates.filter(m => m !== this.activeModel)];

        for (const model of modelsToTry) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 8000);

            try {
                const res = await fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        response_format: { type: 'json_object' },
                        temperature: 0.2,
                        max_tokens: 1024
                    }),
                    signal: controller.signal
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    lastError = new Error(`Groq HTTP ${res.status}: ${errBody}`);
                    if (res.status === 404 || res.status === 410 || errBody.includes('model_not_found') || errBody.includes('does not exist')) {
                        console.warn(`[Groq] Model ${model} unavailable (${res.status}), trying fallback candidate...`);
                        continue;
                    }
                    throw lastError;
                }

                const data = await res.json();
                const content = data.choices?.[0]?.message?.content;
                this.activeModel = model;
                return parseAiResponse(content, questionData.type);

            } catch (err) {
                if (err.name === 'AbortError') {
                    throw new Error(`Groq timeout after ${this.config.timeoutMs || 8000}ms`);
                }
                lastError = err;
                if (!err.message.includes('404') && !err.message.includes('410') && !err.message.includes('model_not_found')) {
                    throw err;
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('All Groq candidate models failed');
    }
}

module.exports = GroqProvider;
