/**
 * @file server/tests/openrouter.test.js
 * @description Integration test for OpenRouter provider with free model routing.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const OpenRouterProvider = require('../src/providers/openrouter');

describe('OpenRouterProvider', () => {
    it('initializes with openrouter/free model', () => {
        const provider = new OpenRouterProvider(config.providers.openrouter);
        assert.equal(provider.activeModel, 'openrouter/free');
        assert.ok(provider.rotator.hasKeys());
    });

    it('solves a sample multiple-choice question using OpenRouter free model', async (t) => {
        const provider = new OpenRouterProvider(config.providers.openrouter);

        const questionData = {
            question: 'What is the capital of France?',
            type: 'multiple_choice',
            choices: ['Berlin', 'Madrid', 'Paris', 'Rome']
        };

        try {
            const result = await provider.solve(questionData);
            assert.ok(result);
            assert.ok(result.answer);
            assert.equal(result.answer, 'Paris');
        } catch (err) {
            if (err.message.includes('timeout') || err.message.includes('fetch failed') || err.message.includes('Connect Timeout') || err.message.includes('non-JSON output') || err.message.includes('Rate limit') || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
                t.skip(`Skipping OpenRouter live test due to upstream network fluctuation: ${err.message}`);
                return;
            }
            throw err;
        }
    });
});
