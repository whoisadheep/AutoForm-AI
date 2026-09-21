/**
 * @file server/tests/keyRotator.test.js
 * @description Unit tests for KeyRotator 429 cooldown and recovery.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KeyRotator } = require('../src/providers/base');

describe('KeyRotator', () => {
    it('rotates round-robin across healthy keys', () => {
        const rotator = new KeyRotator(['key-A', 'key-B', 'key-C']);

        assert.equal(rotator.getKey(), 'key-A');
        assert.equal(rotator.getKey(), 'key-B');
        assert.equal(rotator.getKey(), 'key-C');
        assert.equal(rotator.getKey(), 'key-A');
    });

    it('skips a key placed on cooldown after a 429', () => {
        const rotator = new KeyRotator(['key-A', 'key-B', 'key-C'], 5000);

        // First call gets key-A
        const key1 = rotator.getKey();
        assert.equal(key1, 'key-A');

        // Mark key-A as rate-limited (429)
        rotator.markKeyRateLimited('key-A', 10); // 10s cooldown

        // Subsequent calls should skip key-A and alternate between key-B and key-C
        assert.equal(rotator.getKey(), 'key-B');
        assert.equal(rotator.getKey(), 'key-C');
        assert.equal(rotator.getKey(), 'key-B');
        assert.equal(rotator.getKey(), 'key-C');
    });

    it('returns null and reports hasAvailableKey false when all keys are on cooldown', () => {
        const rotator = new KeyRotator(['key-1', 'key-2'], 5000);

        rotator.markKeyRateLimited('key-1', 10);
        rotator.markKeyRateLimited('key-2', 10);

        assert.equal(rotator.hasAvailableKey(), false);
        assert.equal(rotator.getKey(), null);
    });

    it('recovers a key once cooldown period expires', async () => {
        const rotator = new KeyRotator(['key-fast'], 50);

        rotator.markKeyRateLimited('key-fast', 0.05); // 50ms cooldown
        assert.equal(rotator.getKey(), null);

        await new Promise(r => setTimeout(r, 60));

        assert.equal(rotator.hasAvailableKey(), true);
        assert.equal(rotator.getKey(), 'key-fast');
    });

    it('resets cooldown and consecutive count on markKeySuccess', () => {
        const rotator = new KeyRotator(['key-x'], 5000);

        rotator.markKeyRateLimited('key-x', 100);
        assert.equal(rotator.getKey(), null);

        rotator.markKeySuccess('key-x');
        assert.equal(rotator.getKey(), 'key-x');
    });
});
