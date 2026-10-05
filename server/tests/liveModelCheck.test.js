/**
 * @file server/tests/liveModelCheck.test.js
 * @description Live network smoke test verifying provider and model names against upstream APIs.
 * Skipped by default in automated CI/CD unless RUN_LIVE_MODEL_TESTS=true is explicitly set.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { testGroqModel, testGeminiModel, testOpenRouterModel, testNvidiaModel } = require('../../scripts/test_provider_models');
const config = require('../src/config');

describe('Live Provider Model Connectivity Smoke Test', () => {
    it('pings configured models and asserts no invalid model names (404/410)', async (t) => {
        if (!process.env.RUN_LIVE_MODEL_TESTS) {
            t.skip('Skipped by default. Set RUN_LIVE_MODEL_TESTS=true to execute live model checks.');
            return;
        }

        const checks = [];

        // Check Groq
        if (config.providers.groq.keys.length > 0) {
            const key = config.providers.groq.keys[0];
            const models = [config.providers.groq.model, config.providers.groq.piiModel, ...(config.providers.groq.fallbackModels || [])];
            for (const model of new Set(models)) {
                checks.push(testGroqModel(key, model).then(r => ({ provider: 'Groq', model, ...r })));
            }
        }

        // Check Gemini
        if (config.providers.gemini.keys.length > 0) {
            const key = config.providers.gemini.keys[0];
            const models = [config.providers.gemini.model, ...(config.providers.gemini.fallbackModels || [])];
            for (const model of new Set(models)) {
                checks.push(testGeminiModel(key, model).then(r => ({ provider: 'Gemini', model, ...r })));
            }
        }

        const results = await Promise.all(checks);

        for (const res of results) {
            // Assert model exists (is not 404 model not found)
            assert.notStrictEqual(res.status, 404, `Model '${res.model}' on provider '${res.provider}' does not exist (HTTP 404)!`);
            assert.notStrictEqual(res.status, 410, `Model '${res.model}' on provider '${res.provider}' is discontinued (HTTP 410)!`);
        }
    });
});
