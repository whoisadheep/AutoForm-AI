/**
 * @file server/src/config.js
 * @description Centralized server configuration and provider key manager.
 */

const path = require('path');

// Support loading .env from both server/ directory and root repository directory
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Splits comma-separated key strings into an array of sanitized keys.
 * @param {string|undefined} keyString 
 * @returns {string[]}
 */
function parseKeyList(keyString) {
    if (!keyString) return [];
    return keyString
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);
}

/**
 * Validates that essential environment variables are properly set for production.
 * Refuses startup if DATABASE_URL, JWT_SECRET, or GOOGLE_CLIENT_ID is missing or insecure.
 * @param {Object} [env=process.env]
 * @returns {{ valid: boolean, errors: string[], message?: string }}
 */
function validateProductionConfig(env = process.env) {
    const isProduction = env.NODE_ENV === 'production';
    if (!isProduction) {
        return { valid: true, errors: [] };
    }

    const errors = [];

    // 1. DATABASE_URL must be provided
    if (!env.DATABASE_URL || typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) {
        errors.push('DATABASE_URL is required in production. The in-memory database adapter is only permitted in test or development mode.');
    }

    // 2. JWT_SECRET must be strong and non-default
    const exactPlaceholders = [
        'autoform_jwt_dev_secret_key_change_in_production_32char',
        'your_super_secret_jwt_key_here_minimum_32_characters',
        'secret',
        'default',
        'changeme',
        'test_secret',
        'password',
        '12345678901234567890123456789012'
    ];
    const placeholderPatterns = [
        'change_in_production',
        'your_super_secret',
        'example',
        'placeholder'
    ];
    const jwtSecret = env.JWT_SECRET ? env.JWT_SECRET.trim() : '';
    if (!jwtSecret) {
        errors.push('JWT_SECRET is required in production.');
    } else if (jwtSecret.length < 32) {
        errors.push('JWT_SECRET must be at least 32 characters long in production.');
    } else if (exactPlaceholders.includes(jwtSecret.toLowerCase()) || placeholderPatterns.some(p => jwtSecret.toLowerCase().includes(p))) {
        errors.push('JWT_SECRET cannot be a default or placeholder value in production.');
    }

    // 3. GOOGLE_CLIENT_ID must be provided
    if (!env.GOOGLE_CLIENT_ID || typeof env.GOOGLE_CLIENT_ID !== 'string' || !env.GOOGLE_CLIENT_ID.trim()) {
        errors.push('GOOGLE_CLIENT_ID is required in production for authenticating Google accounts.');
    }

    // 4. Razorpay credentials must be provided and cannot be placeholders in production
    if (!env.RAZORPAY_KEY_ID || typeof env.RAZORPAY_KEY_ID !== 'string' || !env.RAZORPAY_KEY_ID.trim() || env.RAZORPAY_KEY_ID.includes('placeholder')) {
        errors.push('RAZORPAY_KEY_ID is required in production and cannot be a placeholder.');
    }
    if (!env.RAZORPAY_KEY_SECRET || typeof env.RAZORPAY_KEY_SECRET !== 'string' || !env.RAZORPAY_KEY_SECRET.trim() || env.RAZORPAY_KEY_SECRET.includes('placeholder')) {
        errors.push('RAZORPAY_KEY_SECRET is required in production and cannot be a placeholder.');
    }
    if (!env.RAZORPAY_WEBHOOK_SECRET || typeof env.RAZORPAY_WEBHOOK_SECRET !== 'string' || !env.RAZORPAY_WEBHOOK_SECRET.trim() || env.RAZORPAY_WEBHOOK_SECRET.includes('placeholder')) {
        errors.push('RAZORPAY_WEBHOOK_SECRET is required in production and cannot be a placeholder.');
    }

    // 5. ADMIN_STATS_TOKEN must be provided and cannot be placeholder
    if (!env.ADMIN_STATS_TOKEN || typeof env.ADMIN_STATS_TOKEN !== 'string' || !env.ADMIN_STATS_TOKEN.trim() || env.ADMIN_STATS_TOKEN.includes('placeholder')) {
        errors.push('ADMIN_STATS_TOKEN is required in production and cannot be a placeholder.');
    }

    if (errors.length > 0) {
        const message = `[Production Safety Violation] Server refused to start due to configuration errors:\n- ${errors.join('\n- ')}`;
        return { valid: false, errors, message };
    }

    return { valid: true, errors: [] };
}

module.exports = {
    validateProductionConfig,
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    rateLimitPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '150', 10),
    dailySolveCapFree: parseInt(process.env.DAILY_SOLVE_CAP_FREE || '200', 10),
    dailySolveCapPro: parseInt(process.env.DAILY_SOLVE_CAP_PRO || '1500', 10),
    legacyAnonSolve: process.env.LEGACY_ANON_SOLVE === 'true' || process.env.LEGACY_ANON_SOLVE === '1',
    legacyDailyIpCap: parseInt(process.env.LEGACY_DAILY_IP_CAP || '150', 10),
    guestTrialDailyIpCap: parseInt(process.env.GUEST_TRIAL_DAILY_IP_CAP || '60', 10),
    paymentsEnabled: process.env.PAYMENTS_ENABLED === 'true' || process.env.PAYMENTS_ENABLED === '1',
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || '1', 10),
    adminStatsToken: process.env.ADMIN_STATS_TOKEN || null,
    apiSecretKey: process.env.API_SECRET_KEY || null,
    piiAllowedProviders: (process.env.PII_ALLOWED_PROVIDERS || 'groq')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean),

    providers: {
        laya: {
            name: 'laya',
            enabled: process.env.ENABLE_LAYA === 'true' || process.env.ENABLE_LAYA === '1',
            autoLoad: process.env.LAYA_AUTOLOAD !== 'false',
            confidenceThreshold: parseFloat(process.env.LAYA_CONFIDENCE_THRESHOLD || '0.70'),
            cacheDir: process.env.LAYA_CACHE || undefined
        },
        groq: {
            name: 'groq',
            enabled: parseKeyList(process.env.GROQ_API_KEYS).length > 0,
            keys: parseKeyList(process.env.GROQ_API_KEYS),
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            piiModel: process.env.GROQ_PII_MODEL || 'llama-3.3-70b-versatile',
            fallbackModels: (process.env.GROQ_FALLBACK_MODELS || 'llama-3.1-8b-instant,deepseek-r1-distill-llama-70b,gemma2-9b-it')
                .split(',')
                .map(m => m.trim())
                .filter(Boolean),
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            timeoutMs: 8000
        },
        gemini: {
            name: 'gemini',
            enabled: parseKeyList(process.env.GEMINI_API_KEYS).length > 0,
            keys: parseKeyList(process.env.GEMINI_API_KEYS),
            model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
            fallbackModels: ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
            timeoutMs: 12000
        },
        openrouter: {
            name: 'openrouter',
            enabled: parseKeyList(process.env.OPENROUTER_API_KEYS).length > 0,
            keys: parseKeyList(process.env.OPENROUTER_API_KEYS),
            model: process.env.OPENROUTER_MODEL || 'liquid/lfm-2.5-2.6b:free',
            fallbackModels: [
                'liquid/lfm-2.5-2.6b:free',
                'nvidia/nemotron-3-ultra-550b-a55b:free',
                'nvidia/nemotron-3-super-120b-a12b:free',
                'openrouter/free'
            ],
            endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            timeoutMs: 15000
        },
        nvidia: {
            name: 'nvidia',
            enabled: parseKeyList(process.env.NVIDIA_API_KEYS).length > 0,
            keys: parseKeyList(process.env.NVIDIA_API_KEYS),
            model: process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
            fallbackModels: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'],
            endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
            timeoutMs: 12000
        }
    }
};
