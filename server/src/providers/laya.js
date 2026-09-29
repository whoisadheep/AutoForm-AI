/**
 * @file server/src/providers/laya.js
 * @description Laya (convaiinnovations/laya) System 1 Decision Model Provider.
 * Ultra-low latency (~15-30ms), zero-token, non-autoregressive decision model
 * for multiple-choice, dropdown, and linear scale form questions with confidence calibration.
 */

const path = require('path');

class LayaProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = 'laya';
        this.model = null;
        this.isReady = false;
        this.isLoading = false;
        this.loadError = null;
        this.confidenceThreshold = typeof config.confidenceThreshold === 'number' 
            ? config.confidenceThreshold 
            : 0.70;

        // Auto-load on instantiation unless explicitly disabled
        if (config.autoLoad !== false) {
            this.init().catch(err => {
                console.warn(`[LayaProvider] Lazy initialization warning: ${err.message}`);
            });
        }
    }

    /**
     * Initializes and loads the ONNX runtime model.
     * @returns {Promise<any>}
     */
    async init() {
        if (this.isReady && this.model) return this.model;
        if (this.isLoading) return this.initPromise;

        this.isLoading = true;
        this.initPromise = (async () => {
            try {
                const { Laya } = require('@receptron/laya');
                console.log('[LayaProvider] Loading Laya System-1 ONNX decision model...');
                const start = Date.now();

                this.model = await Laya.load({
                    cacheDir: this.config.cacheDir,
                    onProgress: ({ file, received, total }) => {
                        if (total) {
                            const pct = ((received / total) * 100).toFixed(1);
                            // Log every ~20MB
                            if (received % (20 * 1024 * 1024) < 131072 || received >= total) {
                                console.log(`[LayaProvider] Downloading ${file}: ${pct}%`);
                            }
                        }
                    }
                });

                this.isReady = true;
                this.isLoading = false;
                console.log(`[LayaProvider] Laya model ready in ${Date.now() - start}ms`);
                return this.model;
            } catch (err) {
                this.isLoading = false;
                this.loadError = err;
                console.warn(`[LayaProvider] Failed to load Laya model: ${err.message}`);
                throw err;
            }
        })();

        return this.initPromise;
    }

    /**
     * Determines whether Laya can handle the given question.
     * Laya specializes in discrete choice selection (multiple_choice, dropdown, scale).
     * @param {Object} questionData
     * @returns {boolean}
     */
    canHandle(questionData) {
        if (!this.isReady) return false;

        const { type, choices } = questionData;
        const supportedTypes = ['multiple_choice', 'dropdown', 'scale', 'radio', 'select'];
        if (!supportedTypes.includes(type)) return false;

        if (!Array.isArray(choices) || choices.length < 2) return false;

        // Laya's classification head is optimal for <= 25 choices
        if (choices.length > 25) return false;

        return true;
    }

    /**
     * Solves a discrete choice question using Laya's single-pass forward inference.
     * @param {Object} questionData
     * @returns {Promise<{ answer: string, confidence: number, probabilities?: Record<string, number>, provider: string, latencyMs: number }>}
     */
    async solve(questionData) {
        if (!this.isReady || !this.model) {
            const err = new Error('Laya model is not loaded yet');
            err.isHandoff = true;
            throw err;
        }

        const { question, type, choices = [], customContext = '' } = questionData;

        if (!this.canHandle(questionData)) {
            const err = new Error(`Laya cannot handle question type '${type}' with ${choices.length} choices`);
            err.isHandoff = true;
            throw err;
        }

        const startTime = Date.now();

        // 1. Check for Academic / Exam / Deep Reasoning Markers
        // AutoForm AI memory context tags or explicit quiz markers
        const isExamContext = customContext && (
            customContext.includes('Quiz & Evaluation') ||
            customContext.includes('QUIZ_EVALUATION')
        );

        const hasMathOrCodeComplexity = /\b(calculate|derivative|integral|solve for x|complexity of|O\(n\)|algorithm|prove that)\b/i.test(question);

        if (isExamContext && hasMathOrCodeComplexity) {
            const err = new Error('Detected complex exam / mathematical reasoning question; delegating to System 2 model');
            err.isHandoff = true;
            throw err;
        }

        // 2. Format state and question for Laya's systemOne API
        const state = {
            question: question,
            userContext: customContext || ''
        };

        const isScale = type === 'scale';
        const questionsPayload = {
            target: isScale ? {
                type: 'score',
                instructions: question,
                criteria: choices
            } : {
                type: 'choice',
                instructions: question,
                criteria: choices
            }
        };

        const result = await this.model.systemOne(state, questionsPayload);
        const ansObj = result.answers.target;
        const latencyMs = Date.now() - startTime;

        // 3. Evaluate Calibrated Confidence
        const confidence = typeof ansObj.confidence === 'number' ? ansObj.confidence : 1.0;
        if (confidence < this.confidenceThreshold) {
            const err = new Error(`Laya confidence score (${confidence.toFixed(2)}) is below threshold ${this.confidenceThreshold}; delegating to System 2`);
            err.isHandoff = true;
            throw err;
        }

        let selectedAnswer = '';
        if (isScale) {
            if (ansObj.legend && ansObj.legend[Math.round(ansObj.score)]) {
                selectedAnswer = ansObj.legend[Math.round(ansObj.score)];
            } else if (choices[Math.round(ansObj.score)]) {
                selectedAnswer = String(choices[Math.round(ansObj.score)]);
            } else {
                selectedAnswer = String(Math.round(ansObj.score));
            }
        } else {
            selectedAnswer = ansObj.choice || choices[0];
        }

        return {
            answer: selectedAnswer,
            confidence,
            probabilities: ansObj.probabilities,
            provider: 'laya',
            latencyMs
        };
    }
}

module.exports = LayaProvider;
