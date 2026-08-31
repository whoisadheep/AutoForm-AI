/**
 * @file server/src/providers/nvidia.js
 * @description NVIDIA NIM API adapter (Llama 3 / Mistral hosted on NVIDIA infrastructure).
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class NvidiaProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No NVIDIA API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);

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
                    model: this.config.model,
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
                throw new Error(`NVIDIA HTTP ${res.status}: ${errBody}`);
            }

            const data = await res.json();
            const content = data.choices?.[0]?.message?.content;
            return parseAiResponse(content, questionData.type);

        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = NvidiaProvider;
