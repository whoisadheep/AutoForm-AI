/**
 * @file server/tests/groq.test.js
 * @description Comprehensive unit tests for GroqProvider:
 * - 70B model (llama-3.3-70b-versatile) default for PII
 * - Graceful fallback to 8B model (llama-3.1-8b-instant) on 429 rate-limiting
 * - KeyRotator cooldown on comprehensive model exhaustion
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const GroqProvider = require('../src/providers/groq');

describe('GroqProvider Quality & Rate Limit Fallback', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('initializes with llama-3.3-70b-versatile as default model and configures fallback models', () => {
        const provider = new GroqProvider({
            keys: ['gsk_test_mock_key_001'],
            model: 'llama-3.3-70b-versatile',
            piiModel: 'llama-3.3-70b-versatile',
            fallbackModels: ['llama-3.1-8b-instant'],
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            timeoutMs: 5000
        });

        assert.strictEqual(provider.activeModel, 'llama-3.3-70b-versatile');
        assert.ok(provider.candidates.includes('llama-3.1-8b-instant'));
        assert.strictEqual(provider.rotator.hasKeys(), true);
    });

    it('prioritizes llama-3.3-70b-versatile for PII requests containing user customContext', async () => {
        const attemptedModels = [];

        global.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            attemptedModels.push(body.model);

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({ answer: 'San Francisco, CA' })
                            }
                        }
                    ]
                })
            };
        };

        const provider = new GroqProvider({
            keys: ['gsk_test_mock_key_001'],
            model: 'llama-3.3-70b-versatile',
            piiModel: 'llama-3.3-70b-versatile',
            fallbackModels: ['llama-3.1-8b-instant'],
            endpoint: 'https://api.groq.com/openai/v1/chat/completions'
        });

        const res = await provider.solve({
            question: 'Where are you currently located?',
            type: 'text',
            customContext: 'Name: Alex Rivera, Location: San Francisco, CA'
        });

        assert.strictEqual(attemptedModels.length, 1);
        assert.strictEqual(attemptedModels[0], 'llama-3.3-70b-versatile', 'Did not use 70B versatile model for PII request');
        assert.strictEqual(res.answer, 'San Francisco, CA');
    });

    it('gracefully falls back from 70B to 8B on 429 rate limit without marking key on cooldown prematurely', async () => {
        const attemptedModels = [];

        global.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            attemptedModels.push(body.model);

            if (body.model === 'llama-3.3-70b-versatile') {
                // 70B model rate-limited (e.g. TPM exhausted)
                return {
                    ok: false,
                    status: 429,
                    headers: new Map([['retry-after', '30']]),
                    text: async () => 'Rate limit exceeded: TPM limit reached for llama-3.3-70b-versatile'
                };
            }

            // Fallback 8B model succeeds
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({ answer: 'UC Berkeley' })
                            }
                        }
                    ]
                })
            };
        };

        const provider = new GroqProvider({
            keys: ['gsk_test_mock_key_001'],
            model: 'llama-3.3-70b-versatile',
            piiModel: 'llama-3.3-70b-versatile',
            fallbackModels: ['llama-3.1-8b-instant'],
            endpoint: 'https://api.groq.com/openai/v1/chat/completions'
        });

        const res = await provider.solve({
            question: 'What university did you attend?',
            type: 'text',
            customContext: 'Education: UC Berkeley, Degree: BS CS'
        });

        assert.strictEqual(attemptedModels.length, 2);
        assert.strictEqual(attemptedModels[0], 'llama-3.3-70b-versatile');
        assert.strictEqual(attemptedModels[1], 'llama-3.1-8b-instant');
        assert.strictEqual(res.answer, 'UC Berkeley');

        // Key should still be available because the fallback model succeeded
        assert.strictEqual(provider.rotator.hasAvailableKey(), true);
    });

    it('marks key on cooldown and throws when all Groq candidate models fail with 429', async () => {
        const attemptedModels = [];

        global.fetch = async (url, options) => {
            const body = JSON.parse(options.body);
            attemptedModels.push(body.model);

            return {
                ok: false,
                status: 429,
                headers: new Map([['retry-after', '45']]),
                text: async () => `Rate limit exceeded for model ${body.model}`
            };
        };

        const provider = new GroqProvider({
            keys: ['gsk_test_mock_key_001'],
            model: 'llama-3.3-70b-versatile',
            piiModel: 'llama-3.3-70b-versatile',
            fallbackModels: ['llama-3.1-8b-instant'],
            endpoint: 'https://api.groq.com/openai/v1/chat/completions'
        });

        await assert.rejects(
            async () => {
                await provider.solve({
                    question: 'What is your graduation year?',
                    type: 'text',
                    customContext: 'Graduation Year: 2026'
                });
            },
            (err) => {
                assert.match(err.message, /Groq HTTP 429/);
                return true;
            }
        );

        assert.strictEqual(attemptedModels.length, 2);
        assert.strictEqual(attemptedModels[0], 'llama-3.3-70b-versatile');
        assert.strictEqual(attemptedModels[1], 'llama-3.1-8b-instant');

        // Since both 70B and 8B were exhausted with 429, the key should now be in cooldown
        assert.strictEqual(provider.rotator.hasAvailableKey(), false);
    });
});
