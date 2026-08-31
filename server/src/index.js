/**
 * @file server/src/index.js
 * @description AutoForm AI Production Backend API Server.
 */

const express = require('express');
const cors = require('cors');
const config = require('./config');
const router = require('./services/router');
const { rateLimiter, getQuotaStatus } = require('./middleware/rateLimiter');
const { validateSolveRequest } = require('./middleware/validator');

const app = express();

// Security & Parsing Middlewares
app.use(cors({
    origin: '*', // Allows extension origins (chrome-extension://, moz-extension://)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-ID', 'X-API-Key']
}));
app.use(express.json({ limit: '1mb' }));

// Root info
app.get('/', (req, res) => {
    res.json({
        name: 'AutoForm AI Backend API',
        version: '2.0.0',
        status: 'online',
        docs: 'https://github.com/whoisadheep/AutoForm-AI'
    });
});

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
    const status = router.getStatus();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
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
            latencyMs: result.latencyMs
        });

    } catch (err) {
        console.error('[API /solve Error]:', err.message);
        res.status(500).json({
            success: false,
            error: err.message || 'Internal AI solving error'
        });
    }
});

// Start Server
app.listen(config.port, () => {
    console.log(`===========================================`);
    console.log(`  AutoForm AI Server v2.0 running on :${config.port}`);
    console.log(`  Environment: ${config.env}`);
    console.log(`  Active Providers: ${router.priority.filter(p => config.providers[p].enabled).join(', ') || 'None (configure in .env)'}`);
    console.log(`===========================================`);
});
