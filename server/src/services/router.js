/**
 * @file server/src/services/router.js
 * @description Intelligent Multi-Provider Router with auto-failover, health metrics, and latency measurement.
 */

const config = require('../config');
const GroqProvider = require('../providers/groq');
const GeminiProvider = require('../providers/gemini');
const NvidiaProvider = require('../providers/nvidia');

class ProviderRouter {
    constructor() {
        this.providers = new Map();
        this.metrics = new Map();

        // Initialize enabled providers
        if (config.providers.groq.enabled) {
            this.providers.set('groq', new GroqProvider(config.providers.groq));
            this.metrics.set('groq', { success: 0, failures: 0, avgLatencyMs: 0 });
        }
        if (config.providers.gemini.enabled) {
            this.providers.set('gemini', new GeminiProvider(config.providers.gemini));
            this.metrics.set('gemini', { success: 0, failures: 0, avgLatencyMs: 0 });
        }
        if (config.providers.nvidia.enabled) {
            this.providers.set('nvidia', new NvidiaProvider(config.providers.nvidia));
            this.metrics.set('nvidia', { success: 0, failures: 0, avgLatencyMs: 0 });
        }

        // Priority order: Groq (ultra fast) -> Gemini (ultra reliable) -> NVIDIA (backup)
        this.priority = ['groq', 'gemini', 'nvidia'];
    }

    /**
     * Solves a question using the best available provider with automatic fallback.
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
            const startTime = Date.now();

            try {
                const result = await provider.solve(questionData);
                const latencyMs = Date.now() - startTime;

                this.recordMetric(providerName, true, latencyMs);

                return {
                    ...result,
                    provider: providerName,
                    latencyMs
                };

            } catch (err) {
                const latencyMs = Date.now() - startTime;
                this.recordMetric(providerName, false, latencyMs);

                console.warn(`[Router] Provider '${providerName}' failed (${err.message}). Attempting failover...`);
                errors.push({ provider: providerName, error: err.message });
            }
        }

        const summary = errors.map(e => `${e.provider}: ${e.error}`).join(' | ');
        throw new Error(`All providers failed: ${summary}`);
    }

    recordMetric(providerName, isSuccess, latencyMs) {
        const m = this.metrics.get(providerName);
        if (!m) return;

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
            status[name] = {
                configured: true,
                success: m.success,
                failures: m.failures,
                avgLatencyMs: m.avgLatencyMs
            };
        }
        return {
            activeProviders: Array.from(this.providers.keys()),
            metrics: status
        };
    }
}

module.exports = new ProviderRouter();
