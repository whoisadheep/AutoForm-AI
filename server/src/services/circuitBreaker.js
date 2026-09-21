/**
 * @file server/src/services/circuitBreaker.js
 * @description Enterprise Circuit Breaker pattern with self-healing recovery and canary testing.
 * Prevents cascading latency when upstream AI providers (Groq, Gemini, NVIDIA) degrade or fail.
 */

const STATES = {
    CLOSED: 'CLOSED',       // Normal operation: requests pass through
    OPEN: 'OPEN',           // Tripped: requests fail fast immediately (0ms penalty)
    HALF_OPEN: 'HALF_OPEN'  // Canary testing: trial request evaluates if service recovered
};

class CircuitBreaker {
    /**
     * @param {Object} [options]
     * @param {number} [options.failureThreshold=3] - Consecutive failures needed to trip circuit
     * @param {number} [options.resetTimeoutMs=30000] - Duration circuit stays OPEN before entering HALF_OPEN
     */
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 3;
        this.resetTimeoutMs = options.resetTimeoutMs || 30000;

        /** @type {Map<string, Object>} */
        this.circuits = new Map();
    }

    /**
     * Retrieves or initializes the circuit record for a service.
     * @private
     * @param {string} service
     * @returns {Object}
     */
    _getCircuit(service) {
        if (!this.circuits.has(service)) {
            this.circuits.set(service, {
                state: STATES.CLOSED,
                consecutiveFailures: 0,
                lastFailureAt: null,
                lastSuccessAt: null,
                lastTrippedAt: null,
                lastError: null,
                totalTrips: 0,
                canaryInFlight: false
            });
        }
        return this.circuits.get(service);
    }

    /**
     * Determines whether a call to the specified service should be permitted.
     * @param {string} service - Provider name (e.g. 'groq', 'gemini', 'nvidia')
     * @returns {boolean} True if the request should proceed, false if it should fail fast.
     */
    canExecute(service) {
        const circuit = this._getCircuit(service);
        const now = Date.now();

        if (circuit.state === STATES.CLOSED) {
            return true;
        }

        if (circuit.state === STATES.OPEN) {
            // Check if cooldown period elapsed to attempt canary recovery
            if (now - circuit.lastTrippedAt >= this.resetTimeoutMs) {
                circuit.state = STATES.HALF_OPEN;
                circuit.canaryInFlight = true;
                console.info(`[CircuitBreaker] Service '${service}' entered HALF_OPEN state. Testing canary request...`);
                return true;
            }
            return false;
        }

        if (circuit.state === STATES.HALF_OPEN) {
            // Only allow one canary trial at a time
            if (!circuit.canaryInFlight) {
                circuit.canaryInFlight = true;
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * Records a successful execution for the service, resetting circuit to CLOSED.
     * @param {string} service
     */
    recordSuccess(service) {
        const circuit = this._getCircuit(service);
        circuit.consecutiveFailures = 0;
        circuit.lastSuccessAt = new Date().toISOString();
        circuit.canaryInFlight = false;

        if (circuit.state !== STATES.CLOSED) {
            console.info(`[CircuitBreaker] Service '${service}' recovered successfully! Circuit reset to CLOSED.`);
            circuit.state = STATES.CLOSED;
        }
    }

    /**
     * Records a failure for the service, tripping the circuit to OPEN if threshold is met.
     * @param {string} service
     * @param {Error|string} error
     */
    recordFailure(service, error) {
        const circuit = this._getCircuit(service);
        circuit.consecutiveFailures++;
        circuit.lastFailureAt = new Date().toISOString();
        circuit.lastError = typeof error === 'string' ? error : error?.message || 'Unknown error';
        circuit.canaryInFlight = false;

        if (circuit.state === STATES.HALF_OPEN) {
            // Canary trial failed: re-trip back to OPEN immediately with full timeout
            circuit.state = STATES.OPEN;
            circuit.lastTrippedAt = Date.now();
            circuit.totalTrips++;
            console.warn(`[CircuitBreaker] Canary trial for '${service}' failed (${circuit.lastError}). Circuit reopened for ${this.resetTimeoutMs}ms.`);
            return;
        }

        if (circuit.state === STATES.CLOSED && circuit.consecutiveFailures >= this.failureThreshold) {
            circuit.state = STATES.OPEN;
            circuit.lastTrippedAt = Date.now();
            circuit.totalTrips++;
            console.warn(`[CircuitBreaker] Service '${service}' exceeded failure threshold (${circuit.consecutiveFailures}/${this.failureThreshold}). Circuit tripped to OPEN for ${this.resetTimeoutMs}ms.`);
        }
    }

    /**
     * Returns the circuit status and metrics for a specific service.
     * @param {string} service
     * @returns {Object}
     */
    getState(service) {
        const circuit = this._getCircuit(service);
        const now = Date.now();
        const timeUntilNextProbeMs = circuit.state === STATES.OPEN
            ? Math.max(0, this.resetTimeoutMs - (now - (circuit.lastTrippedAt || 0)))
            : 0;

        return {
            state: circuit.state,
            consecutiveFailures: circuit.consecutiveFailures,
            failureThreshold: this.failureThreshold,
            resetTimeoutMs: this.resetTimeoutMs,
            timeUntilNextProbeMs,
            totalTrips: circuit.totalTrips,
            lastTrippedAt: circuit.lastTrippedAt ? new Date(circuit.lastTrippedAt).toISOString() : null,
            lastFailureAt: circuit.lastFailureAt,
            lastSuccessAt: circuit.lastSuccessAt,
            lastError: circuit.lastError
        };
    }

    /**
     * Returns status for all tracked services.
     * @returns {Object<string, Object>}
     */
    getAllStates() {
        const states = {};
        for (const [service] of this.circuits.entries()) {
            states[service] = this.getState(service);
        }
        return states;
    }

    /**
     * Manually resets a circuit to CLOSED.
     * @param {string} service
     */
    reset(service) {
        const circuit = this._getCircuit(service);
        circuit.state = STATES.CLOSED;
        circuit.consecutiveFailures = 0;
        circuit.canaryInFlight = false;
        circuit.lastError = null;
    }
}

module.exports = {
    CircuitBreaker,
    STATES
};
