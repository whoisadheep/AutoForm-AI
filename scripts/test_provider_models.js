#!/usr/bin/env node

/**
 * @file scripts/test_provider_models.js
 * @description Pings each configured AI provider with its primary and fallback models.
 * Sends a minimal prompt to verify model name validity, authentication, and live connectivity.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const config = require('../server/src/config');

async function testGroqModel(apiKey, model) {
    const start = Date.now();
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Respond with valid JSON: {"status": "ok"}' }],
                response_format: { type: 'json_object' },
                max_tokens: 20
            }),
            signal: AbortSignal.timeout(10000)
        });
        const latency = Date.now() - start;
        if (!res.ok) {
            const err = await res.text();
            return { success: false, status: res.status, error: err.slice(0, 120), latency };
        }
        return { success: true, status: res.status, latency };
    } catch (e) {
        return { success: false, status: 'TIMEOUT/ERR', error: e.message, latency: Date.now() - start };
    }
}

async function testGeminiModel(apiKey, model) {
    const start = Date.now();
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Respond with JSON: {"status": "ok"}' }] }],
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 20 }
            }),
            signal: AbortSignal.timeout(10000)
        });
        const latency = Date.now() - start;
        if (!res.ok) {
            const err = await res.text();
            return { success: false, status: res.status, error: err.slice(0, 120), latency };
        }
        return { success: true, status: res.status, latency };
    } catch (e) {
        return { success: false, status: 'TIMEOUT/ERR', error: e.message, latency: Date.now() - start };
    }
}

async function testOpenRouterModel(apiKey, model) {
    const start = Date.now();
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/whoisadheep/AutoForm-AI',
                'X-Title': 'AutoForm-AI-ModelCheck'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Say OK' }],
                max_tokens: 15
            }),
            signal: AbortSignal.timeout(12000)
        });
        const latency = Date.now() - start;
        if (!res.ok) {
            const err = await res.text();
            return { success: false, status: res.status, error: err.slice(0, 120), latency };
        }
        return { success: true, status: res.status, latency };
    } catch (e) {
        return { success: false, status: 'TIMEOUT/ERR', error: e.message, latency: Date.now() - start };
    }
}

async function testNvidiaModel(apiKey, model) {
    const start = Date.now();
    try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Say OK' }],
                max_tokens: 15
            }),
            signal: AbortSignal.timeout(10000)
        });
        const latency = Date.now() - start;
        if (!res.ok) {
            const err = await res.text();
            return { success: false, status: res.status, error: err.slice(0, 120), latency };
        }
        return { success: true, status: res.status, latency };
    } catch (e) {
        return { success: false, status: 'TIMEOUT/ERR', error: e.message, latency: Date.now() - start };
    }
}

async function main() {
    console.log('🔍 AutoForm AI — Provider Model Live Connectivity Check');
    console.log('=========================================================\n');

    const results = [];

    // 1. Groq
    const groqKeys = config.providers.groq.keys;
    const groqModels = Array.from(new Set([
        config.providers.groq.model,
        config.providers.groq.piiModel,
        ...(config.providers.groq.fallbackModels || [])
    ])).filter(Boolean);

    if (groqKeys.length === 0) {
        console.log('⚠️  Groq: Skipped (no GROQ_API_KEYS configured)');
    } else {
        const key = groqKeys[0];
        console.log(`📡 Testing Groq (${groqModels.length} models) with key ...${key.slice(-4)}:`);
        for (const model of groqModels) {
            const r = await testGroqModel(key, model);
            results.push({ provider: 'Groq', model, ...r });
            console.log(`   ${r.success ? '✅' : '❌'} ${model.padEnd(32)} ${String(r.status).padEnd(8)} ${r.latency}ms ${r.error ? `(${r.error})` : ''}`);
        }
    }

    // 2. Gemini
    const geminiKeys = config.providers.gemini.keys;
    const geminiModels = Array.from(new Set([
        config.providers.gemini.model,
        ...(config.providers.gemini.fallbackModels || [])
    ])).filter(Boolean);

    if (geminiKeys.length === 0) {
        console.log('\n⚠️  Gemini: Skipped (no GEMINI_API_KEYS configured)');
    } else {
        const key = geminiKeys[0];
        console.log(`\n📡 Testing Google Gemini (${geminiModels.length} models) with key ...${key.slice(-4)}:`);
        for (const model of geminiModels) {
            const r = await testGeminiModel(key, model);
            results.push({ provider: 'Gemini', model, ...r });
            console.log(`   ${r.success ? '✅' : '❌'} ${model.padEnd(32)} ${String(r.status).padEnd(8)} ${r.latency}ms ${r.error ? `(${r.error})` : ''}`);
        }
    }

    // 3. OpenRouter
    const openrouterKeys = config.providers.openrouter.keys;
    const openrouterModels = Array.from(new Set([
        config.providers.openrouter.model,
        ...(config.providers.openrouter.fallbackModels || [])
    ])).filter(Boolean);

    if (openrouterKeys.length === 0) {
        console.log('\n⚠️  OpenRouter: Skipped (no OPENROUTER_API_KEYS configured)');
    } else {
        const key = openrouterKeys[0];
        console.log(`\n📡 Testing OpenRouter (${openrouterModels.length} models) with key ...${key.slice(-4)}:`);
        for (const model of openrouterModels) {
            const r = await testOpenRouterModel(key, model);
            results.push({ provider: 'OpenRouter', model, ...r });
            console.log(`   ${r.success ? '✅' : '❌'} ${model.padEnd(36)} ${String(r.status).padEnd(8)} ${r.latency}ms ${r.error ? `(${r.error})` : ''}`);
        }
    }

    // 4. NVIDIA NIM
    const nvidiaKeys = config.providers.nvidia.keys;
    const nvidiaModels = Array.from(new Set([
        config.providers.nvidia.model,
        ...(config.providers.nvidia.fallbackModels || [])
    ])).filter(Boolean);

    if (nvidiaKeys.length === 0) {
        console.log('\n⚠️  NVIDIA NIM: Skipped (no NVIDIA_API_KEYS configured)');
    } else {
        const key = nvidiaKeys[0];
        console.log(`\n📡 Testing NVIDIA NIM (${nvidiaModels.length} models) with key ...${key.slice(-4)}:`);
        for (const model of nvidiaModels) {
            const r = await testNvidiaModel(key, model);
            results.push({ provider: 'NVIDIA', model, ...r });
            console.log(`   ${r.success ? '✅' : '❌'} ${model.padEnd(36)} ${String(r.status).padEnd(8)} ${r.latency}ms ${r.error ? `(${r.error})` : ''}`);
        }
    }

    console.log('\n=========================================================');
    const tested = results.length;
    const passed = results.filter(r => r.success).length;
    console.log(`🏁 Complete: ${passed}/${tested} model tests succeeded.`);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error running model checks:', err);
        process.exit(1);
    });
}

module.exports = {
    testGroqModel,
    testGeminiModel,
    testOpenRouterModel,
    testNvidiaModel
};
