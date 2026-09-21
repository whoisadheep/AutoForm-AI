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
