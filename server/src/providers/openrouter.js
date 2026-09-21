/**
 * @file server/src/providers/openrouter.js
 * @description OpenRouter API adapter with free tier multi-model fallback and auto-routing.
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class OpenRouterProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
        this.activeModel = config.model || 'openrouter/free';
        this.candidates = Array.from(new Set([config.model, ...(config.fallbackModels || [])]));
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No OpenRouter API keys available (all keys on cooldown or unconfigured)');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        let lastError = null;

        const modelsToTry = [this.activeModel, ...this.candidates.filter(m => m !== this.activeModel)];

        for (const model of modelsToTry) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 15000);

            try {
                const res = await fetch(this.config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': 'https://github.com/whoisadheep/AutoForm-AI',
                        'X-Title': 'AutoForm AI',
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
                    lastError = new Error(`OpenRouter HTTP ${res.status}: ${errBody}`);

                    if (res.status === 429) {
                        const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
                        this.rotator.markKeyRateLimited(apiKey, retryAfter);
                    }

                    // If model is rate-limited, unavailable, or not found on free pool, try next candidate
                    if (res.status === 404 || res.status === 410 || res.status === 429 || errBody.includes('temporarily rate-limited') || errBody.includes('unavailable')) {
                        console.warn(`[OpenRouter] Model ${model} returned ${res.status}, trying next fallback candidate...`);
                        continue;
                    }
                    throw lastError;
                }

                const data = await res.json();
                const content = data.choices?.[0]?.message?.content;
                this.activeModel = model;
                this.rotator.markKeySuccess(apiKey);
                return parseAiResponse(content, questionData.type, questionData.choices);

            } catch (err) {
                if (err.name === 'AbortError') {
                    throw new Error(`OpenRouter timeout after ${this.config.timeoutMs || 15000}ms`);
                }
                lastError = err;
                if (!err.message.includes('404') && !err.message.includes('410') && !err.message.includes('429')) {
                    throw err;
                }
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('All OpenRouter candidate models failed');
    }
}

module.exports = OpenRouterProvider;
