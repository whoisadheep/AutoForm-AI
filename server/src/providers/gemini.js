/**
 * @file server/src/providers/gemini.js
 * @description Google Gemini API adapter.
 */

const { buildPrompt, parseAiResponse, KeyRotator } = require('./base');

class GeminiProvider {
    constructor(config) {
        this.config = config;
        this.rotator = new KeyRotator(config.keys);
    }

    async solve(questionData) {
        const apiKey = this.rotator.getKey();
        if (!apiKey) {
            throw new Error('No Gemini API keys available');
        }

        const { systemPrompt, userPrompt } = buildPrompt(questionData);
        const url = `${this.config.endpoint}/${this.config.model}:generateContent?key=${apiKey}`;

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
                throw new Error(`Gemini HTTP ${res.status}: ${errBody}`);
            }

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            return parseAiResponse(text, questionData.type);

        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = GeminiProvider;
