/**
 * @file server/tests/routerCircuitBreaker.test.js
 * @description Integration test verifying ProviderRouter bypasses tripped providers.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/services/router');

describe('ProviderRouter + CircuitBreaker Integration', () => {
    it('reports circuit breaker status in getStatus()', () => {
        const status = router.getStatus();
        assert.ok(status.metrics);
        assert.ok(Array.isArray(status.activeProviders));
    });

    it('bypasses a provider when its circuit trips to OPEN', async () => {
        // Mock a test provider in router
        let attempts = 0;
        const mockFailingProvider = {
            solve: async () => {
                attempts++;
                throw new Error('Upstream timeout');
            }
        };

        const mockSuccessProvider = {
            solve: async () => {
                return { answer: 'Mock Answer' };
            }
        };

        router.providers.set('groq', mockFailingProvider);
        router.providers.set('gemini', mockSuccessProvider);
        router.circuitBreaker.reset('groq');
        router.circuitBreaker.reset('gemini');

        // Initial priority is ['groq', 'gemini', 'nvidia']
        // Fail groq 3 times
        for (let i = 0; i < 3; i++) {
            const res = await router.solve({ question: 'Test?', type: 'multiple_choice' });
            assert.equal(res.provider, 'gemini');
        }

        assert.equal(attempts, 3);
        assert.equal(router.circuitBreaker.getState('groq').state, 'OPEN');

        // On 4th call, groq circuit is OPEN -> should immediately bypass groq without calling it!
        const start = Date.now();
        const res = await router.solve({ question: 'Test 2?', type: 'multiple_choice' });
        const elapsed = Date.now() - start;

        assert.equal(res.provider, 'gemini');
        assert.equal(attempts, 3); // Still 3! Groq was NOT called!
        assert.ok(elapsed < 50); // Instant 0ms bypass

        const status = router.getStatus();
        assert.equal(status.metrics.groq.circuit.state, 'OPEN');
        assert.equal(status.metrics.gemini.circuit.state, 'CLOSED');
    });
});

describe('ProviderRouter Data Sensitivity & Zero-Retention PII Routing', () => {
    it('strictly routes PII requests only to allow-listed zero-retention providers and never falls back to secondary providers', async () => {
        let groqAttempts = 0;
        let geminiAttempts = 0;
        let nvidiaAttempts = 0;

        const mockFailingGroq = {
            solve: async () => {
                groqAttempts++;
                throw new Error('Groq 503 service unavailable');
            }
        };

        const mockSuccessGemini = {
            solve: async () => {
                geminiAttempts++;
                return { answer: 'Gemini Answer' };
            }
        };

        const mockSuccessNvidia = {
            solve: async () => {
                nvidiaAttempts++;
                return { answer: 'NVIDIA Answer' };
            }
        };

        router.providers.set('groq', mockFailingGroq);
        router.providers.set('gemini', mockSuccessGemini);
        router.providers.set('nvidia', mockSuccessNvidia);
        router.circuitBreaker.reset('groq');
        router.circuitBreaker.reset('gemini');
        router.circuitBreaker.reset('nvidia');

        // Set allowlist to Groq only (default)
        router.piiAllowedProviders = ['groq'];

        // 1. PII Request with customContext: Groq fails -> MUST NOT fallback to Gemini or NVIDIA
        await assert.rejects(
            async () => {
                await router.solve({
                    question: 'What is your work experience?',
                    type: 'text',
                    customContext: 'Name: Alex Rivera, Role: Senior Full-Stack Engineer at TechCorp'
                });
            },
            (err) => {
                assert.strictEqual(err.code, 'PII_PROVIDER_UNAVAILABLE');
                assert.strictEqual(err.statusCode, 503);
                assert.strictEqual(err.retryable, true);
                assert.match(err.message, /zero-retention AI providers failed for personal profile data/i);
                return true;
            }
        );

        assert.strictEqual(groqAttempts, 1);
        assert.strictEqual(geminiAttempts, 0, 'Gemini was invoked for a PII request when Groq failed!');
        assert.strictEqual(nvidiaAttempts, 0, 'NVIDIA was invoked for a PII request when Groq failed!');

        // 2. Non-PII Request (no customContext): Groq fails -> MUST fall back to Gemini
        const nonPiiRes = await router.solve({
            question: 'What is the capital of France?',
            type: 'text'
        });

        assert.strictEqual(nonPiiRes.provider, 'gemini');
        assert.strictEqual(nonPiiRes.answer, 'Gemini Answer');
        assert.strictEqual(geminiAttempts, 1, 'Gemini was not called during standard fallback!');

        // 3. PII Request with successful Groq provider
        const mockWorkingGroq = {
            solve: async () => {
                return { answer: 'Alex Rivera Software Engineer' };
            }
        };
        router.providers.set('groq', mockWorkingGroq);
        router.circuitBreaker.reset('groq');

        const piiSuccessRes = await router.solve({
            question: 'What is your name?',
            type: 'text',
            customContext: 'Name: Alex Rivera'
        });

        assert.strictEqual(piiSuccessRes.provider, 'groq');
        assert.strictEqual(piiSuccessRes.answer, 'Alex Rivera Software Engineer');

        // 4. Custom allowlist configuration (e.g. Gemini added to allowlist)
        router.piiAllowedProviders = ['gemini'];
        const geminiPiiRes = await router.solve({
            question: 'Tell me about yourself',
            type: 'text',
            customContext: 'User profile: Alex'
        });
        assert.strictEqual(geminiPiiRes.provider, 'gemini');

        // 5. No allowlisted providers available
        router.piiAllowedProviders = ['non_existent_provider'];
        await assert.rejects(
            async () => {
                await router.solve({
                    question: 'What is your education?',
                    type: 'text',
                    customContext: 'UC Berkeley BS CS'
                });
            },
            (err) => {
                assert.strictEqual(err.code, 'PII_PROVIDER_UNAVAILABLE');
                assert.strictEqual(err.statusCode, 503);
                assert.strictEqual(err.retryable, true);
                assert.match(err.message, /No zero-retention AI providers are configured or available/i);
                return true;
            }
        );

        // Reset allowlist
        router.piiAllowedProviders = ['groq'];
    });
});

