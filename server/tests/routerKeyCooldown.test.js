/**
 * @file server/tests/routerKeyCooldown.test.js
 * @description Integration test verifying Router immediately bypasses providers whose keys are on 429 cooldown.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/services/router');
const { KeyRotator } = require('../src/providers/base');

describe('ProviderRouter + KeyRotator 429 Cooldown', () => {
    it('immediately bypasses a provider when all its keys are in cooldown', async () => {
        let groqCalls = 0;
        const mockGroq = {
            rotator: new KeyRotator(['key-1', 'key-2'], 5000),
            solve: async () => {
                groqCalls++;
                return { answer: 'Groq Answer' };
            }
        };

        const mockGemini = {
            rotator: new KeyRotator(['gemini-key'], 5000),
            solve: async () => {
                return { answer: 'Gemini Answer' };
            }
        };

        router.providers.set('groq', mockGroq);
        router.providers.set('gemini', mockGemini);
        router.circuitBreaker.reset('groq');
        router.circuitBreaker.reset('gemini');

        // Put all groq keys on cooldown
        mockGroq.rotator.markKeyRateLimited('key-1', 10);
        mockGroq.rotator.markKeyRateLimited('key-2', 10);

        assert.equal(mockGroq.rotator.hasAvailableKey(), false);

        // Call solve: Groq should be bypassed in 0ms without invoking mockGroq.solve
        const start = Date.now();
        const res = await router.solve({ question: 'Test question', type: 'multiple_choice' });
        const elapsed = Date.now() - start;

        assert.equal(res.provider, 'gemini');
        assert.equal(res.answer, 'Gemini Answer');
        assert.equal(groqCalls, 0); // Groq was never invoked!
        assert.ok(elapsed < 50); // Instant bypass

        const status = router.getStatus();
        assert.equal(status.metrics.groq.keys[0].available, false);
        assert.equal(status.metrics.groq.keys[1].available, false);
        assert.equal(status.metrics.gemini.keys[0].available, true);
    });
});
