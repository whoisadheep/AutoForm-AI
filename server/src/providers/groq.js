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
            throw new Error('No Groq API keys available (all keys on cooldown or unconfigured)');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        let lastError = null;

        // Model selection:
        // 1. Pro tier users always get 70B flagship reasoning model (llama-3.3-70b-versatile)
        // 2. PII requests default to 70B with 8B fallback
        // 3. General free requests use configured active model with dynamic fallback
        const isPii = Boolean(
            questionData.hasPii === true ||
            (typeof questionData.customContext === 'string' && questionData.customContext.trim().length > 0)
        );

        let modelsToTry;
        if (questionData.isPro) {
            const proPrimary = 'llama-3.3-70b-versatile';
            modelsToTry = Array.from(new Set([proPrimary, ...(this.config.fallbackModels || ['llama-3.1-8b-instant'])]));
        } else if (isPii) {
            const piiPrimary = this.config.piiModel || 'llama-3.3-70b-versatile';
            modelsToTry = Array.from(new Set([piiPrimary, ...(this.config.fallbackModels || ['llama-3.1-8b-instant'])]));
        } else {
            modelsToTry = [this.activeModel, ...this.candidates.filter(m => m !== this.activeModel)];
        }

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
                        max_tokens: questionData.type === 'resume_parse' ? 2048 : 1024
                    }),
                    signal: controller.signal
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    lastError = new Error(`Groq HTTP ${res.status}: ${errBody}`);

                    const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
                    const isLastModel = model === modelsToTry[modelsToTry.length - 1];

                    if (res.status === 429) {
                        console.warn(`[Groq] Model ${model} rate-limited (429).${isLastModel ? ' No more Groq candidate models.' : ' Trying fallback candidate...'}`);
                        if (isLastModel) {
                            this.rotator.markKeyRateLimited(apiKey, retryAfter);
                            throw lastError;
                        }
                        continue;
                    }

                    if (res.status === 404 || res.status === 410 || errBody.includes('model_not_found') || errBody.includes('does not exist')) {
                        console.warn(`[Groq] Model ${model} unavailable (${res.status}), trying fallback candidate...`);
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
                    throw new Error(`Groq timeout after ${this.config.timeoutMs || 8000}ms`);
                }
                lastError = err;
                if (!err.message.includes('404') && !err.message.includes('410') && !err.message.includes('model_not_found') && !err.message.includes('429')) {
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
