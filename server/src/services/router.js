/**
 * @file server/src/services/router.js
 * @description Intelligent Multi-Provider Router with auto-failover, health metrics, and latency measurement.
 */

const config = require('../config');
const GroqProvider = require('../providers/groq');
const GeminiProvider = require('../providers/gemini');
const NvidiaProvider = require('../providers/nvidia');
const OpenRouterProvider = require('../providers/openrouter');
const { CircuitBreaker } = require('./circuitBreaker');

class ProviderRouter {
    constructor() {
        this.providers = new Map();
        this.metrics = new Map();
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeoutMs: 30000 // 30 seconds cooldown before testing recovery
        });

        // Initialize enabled providers
        if (config.providers.groq.enabled) {
            this.providers.set('groq', new GroqProvider(config.providers.groq));
            this.metrics.set('groq', { success: 0, failures: 0, avgLatencyMs: 0 });
        }
        if (config.providers.gemini.enabled) {
            this.providers.set('gemini', new GeminiProvider(config.providers.gemini));
            this.metrics.set('gemini', { success: 0, failures: 0, avgLatencyMs: 0 });
        }
        if (config.providers.openrouter && config.providers.openrouter.enabled) {
            this.providers.set('openrouter', new OpenRouterProvider(config.providers.openrouter));
            this.metrics.set('openrouter', { success: 0, failures: 0, avgLatencyMs: 0 });
        }
        if (config.providers.nvidia.enabled) {
            this.providers.set('nvidia', new NvidiaProvider(config.providers.nvidia));
            this.metrics.set('nvidia', { success: 0, failures: 0, avgLatencyMs: 0 });
        }

        // Priority order: Groq (ultra fast) -> Gemini (ultra reliable) -> OpenRouter (free backup) -> NVIDIA (backup)
        this.priority = ['groq', 'gemini', 'openrouter', 'nvidia'];
    }

    /**
     * Solves a question using the best available provider with automatic fallback and circuit breaking.
     * @param {Object} questionData 
     * @returns {Promise<{ answer?: string, answers?: string[], provider: string, latencyMs: number }>}
     */
    async solve(questionData) {
        const availableProviders = this.priority.filter(p => this.providers.has(p));

        if (availableProviders.length === 0) {
            throw new Error('No AI providers configured on the server. Please check environment variables.');
        }

        const errors = [];

        for (const providerName of availableProviders) {
            const provider = this.providers.get(providerName);

            // Check Circuit Breaker: fail fast (0ms) if provider is currently tripped
            if (!this.circuitBreaker.canExecute(providerName)) {
                const cbState = this.circuitBreaker.getState(providerName);
                const retryInSec = Math.ceil(cbState.timeUntilNextProbeMs / 1000);
                console.warn(`[Router] Provider '${providerName}' circuit is OPEN (bypassing immediately, retry in ${retryInSec}s).`);
                errors.push({ provider: providerName, error: `Circuit OPEN (bypassed, canary probe in ${retryInSec}s)` });
                continue;
            }

            // Check Key Availability: fail fast (0ms) if all keys are currently on 429 cooldown
            if (provider.rotator && !provider.rotator.hasAvailableKey()) {
                console.warn(`[Router] Provider '${providerName}' all keys in 429 cooldown. Bypassing immediately...`);
                errors.push({ provider: providerName, error: 'All API keys on cooldown (429 rate limit)' });
                continue;
            }

            const startTime = Date.now();

            try {
                const result = await provider.solve(questionData);
                const latencyMs = Date.now() - startTime;

                this.recordMetric(providerName, true, latencyMs);
                this.circuitBreaker.recordSuccess(providerName);

                return {
                    ...result,
                    provider: providerName,
                    latencyMs
                };

            } catch (err) {
                const latencyMs = Date.now() - startTime;
                this.recordMetric(providerName, false, latencyMs);
                this.circuitBreaker.recordFailure(providerName, err);

                console.warn(`[Router] Provider '${providerName}' failed (${err.message}). Attempting failover...`);
                errors.push({ provider: providerName, error: err.message });
            }
        }

        const summary = errors.map(e => `${e.provider}: ${e.error}`).join(' | ');
        throw new Error(`All providers failed: ${summary}`);
    }

    recordMetric(providerName, isSuccess, latencyMs) {
        let m = this.metrics.get(providerName);
        if (!m) {
            m = { success: 0, failures: 0, avgLatencyMs: 0 };
            this.metrics.set(providerName, m);
        }

        if (isSuccess) {
            m.success++;
            m.avgLatencyMs = m.avgLatencyMs === 0 ? latencyMs : Math.round((m.avgLatencyMs * 0.8) + (latencyMs * 0.2));
        } else {
            m.failures++;
        }
    }

    getStatus() {
        const status = {};
        for (const [name, m] of this.metrics.entries()) {
            const provider = this.providers.get(name);
            status[name] = {
                configured: true,
                success: m.success,
                failures: m.failures,
                avgLatencyMs: m.avgLatencyMs,
                circuit: this.circuitBreaker.getState(name),
                keys: provider?.rotator ? provider.rotator.getStatus() : []
            };
        }

        // Ensure all active providers are reflected in status even before first call
        for (const name of this.providers.keys()) {
            if (!status[name]) {
                const provider = this.providers.get(name);
                status[name] = {
                    configured: true,
                    success: 0,
                    failures: 0,
                    avgLatencyMs: 0,
                    circuit: this.circuitBreaker.getState(name),
                    keys: provider?.rotator ? provider.rotator.getStatus() : []
                };
            }
        }

        return {
            activeProviders: Array.from(this.providers.keys()),
            metrics: status
        };
    }
}

module.exports = new ProviderRouter();
