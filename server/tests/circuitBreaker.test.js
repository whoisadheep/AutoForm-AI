/**
 * @file server/tests/circuitBreaker.test.js
 * @description Unit tests for CircuitBreaker state transitions and self-healing.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CircuitBreaker, STATES } = require('../src/services/circuitBreaker');

describe('CircuitBreaker', () => {
    it('initializes in CLOSED state with 0 failures', () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
        const state = cb.getState('groq');

        assert.equal(state.state, STATES.CLOSED);
        assert.equal(state.consecutiveFailures, 0);
        assert.equal(state.totalTrips, 0);
        assert.equal(cb.canExecute('groq'), true);
    });

    it('trips to OPEN state when failure threshold is reached', () => {
        const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });

        cb.recordFailure('groq', new Error('Timeout'));
        assert.equal(cb.getState('groq').state, STATES.CLOSED);
        assert.equal(cb.canExecute('groq'), true);

        cb.recordFailure('groq', new Error('Timeout'));
        assert.equal(cb.getState('groq').state, STATES.CLOSED);
        assert.equal(cb.canExecute('groq'), true);

        // 3rd consecutive failure trips to OPEN
        cb.recordFailure('groq', new Error('503 Service Unavailable'));
        const state = cb.getState('groq');
        assert.equal(state.state, STATES.OPEN);
        assert.equal(state.totalTrips, 1);
        assert.equal(state.consecutiveFailures, 3);

        // Fails fast immediately:
        assert.equal(cb.canExecute('groq'), false);
    });

    it('transitions to HALF_OPEN after timeout and recovers upon success', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

        cb.recordFailure('gemini', 'Error 1');
        cb.recordFailure('gemini', 'Error 2');
        assert.equal(cb.getState('gemini').state, STATES.OPEN);
        assert.equal(cb.canExecute('gemini'), false);

        // Wait for reset timeout
        await new Promise(r => setTimeout(r, 60));

        // First attempt after timeout should be allowed as canary
        assert.equal(cb.canExecute('gemini'), true);
        assert.equal(cb.getState('gemini').state, STATES.HALF_OPEN);

        // While canary is in-flight, subsequent requests should be rejected
        assert.equal(cb.canExecute('gemini'), false);

        // Canary succeeds!
        cb.recordSuccess('gemini');
        assert.equal(cb.getState('gemini').state, STATES.CLOSED);
        assert.equal(cb.getState('gemini').consecutiveFailures, 0);
        assert.equal(cb.canExecute('gemini'), true);
    });

    it('re-trips to OPEN if canary trial fails in HALF_OPEN', async () => {
        const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

        cb.recordFailure('nvidia', 'Error 1');
        cb.recordFailure('nvidia', 'Error 2');
        assert.equal(cb.getState('nvidia').state, STATES.OPEN);

        await new Promise(r => setTimeout(r, 60));
        assert.equal(cb.canExecute('nvidia'), true); // Canary probe permitted
        assert.equal(cb.getState('nvidia').state, STATES.HALF_OPEN);

        // Canary probe fails!
        cb.recordFailure('nvidia', 'Canary probe failed');
        assert.equal(cb.getState('nvidia').state, STATES.OPEN);
        assert.equal(cb.getState('nvidia').totalTrips, 2);
        assert.equal(cb.canExecute('nvidia'), false);
    });
});
