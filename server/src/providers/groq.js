/**
 * @file server/src/providers/groq.js
 * @description Groq API adapter (ultra-fast Llama 3 models).
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class GroqProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No Groq API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);

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
                    model: this.config.model,
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
                throw new Error(`Groq HTTP ${res.status}: ${errBody}`);
            }

            const data = await res.json();
            const content = data.choices?.[0]?.message?.content;
            return parseAiResponse(content, questionData.type);

        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = GroqProvider;
