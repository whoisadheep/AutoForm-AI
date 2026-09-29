/**
 * @file server/tests/laya.test.js
 * @description Unit and integration tests for LayaProvider and router delegation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LayaProvider = require('../src/providers/laya');
const router = require('../src/services/router');

describe('LayaProvider Unit Tests', () => {
    it('initializes with default confidence threshold and disabled autoload', () => {
        const provider = new LayaProvider({ autoLoad: false });
        assert.equal(provider.name, 'laya');
        assert.equal(provider.isReady, false);
        assert.equal(provider.confidenceThreshold, 0.70);
    });

    it('correctly filters supported and unsupported question types via canHandle', () => {
        const provider = new LayaProvider({ autoLoad: false });
        provider.isReady = true; // simulate ready state

        // Supported types
        assert.ok(provider.canHandle({ type: 'multiple_choice', choices: ['A', 'B'] }));
        assert.ok(provider.canHandle({ type: 'dropdown', choices: ['Opt 1', 'Opt 2', 'Opt 3'] }));
        assert.ok(provider.canHandle({ type: 'scale', choices: ['1', '2', '3', '4', '5'] }));
        assert.ok(provider.canHandle({ type: 'radio', choices: ['Yes', 'No'] }));
        assert.ok(provider.canHandle({ type: 'select', choices: ['USA', 'India'] }));

        // Unsupported: open-ended text, empty choices, single choice, or too many choices
        assert.equal(provider.canHandle({ type: 'text_input', choices: [] }), false);
        assert.equal(provider.canHandle({ type: 'multiple_choice', choices: [] }), false);
        assert.equal(provider.canHandle({ type: 'multiple_choice', choices: ['OnlyOne'] }), false);
        assert.equal(provider.canHandle({
            type: 'multiple_choice',
            choices: Array.from({ length: 30 }, (_, i) => `Choice ${i}`)
        }), false);
    });

    it('delegates gracefully (isHandoff=true) when model is not ready', async () => {
        const provider = new LayaProvider({ autoLoad: false });
        await assert.rejects(async () => {
            await provider.solve({ question: 'Favorite color?', type: 'multiple_choice', choices: ['Red', 'Blue'] });
        }, (err) => {
            assert.ok(err.isHandoff);
            return true;
        });
    });

    it('delegates gracefully when deep reasoning / math exam questions are detected', async () => {
        const provider = new LayaProvider({ autoLoad: false });
        provider.isReady = true;
        provider.model = {
            systemOne: async () => assert.fail('Should not be called for complex math exam')
        };

        await assert.rejects(async () => {
            await provider.solve({
                question: 'Calculate the derivative of f(x) = x^3 - 4x at x = 2',
                type: 'multiple_choice',
                choices: ['8', '12', '4', '0'],
                customContext: 'QUIZ_EVALUATION'
            });
        }, (err) => {
            assert.ok(err.isHandoff);
            assert.match(err.message, /exam/i);
            return true;
        });
    });

    it('delegates gracefully when Laya confidence score is below threshold', async () => {
        const provider = new LayaProvider({ autoLoad: false, confidenceThreshold: 0.75 });
        provider.isReady = true;
        provider.model = {
            systemOne: async () => ({
                answers: {
                    target: {
                        choice: 'B',
                        confidence: 0.52, // Below 0.75 threshold
                        probabilities: { A: 0.48, B: 0.52 }
                    }
                }
            })
        };

        await assert.rejects(async () => {
            await provider.solve({
                question: 'What is the capital of Australia?',
                type: 'multiple_choice',
                choices: ['Sydney', 'Canberra']
            });
        }, (err) => {
            assert.ok(err.isHandoff);
            assert.match(err.message, /threshold/i);
            return true;
        });
    });

    it('returns answer directly in milliseconds when confidence is high', async () => {
        const provider = new LayaProvider({ autoLoad: false, confidenceThreshold: 0.70 });
        provider.isReady = true;
        provider.model = {
            systemOne: async () => ({
                answers: {
                    target: {
                        choice: 'India',
                        confidence: 0.94,
                        probabilities: { India: 0.94, USA: 0.06 }
                    }
                }
            })
        };

        const res = await provider.solve({
            question: 'What is your country of residence?',
            type: 'multiple_choice',
            choices: ['India', 'USA'],
            customContext: 'User is located in India.'
        });

        assert.equal(res.answer, 'India');
        assert.equal(res.provider, 'laya');
        assert.equal(res.confidence, 0.94);
        assert.ok(typeof res.latencyMs === 'number');
    });
});

describe('Laya + ProviderRouter Integration', () => {
    it('seamlessly hands off from Laya to Groq/Gemini on open-text questions without tripping circuit breaker', async () => {
        const mockLaya = new LayaProvider({ autoLoad: false });
        // Laya is configured in router
        router.providers.set('laya', mockLaya);

        const mockGroq = {
            solve: async (q) => ({ answer: 'Open text response from Groq', provider: 'groq' })
        };
        router.providers.set('groq', mockGroq);
        router.circuitBreaker.reset('laya');
        router.circuitBreaker.reset('groq');

        // Solve open-ended text question (Laya cannot handle this, so it hands off)
        const res = await router.solve({
            question: 'Tell me about yourself',
            type: 'text_input',
            choices: []
        });

        assert.equal(res.answer, 'Open text response from Groq');
        assert.equal(res.provider, 'groq');
        // Circuit breaker for laya should STILL be CLOSED because isHandoff was true
        assert.equal(router.circuitBreaker.getState('laya').state, 'CLOSED');
    });
});
