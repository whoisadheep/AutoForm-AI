/**
 * @file server/src/providers/nvidia.js
 * @description NVIDIA NIM API adapter with dynamic multi-model fallback.
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class NvidiaProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
        this.activeModel = config.model;
        this.candidates = Array.from(new Set([config.model, ...(config.fallbackModels || [])]));
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No NVIDIA API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        let lastError = null;

        const modelsToTry = [this.activeModel, ...this.candidates.filter(m => m !== this.activeModel)];

        for (const model of modelsToTry) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 12000);

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
                        temperature: 0.2,
                        max_tokens: 1024
                    }),
                    signal: controller.signal
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    lastError = new Error(`NVIDIA HTTP ${res.status}: ${errBody}`);
                    if (res.status === 404 || res.status === 410 || errBody.includes('end of life') || errBody.includes('Gone')) {
                        console.warn(`[NVIDIA] Model ${model} unavailable (${res.status}), trying fallback candidate...`);
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
                    throw new Error(`NVIDIA timeout after ${this.config.timeoutMs || 12000}ms`);
                }
                lastError = err;
                if (!err.message.includes('404') && !err.message.includes('410') && !err.message.includes('Gone')) {
                    throw err;
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('All NVIDIA candidate models failed');
    }
}

module.exports = NvidiaProvider;
