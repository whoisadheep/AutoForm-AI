/**
 * @file server/src/index.js
 * @description AutoForm AI Production Backend API Server.
 * Hardened with security headers, request tracing, proxy trust, and graceful draining.
 */

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const router = require('./services/router');
const { rateLimiter, getQuotaStatus } = require('./middleware/rateLimiter');
const { validateSolveRequest } = require('./middleware/validator');

const app = express();

// 1. Production Reverse-Proxy Hardening (Railway, Render, Cloudflare, Fly.io)
app.set('trust proxy', 1);

// 2. HTTP Security Headers & Signature Stripping
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (config.env === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// 3. Request Correlation ID Middleware (X-Request-Id)
app.use((req, res, next) => {
    const reqId = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = reqId;
    res.setHeader('X-Request-Id', reqId);
    next();
});

// 4. CORS & Parsing Middlewares
app.use(cors({
    origin: '*', // Allows extension origins (chrome-extension://, moz-extension://)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-ID', 'X-API-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After']
}));
app.use(express.json({ limit: '1mb' }));

// Root info
app.get('/', (req, res) => {
    res.json({
        name: 'AutoForm AI Backend API',
        version: '2.0.1',
        status: 'online',
        docs: 'https://github.com/whoisadheep/AutoForm-AI'
    });
});

// Cloud Liveness probe
app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

// Health check & metrics endpoint
app.get('/api/v1/health', (req, res) => {
    const status = router.getStatus();
    const mem = process.memoryUsage();
    res.json({
        status: 'healthy',
        version: '2.0.1',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        memoryMb: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024)
        },
        ...status
    });
});

// Client Quota status
app.get('/api/v1/quota', (req, res) => {
    const clientId = req.query.clientId || req.headers['x-client-id'] || req.ip || 'anonymous';
    const quota = getQuotaStatus(clientId);
    res.json({
        clientId,
        ...quota
    });
});

// Primary Solve Endpoint
app.post('/api/v1/solve', rateLimiter, validateSolveRequest, async (req, res) => {
    try {
        const { question, type, choices, customContext, tone } = req.body;

        const result = await router.solve({
            question,
            type,
            choices,
            customContext,
            tone
        });

        res.json({
            success: true,
            answer: result.answer,
            answers: result.answers,
            provider: result.provider,
            latencyMs: result.latencyMs,
            requestId: req.id
        });

    } catch (err) {
        console.error(`[API /solve Error] [req:${req.id}]:`, err.message);
        const isProd = config.env === 'production';
        // Sanitize error message in production to prevent leaking upstream secrets/stack
        const publicError = isProd ? 'AI solving failed across all available providers' : err.message;
        res.status(500).json({
            success: false,
            error: publicError,
            requestId: req.id
        });
    }
});

// Start Server when run directly
if (require.main === module) {
    const server = app.listen(config.port, () => {
        console.log(`===========================================`);
        console.log(`  AutoForm AI Server v2.0 running on :${config.port}`);
        console.log(`  Environment: ${config.env}`);
        console.log(`  Active Providers: ${router.priority.filter(p => config.providers[p]?.enabled).join(', ') || 'None (configure in .env)'}`);
        console.log(`===========================================`);
    });

    // Graceful Process Draining (SIGTERM / SIGINT)
    function gracefulShutdown(signal) {
        console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
        server.close(() => {
            console.log('[Server] All active connections drained. Process exiting cleanly.');
            process.exit(0);
        });

        // Enforce 10-second timeout
        setTimeout(() => {
            console.error('[Server] Graceful shutdown timeout (10s) reached. Forcing exit.');
            process.exit(1);
        }, 10000).unref();
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
