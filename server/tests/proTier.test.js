/**
 * @file server/tests/proTier.test.js
 * @description Unit tests verifying exclusive Pro tier benefits:
 * - STAR-method executive reasoning prompts for open-ended questions
 * - Flagship 70B model prioritization on Groq
 * - Tier metadata in router solve responses
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt } = require('../src/providers/base');
const GroqProvider = require('../src/providers/groq');
const router = require('../src/services/router');

describe('Exclusive Pro Tier Features & Routing', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('injects STAR-method executive reasoning into prompt for Pro users on open-ended questions', () => {
        const freePrompt = buildPrompt({
            question: 'Describe a significant leadership challenge you overcame.',
            type: 'text_input',
            customContext: 'I led a team of 4 engineers.',
            isPro: false
        });

        assert.ok(!freePrompt.userPrompt.includes('PRO EXECUTIVE REASONING'));
        assert.ok(!freePrompt.userPrompt.includes('STAR framework'));

        const proPrompt = buildPrompt({
            question: 'Describe a significant leadership challenge you overcame.',
            type: 'text_input',
            customContext: 'I led a team of 4 engineers.',
            isPro: true
        });

        assert.ok(proPrompt.userPrompt.includes('PRO EXECUTIVE REASONING'));
        assert.ok(proPrompt.userPrompt.includes('STAR framework (Situation, Task, Action, Result)'));
        assert.ok(proPrompt.userPrompt.includes('quantifiable impact'));
    });

    it('prioritizes 70B flagship model on Groq for Pro users even without personal context', async () => {
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
                                content: JSON.stringify({ answer: 'Pro Answer' })
                            }
                        }
                    ]
                })
            };
        };

        const provider = new GroqProvider({
            keys: ['gsk_mock_test_key'],
            model: 'llama-3.1-8b-instant', // Default configured is 8B
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            timeoutMs: 3000
        });

        // Non-Pro request with 8B default
        await provider.solve({
            question: 'What is 2+2?',
            type: 'text_input',
            isPro: false
        });

        assert.equal(attemptedModels[0], 'llama-3.1-8b-instant');

        // Pro request -> must override to 70B flagship model
        await provider.solve({
            question: 'What is 2+2?',
            type: 'text_input',
            isPro: true
        });

        assert.equal(attemptedModels[1], 'llama-3.3-70b-versatile');
    });

    it('reports tier and modelTier correctly in router.solve', async () => {
        const mockProvider = {
            solve: async () => ({ answer: 'Success' })
        };

        const originalGroq = router.providers.get('groq');
        const originalPriority = [...router.priority];

        router.providers.set('mockProProvider', mockProvider);
        router.priority = ['mockProProvider'];

        try {
            const freeResult = await router.solve({
                question: 'Test Question',
                type: 'text_input',
                isPro: false
            });

            assert.equal(freeResult.tier, 'free');
            assert.equal(freeResult.modelTier, 'standard');

            const proResult = await router.solve({
                question: 'Test Question',
                type: 'text_input',
                isPro: true
            });

            assert.equal(proResult.tier, 'pro');
            assert.equal(proResult.modelTier, '70b-flagship-reasoning');
        } finally {
            router.providers.delete('mockProProvider');
            if (originalGroq) router.providers.set('groq', originalGroq);
            router.priority = originalPriority;
        }
    });
});
