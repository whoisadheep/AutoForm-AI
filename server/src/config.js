/**
 * @file server/src/config.js
 * @description Centralized server configuration and provider key manager.
 */

require('dotenv').config();

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

module.exports = {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    rateLimitPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '60', 10),
    apiSecretKey: process.env.API_SECRET_KEY || null,

    providers: {
        groq: {
            name: 'groq',
            enabled: parseKeyList(process.env.GROQ_API_KEYS).length > 0,
            keys: parseKeyList(process.env.GROQ_API_KEYS),
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            endpoint: 'https://api.groq.com/openai/v1/chat/completions',
            timeoutMs: 8000
        },
        gemini: {
            name: 'gemini',
            enabled: parseKeyList(process.env.GEMINI_API_KEYS).length > 0,
            keys: parseKeyList(process.env.GEMINI_API_KEYS),
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
            timeoutMs: 12000
        },
        nvidia: {
            name: 'nvidia',
            enabled: parseKeyList(process.env.NVIDIA_API_KEYS).length > 0,
            keys: parseKeyList(process.env.NVIDIA_API_KEYS),
            model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
            endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
            timeoutMs: 12000
        }
    }
};
