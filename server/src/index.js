/**
 * @file server/src/index.js
 * @description AutoForm AI Production Backend API Server.
 * Hardened with security headers, request tracing, proxy trust, and graceful draining.
 */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const router = require('./services/router');
const { rateLimiter, getQuotaStatus } = require('./middleware/rateLimiter');
const { validateSolveRequest } = require('./middleware/validator');
const db = require('./db');
const { verifyGoogleIdToken, findOrCreateGoogleUser, signUserToken, verifyUserToken } = require('./services/auth');
const { requireAuth, optionalAuth, requireAdminAuth } = require('./middleware/auth');
const formSessionManager = require('./services/formSessionManager');
const paymentService = require('./services/paymentService');
const statsService = require('./services/statsService');

// Enforce strict production safety checks before initializing
if (config.env === 'production') {
    const prodCheck = config.validateProductionConfig(process.env);
    if (!prodCheck.valid) {
        console.error(prodCheck.message);
        throw new Error(prodCheck.message);
    }
}

// Initialize database connection and migrations
db.initDb().catch((err) => {
    console.error('[AutoForm Database Init Error]:', err.message);
});

const app = express();

// 1. Production Reverse-Proxy Hardening (Railway, Render, Cloudflare, Fly.io)
app.set('trust proxy', config.trustProxyHops || 1);

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
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-ID', 'X-API-Key', 'X-Request-Id', 'X-Form-Session-Token', 'X-User-Plan'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After']
}));
// 5. Razorpay Webhook Endpoint (MUST use express.raw for HMAC-SHA256 signature verification)
app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const rawBody = req.body;
        const signatureHeader = req.headers['x-razorpay-signature'];
        const result = await paymentService.handleWebhook({ rawBody, signatureHeader });
        res.status(200).json({ status: 'ok', ...result });
    } catch (err) {
        console.error('[Razorpay Webhook Error]:', err.message);
        res.status(err.statusCode || 400).json({
            status: 'error',
            code: err.code || 'WEBHOOK_ERROR',
            error: err.message
        });
    }
});

// JSON Body Parser for all other endpoints
app.use(express.json({ limit: '1mb' }));

// Static documentation, terms, privacy, and refund pages
app.use('/site', express.static(path.resolve(__dirname, '../../site')));
app.get('/privacy', (req, res) => res.sendFile(path.resolve(__dirname, '../../site/privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.resolve(__dirname, '../../site/terms.html')));
app.get('/refund', (req, res) => res.sendFile(path.resolve(__dirname, '../../site/refund.html')));
app.get('/contact', (req, res) => res.sendFile(path.resolve(__dirname, '../../site/contact.html')));

// Root info
app.get('/', (req, res) => {
    res.json({
        name: 'AutoForm AI Backend API',
        version: '2.0.6',
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
        version: '2.0.6',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        memoryMb: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024)
        },
        ...status
    });
});

// Google OAuth Sign-In Endpoint
// Verifies Google ID token from extension, finds or creates user, returns signed session JWT.
app.post('/api/v1/auth/google', async (req, res) => {
    try {
        const { idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({
                success: false,
                error: 'Missing Google ID token.'
            });
        }

        const profile = await verifyGoogleIdToken(idToken);
        const user = await findOrCreateGoogleUser(profile);
        const token = signUserToken(user);
        const quota = await formSessionManager.getUserQuotaStatus(user.id);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: profile.name,
                picture: profile.picture,
                plan: quota.plan
            },
            quota
        });
    } catch (err) {
        console.error('[AutoForm Auth Error]:', err.message);
        res.status(401).json({
            success: false,
            error: err.message || 'Google authentication failed.'
        });
    }
});

// Current User Profile & Quota Endpoint
app.get('/api/v1/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await db.findUserById(req.user.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }
        const quota = await formSessionManager.getUserQuotaStatus(user.id);
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                plan: quota.plan
            },
            quota
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// In-memory registry of temporary 6-digit device pairing codes (TTL: 10 minutes)
const devicePairingCodes = new Map();
function cleanupExpiredDeviceCodes() {
    const now = Date.now();
    for (const [code, entry] of devicePairingCodes.entries()) {
        if (entry.expiresAt < now) {
            devicePairingCodes.delete(code);
        }
    }
}
setInterval(cleanupExpiredDeviceCodes, 60 * 1000).unref?.();

// Generate 6-Digit Device Pairing Code (Called from authenticated laptop/desktop)
app.post('/api/v1/auth/device-code', requireAuth, (req, res) => {
    try {
        cleanupExpiredDeviceCodes();
        const crypto = require('crypto');
        const code = crypto.randomInt(100000, 999999).toString();
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        devicePairingCodes.set(code, {
            userId: req.user.userId,
            token,
            expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
        });

        res.json({
            success: true,
            code,
            expiresIn: 600
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Link Device via 6-Digit Code or Direct Token (Called from mobile e.g. Firefox Android)
app.post('/api/v1/auth/device-link', rateLimiter, async (req, res) => {
    try {
        cleanupExpiredDeviceCodes();
        const { code, token: directToken } = req.body || {};
        let tokenToUse = directToken;

        if (code) {
            const cleanCode = code.toString().replace(/[\s-]/g, '');
            const entry = devicePairingCodes.get(cleanCode);
            if (!entry || entry.expiresAt < Date.now()) {
                devicePairingCodes.delete(cleanCode);
                return res.status(400).json({
                    success: false,
                    error: 'Invalid or expired sync code. Please generate a fresh code on your laptop.'
                });
            }
            tokenToUse = entry.token;
            devicePairingCodes.delete(cleanCode); // Single-use consumption
        }

        if (!tokenToUse) {
            return res.status(400).json({
                success: false,
                error: 'Sync code or session token is required.'
            });
        }

        const decoded = verifyUserToken(tokenToUse);
        const user = await db.findUserById(decoded.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        const quota = await formSessionManager.getUserQuotaStatus(user.id);
        res.json({
            success: true,
            token: tokenToUse,
            user: {
                id: user.id,
                email: user.email,
                plan: quota.plan
            },
            quota
        });
    } catch (err) {
        res.status(401).json({ success: false, error: err.message || 'Invalid sync credentials.' });
    }
});

// ---------------------------------------------------------------------------
// Hosted Web Authentication for Mobile & Firefox Android
// ---------------------------------------------------------------------------

const webAuthSessions = new Map();
function cleanupExpiredWebAuthSessions() {
    const now = Date.now();
    for (const [id, entry] of webAuthSessions.entries()) {
        if (entry.expiresAt < now) {
            webAuthSessions.delete(id);
        }
    }
}
setInterval(cleanupExpiredWebAuthSessions, 60 * 1000).unref?.();

// 1. Hosted Web Login Page
app.get(['/auth/login', '/api/v1/auth/web/login'], rateLimiter, (req, res) => {
    cleanupExpiredWebAuthSessions();
    const session = (req.query.session || '').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '124825767907-8i59japp45ibhclluloh8bs5ididjmkp.apps.googleusercontent.com';
    const callbackUrl = `https://${req.get('host')}/api/v1/auth/web/callback`;
    const oauthDirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: googleClientId,
        response_type: 'id_token',
        redirect_uri: callbackUrl,
        scope: 'openid email profile',
        nonce: Math.random().toString(36).substring(2) + Date.now().toString(36),
        state: session,
        prompt: 'select_account'
    }).toString();

    const existing = session ? webAuthSessions.get(session) : null;
    const isAlreadyDone = existing && existing.status === 'success';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Sign in to AutoForm AI</title>
    <link rel="icon" href="https://whoisadheep.github.io/AutoForm-AI/assets/icons/icon48.png" type="image/png">
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #090a10;
            color: #f1f5f9;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-card {
            background: #11131f;
            border: 1px solid #1e2238;
            border-radius: 16px;
            max-width: 420px;
            width: 100%;
            padding: 32px 24px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
            text-align: center;
        }
        .brand-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(99, 102, 241, 0.15);
            border: 1px solid rgba(99, 102, 241, 0.3);
            color: #a5b4fc;
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #ffffff; }
        p.subtitle { font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px; }
        .google-btn-wrapper {
            display: flex;
            justify-content: center;
            margin-bottom: 20px;
            min-height: 44px;
        }
        .or-divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 16px 0;
            color: #475569;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .or-divider::before, .or-divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid #1e2238;
        }
        .or-divider:not(:empty)::before { margin-right: .5em; }
        .or-divider:not(:empty)::after { margin-left: .5em; }
        .btn-direct-oauth {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            background: #1e2238;
            border: 1px solid #2d3356;
            color: #e2e8f0;
            padding: 12px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.15s ease;
        }
        .btn-direct-oauth:hover { background: #282f4d; color: #ffffff; }
        .state-box { display: none; padding: 16px; border-radius: 12px; margin-top: 16px; font-size: 13px; line-height: 1.5; }
        .state-success { background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #6ee7b7; }
        .state-error { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; }
        .sync-code-display {
            background: #090a10;
            border: 1px dashed #6366f1;
            border-radius: 8px;
            padding: 12px;
            margin-top: 12px;
        }
        .sync-code-num { font-size: 24px; font-weight: 800; letter-spacing: 3px; color: #a5b4fc; font-family: monospace; }
        .sync-code-note { font-size: 11.5px; color: #94a3b8; margin-top: 4px; }
        .security-footer {
            margin-top: 24px;
            font-size: 11px;
            color: #64748b;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="brand-badge">⚡ AutoForm AI</div>
        <h1>Sign in with Google</h1>
        <p class="subtitle">Connect your account to enable instant AI form filling and sync your quota across Firefox Android and Desktop.</p>

        <div id="authActions">
            <div class="google-btn-wrapper">
                <div id="g_id_onload"
                     data-client_id="${googleClientId}"
                     data-callback="handleGoogleCredential"
                     data-auto_prompt="false">
                </div>
                <div class="g_id_signin"
                     data-type="standard"
                     data-shape="pill"
                     data-theme="filled_black"
                     data-text="continue_with"
                     data-size="large"
                     data-logo_alignment="left">
                </div>
            </div>

            <div class="or-divider">Or Direct Redirect</div>

            <a href="${oauthDirectUrl}" class="btn-direct-oauth">
                <span>Open Google Sign-in Page</span> ➔
            </a>
        </div>

        <div id="stateLoading" class="state-box" style="display: none; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); color: #c7d2fe;">
            Verifying your Google account...
        </div>

        <div id="stateSuccess" class="state-box state-success" style="${isAlreadyDone ? 'display: block;' : ''}">
            <div style="font-size: 20px; margin-bottom: 4px;">✓</div>
            <strong id="successTitle">Signed in successfully!</strong>
            <p style="margin-top: 4px;">AutoForm AI is now connected. You can close this tab and return to your form.</p>
            <div id="syncCodeSection" class="sync-code-display" style="${isAlreadyDone && existing.code ? '' : 'display: none;'}">
                <div class="sync-code-note">Your Mobile Sync Code:</div>
                <div id="syncCodeValue" class="sync-code-num">${isAlreadyDone && existing.code ? existing.code : ''}</div>
                <div class="sync-code-note">Valid for 10 minutes</div>
            </div>
        </div>

        <div id="stateError" class="state-box state-error"></div>

        <div class="security-footer">
            <span>🔒 100% Private &amp; Secure • Direct Google Authentication</span>
        </div>
    </div>

    <script>
        const sessionId = "${session}";

        async function handleGoogleCredential(response) {
            const idToken = response.credential;
            if (!idToken) return;

            document.getElementById('authActions').style.display = 'none';
            document.getElementById('stateLoading').style.display = 'block';
            document.getElementById('stateError').style.display = 'none';

            try {
                const res = await fetch('/api/v1/auth/web/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session: sessionId, idToken })
                });

                const data = await res.json();
                document.getElementById('stateLoading').style.display = 'none';

                if (res.ok && data.success) {
                    document.getElementById('stateSuccess').style.display = 'block';
                    document.getElementById('successTitle').textContent = 'Welcome, ' + (data.user?.name || data.user?.email || 'User') + '!';
                    if (data.code) {
                        document.getElementById('syncCodeValue').textContent = data.code;
                        document.getElementById('syncCodeSection').style.display = 'block';
                    }
                } else {
                    document.getElementById('stateError').textContent = data.error || 'Authentication failed. Please try again.';
                    document.getElementById('stateError').style.display = 'block';
                    document.getElementById('authActions').style.display = 'block';
                }
            } catch (err) {
                document.getElementById('stateLoading').style.display = 'none';
                document.getElementById('stateError').textContent = 'Network error: ' + err.message;
                document.getElementById('stateError').style.display = 'block';
                document.getElementById('authActions').style.display = 'block';
            }
        }
    </script>
</body>
</html>`);
});

// 2. Web OAuth Complete Endpoint
app.post('/api/v1/auth/web/complete', rateLimiter, async (req, res) => {
    try {
        cleanupExpiredWebAuthSessions();
        const { session, idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({ success: false, error: 'Google ID token is required.' });
        }

        const profile = await verifyGoogleIdToken(idToken);
        const user = await findOrCreateGoogleUser(profile);
        const token = signUserToken(user);
        const quota = await formSessionManager.getUserQuotaStatus(user.id);

        // Generate backup 6-digit sync code
        const crypto = require('crypto');
        const code = crypto.randomInt(100000, 999999).toString();
        devicePairingCodes.set(code, {
            userId: user.id,
            token,
            expiresAt: Date.now() + 10 * 60 * 1000
        });

        // Store into web auth sessions for polling extension
        if (session) {
            webAuthSessions.set(session, {
                status: 'success',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: profile.name,
                    picture: profile.picture,
                    plan: quota.plan
                },
                quota,
                code,
                expiresAt: Date.now() + 10 * 60 * 1000
            });
        }

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: profile.name,
                picture: profile.picture,
                plan: quota.plan
            },
            quota,
            code
        });
    } catch (err) {
        console.error('[Web Complete Auth Error]:', err.message);
        res.status(401).json({ success: false, error: err.message || 'Google authentication failed.' });
    }
});

// 3. Web OAuth Poll Endpoint (Called by browser extension)
app.get('/api/v1/auth/web/poll', rateLimiter, (req, res) => {
    cleanupExpiredWebAuthSessions();
    const session = (req.query.session || '').toString().trim();
    if (!session) {
        return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    const entry = webAuthSessions.get(session);
    if (!entry) {
        return res.json({ success: true, status: 'pending' });
    }

    if (entry.status === 'success') {
        return res.json({
            success: true,
            status: 'success',
            token: entry.token,
            user: entry.user,
            quota: entry.quota,
            code: entry.code
        });
    }

    res.json({ success: true, status: 'pending' });
});

// 4. Web OAuth Callback Fragment Endpoint
app.get('/api/v1/auth/web/callback', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html>
<head><title>Authenticating AutoForm AI...</title></head>
<body style="background:#090a10;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
<p id="msg">Processing authentication with AutoForm AI...</p>
<script>
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');
    const session = params.get('state');

    if (idToken) {
        fetch('/api/v1/auth/web/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session, idToken })
        }).then(r => r.json()).then(data => {
            if (data.success) {
                window.location.href = '/auth/login?session=' + encodeURIComponent(session || '') + '&success=1';
            } else {
                document.getElementById('msg').textContent = 'Authentication failed: ' + (data.error || 'Unknown error');
            }
        }).catch(e => {
            document.getElementById('msg').textContent = 'Error: ' + e.message;
        });
    } else {
        document.getElementById('msg').textContent = 'No authentication token received.';
    }
</script>
</body>
</html>`);
});

// Form Session Start Endpoint
// Enforces monthly quotas, reserves a form usage slot, and issues a 30-minute session token.
app.post('/api/v1/form/start', requireAuth, async (req, res) => {
    try {
        const { formCategory } = req.body || {};
        const session = await formSessionManager.startFormSession({
            userId: req.user.userId,
            formCategory: formCategory || 'generic'
        });

        if (!session.allowed) {
            return res.status(403).json({
                success: false,
                code: 'QUOTA_EXCEEDED',
                error: session.message,
                quota: session.quota
            });
        }

        res.json({
            success: true,
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
            quota: session.quota
        });
    } catch (err) {
        console.error('[Form Start Error]:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Form Session Release Endpoint
// Releases a reserved form slot if a session ended with zero successful solves.
app.post('/api/v1/form/release', requireAuth, async (req, res) => {
    try {
        const { sessionToken } = req.body || {};
        if (sessionToken) {
            await formSessionManager.releaseSessionIfFailed(sessionToken);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Client Quota status
app.get('/api/v1/quota', optionalAuth, async (req, res) => {
    if (req.user) {
        const quota = await formSessionManager.getUserQuotaStatus(req.user.userId);
        return res.json({
            success: true,
            ...quota
        });
    }

    const clientId = req.query.clientId || req.headers['x-client-id'] || req.ip || 'anonymous';
    const isPro = (req.query.plan || req.headers['x-user-plan'] || '').toLowerCase() === 'pro';
    const quota = getQuotaStatus(clientId, isPro);
    res.json({
        success: true,
        clientId,
        ...quota
    });
});

function getValidRecentIstDates(daysBack = 2) {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const dates = [];
    const nowUtcMs = Date.now();
    for (let i = 0; i <= daysBack; i++) {
        const d = new Date(nowUtcMs + IST_OFFSET_MS - (i * 24 * 60 * 60 * 1000));
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

// On-Device Instant Profile Fill Daily Summary Endpoint
// Requires authenticated session, signed-in users only (no anonymous counters).
// Validates count is an integer 0..1000 and date is within the last 2 days (IST).
app.post('/api/v1/usage/instant-fill-summary', requireAuth, rateLimiter, async (req, res) => {
    try {
        const { count, date } = req.body || {};

        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1000) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_COUNT',
                error: 'Count must be an integer between 0 and 1000.'
            });
        }

        if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_DATE_FORMAT',
                error: 'Date must be formatted as YYYY-MM-DD.'
            });
        }

        const validRecentDates = getValidRecentIstDates(2);
        if (!validRecentDates.includes(date)) {
            return res.status(400).json({
                success: false,
                code: 'DATE_OUT_OF_RANGE',
                error: `Date '${date}' is invalid. Date must be within the last 2 days in IST (${validRecentDates.join(', ')}).`
            });
        }

        const record = await db.recordInstantFillSummary({
            userId: req.user.userId,
            dayKey: date,
            count
        });

        res.json({
            success: true,
            summary: {
                userId: req.user.userId,
                dayKey: date,
                count: record.count
            }
        });
    } catch (err) {
        console.error('[Instant Fill Summary Error]:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Account & Data Deletion Endpoint
// Permanently deletes the authenticated user, session, and associated usage records.
app.delete('/api/v1/auth/me', optionalAuth, async (req, res) => {
    try {
        let userId = req.user?.userId;
        const email = req.body?.email;
        const clientId = req.headers['x-client-id'] || req.body?.clientId;

        if (!userId && email) {
            const user = await db.findUserByGoogleSub(email);
            userId = user?.id;
        }

        if (userId) {
            await db.deleteUser(userId);
        }

        // Reset in-memory rate limiter / quota tracking if available
        if (clientId && typeof rateLimiter !== 'undefined' && rateLimiter.resetClient) {
            rateLimiter.resetClient(clientId);
        }

        res.json({
            success: true,
            message: 'User account and associated usage data successfully deleted.'
        });
    } catch (err) {
        console.error('[AutoForm Server] Error in DELETE /api/v1/auth/me:', err.message);
        res.status(500).json({
            success: false,
            error: 'Failed to delete account. Please try again or contact support.'
        });
    }
});

// ---------------------------------------------------------------------------
// Razorpay Payment Endpoints & Hosted Checkout Page
// ---------------------------------------------------------------------------

// Create Razorpay Order Endpoint
// Derives order for the authenticated user and records it in payments table.
app.post('/api/v1/payments/create-order', requireAuth, async (req, res) => {
    try {
        if (!config.paymentsEnabled && process.env.PAYMENTS_ENABLED !== 'true' && process.env.PAYMENTS_ENABLED !== '1') {
            return res.status(503).json({
                success: false,
                code: 'PAYMENTS_DISABLED',
                error: 'Paid passes are currently disabled. Pro upgrades will be available soon.'
            });
        }

        const { planId } = req.body || {};
        const order = await paymentService.createOrder({
            userId: req.user.userId,
            userEmail: req.user.email,
            planId: planId || 'pass_30d'
        });
        res.json({ success: true, ...order });
    } catch (err) {
        console.error('[Payment Create-Order Error]:', err.message);
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'ORDER_CREATION_FAILED',
            error: err.message
        });
    }
});

// Verify Checkout Endpoint
// Verify Checkout Endpoint
// Derives plan, amount, and user ownership directly from our stored order row or direct Razorpay ID.
// Shares the idempotent grant function with webhook and direct payments.
app.post('/api/v1/payments/verify-checkout', optionalAuth, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            orderId,
            paymentId,
            signature
        } = req.body || {};

        const effectiveOrderId = razorpay_order_id || orderId;
        const effectivePaymentId = razorpay_payment_id || paymentId;
        const effectiveSignature = razorpay_signature || signature;

        const userId = req.user?.userId || null;

        const result = await paymentService.verifyCheckout({
            userId,
            orderId: effectiveOrderId,
            paymentId: effectivePaymentId,
            signature: effectiveSignature
        });

        let quota = { isPro: true, plan: 'pro', limit: 300, remaining: 300 };
        if (userId) {
            quota = await formSessionManager.getUserQuotaStatus(userId);
        }

        res.json({
            success: true,
            plan: 'pro',
            ...result,
            quota,
            message: 'AutoForm Pro activated successfully!'
        });
    } catch (err) {
        console.error('[Payment Verify-Checkout Error]:', err.message);
        res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || 'CHECKOUT_VERIFICATION_FAILED',
            error: err.message
        });
    }
});

// Backward-compatibility endpoint for legacy clients and direct links
app.post('/api/v1/verify-payment', optionalAuth, async (req, res) => {
    const { paymentId, orderId, signature } = req.body || {};
    const effectivePaymentId = paymentId || req.body?.razorpay_payment_id;
    if (!effectivePaymentId) {
        return res.status(400).json({ success: false, error: 'Missing Payment ID.' });
    }

    if (typeof effectivePaymentId !== 'string' || !effectivePaymentId.startsWith('pay_')) {
        return res.status(400).json({ success: false, error: 'Invalid Razorpay Payment ID. Must start with "pay_"' });
    }

    try {
        const result = await paymentService.verifyCheckout({
            userId: req.user?.userId || null,
            orderId: orderId || req.body?.razorpay_order_id,
            paymentId: effectivePaymentId,
            signature: signature || req.body?.razorpay_signature
        });
        return res.json({ success: true, plan: 'pro', ...result, message: 'AutoForm Pro activated successfully!' });
    } catch (e) {
        return res.status(e.statusCode || 400).json({ success: false, error: e.message });
    }
});

// Admin Entitlement Revocation Endpoint (for manual or automated refund handling)
// Header only: X-Admin-Token or Bearer, rate-limited, constant-time compare, never logs tokens
app.post('/api/v1/admin/revoke-entitlement', rateLimiter, requireAdminAuth, async (req, res) => {
    try {
        let adminToken = req.headers['x-admin-token'];
        if (!adminToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            adminToken = req.headers.authorization.slice(7).trim();
        }
        const { paymentId } = req.body || {};
        const result = await paymentService.revokeEntitlementAdmin({ paymentId, adminToken });
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 401).json({ success: false, error: err.message });
    }
});

// Admin Usage & Business Statistics Endpoints
// Header only: X-Admin-Token or Bearer, rate-limited, constant-time compare, never logs tokens
app.get(['/admin/stats', '/api/v1/admin/stats'], rateLimiter, requireAdminAuth, async (req, res) => {
    try {
        const stats = await statsService.buildAdminStats({ routerStatus: router.getStatus() });
        res.json(stats);
    } catch (err) {
        console.error('[Admin Stats Error]:', err.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve administrative statistics.' });
    }
});

// Diagnostic Debug IP Route
// Shows resolved req.ip, socket remoteAddress, raw X-Forwarded-For, and trust proxy hop count.
// Gated by process.env.DEBUG_IP_ENDPOINT === 'true' or ADMIN_STATS_TOKEN header. Disabled by default.
app.get(['/api/v1/admin/debug-ip', '/debug-ip'], rateLimiter, (req, res) => {
    const isDebugEnabled = process.env.DEBUG_IP_ENDPOINT === 'true' || process.env.DEBUG_IP_ENDPOINT === '1';
    let adminToken = req.headers['x-admin-token'];
    if (!adminToken && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        adminToken = req.headers.authorization.slice(7).trim();
    }
    const expectedToken = process.env.ADMIN_STATS_TOKEN || config.adminStatsToken || '';
    const isAdmin = Boolean(
        expectedToken &&
        adminToken &&
        expectedToken.length === adminToken.length &&
        crypto.timingSafeEqual(Buffer.from(adminToken), Buffer.from(expectedToken))
    );

    if (!isDebugEnabled && !isAdmin) {
        return res.status(404).json({ success: false, error: 'Endpoint not found or disabled' });
    }

    res.json({
        success: true,
        resolvedIp: req.ip,
        remoteAddress: req.socket.remoteAddress,
        rawXForwardedFor: req.headers['x-forwarded-for'] || null,
        trustProxySetting: app.get('trust proxy'),
        trustProxyHops: config.trustProxyHops,
        nodeEnv: config.env,
        timestamp: new Date().toISOString()
    });
});

// Hosted Checkout Page
// Passes the short-lived session token in the URL fragment (#token=...), never in query string.
// Allows checkout.razorpay.com in CSP specifically for this page; strict headers everywhere else.
app.get('/checkout', (req, res) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:;"
    );
    const paymentsOn = config.paymentsEnabled || process.env.PAYMENTS_ENABLED === 'true' || process.env.PAYMENTS_ENABLED === '1';
    res.send(renderHostedCheckoutHtml(paymentsOn));
});

function renderHostedCheckoutHtml(paymentsEnabled = false) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoForm AI Pro — Upgrade Checkout</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .checkout-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-bottom: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    p.subtext { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .plans-grid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
    .plan-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border: 2px solid var(--card-border);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      background: rgba(255,255,255,0.02);
    }
    .plan-option:hover { border-color: var(--primary); background: rgba(59, 130, 246, 0.05); }
    .plan-option.selected { border-color: var(--primary); background: rgba(59, 130, 246, 0.1); }
    .plan-info { display: flex; flex-direction: column; gap: 2px; }
    .plan-name { font-weight: 600; font-size: 16px; }
    .plan-sub { font-size: 12px; color: var(--text-muted); }
    .plan-price { font-size: 18px; font-weight: 700; color: #60a5fa; }
    .features-list { margin: 20px 0; border-top: 1px solid var(--card-border); padding-top: 16px; }
    .feature-item { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #cbd5e1; margin-bottom: 8px; }
    .feature-item svg { width: 16px; height: 16px; color: var(--accent); flex-shrink: 0; }
    .btn-pay {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 14px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-pay:hover { background: var(--primary-hover); }
    .btn-pay:disabled { opacity: 0.6; cursor: not-allowed; }
    .notice {
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 16px;
      line-height: 1.5;
    }
    .notice a { color: #60a5fa; text-decoration: none; }
    .notice a:hover { text-decoration: underline; }
    .error-box { background: rgba(239,68,68,0.15); border: 1px solid var(--danger); color: #f87171; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; display: none; }
    .success-box { text-align: center; padding: 30px 0; display: none; }
    .success-box h2 { font-size: 22px; color: #34d399; margin-bottom: 12px; }
    .success-box p { color: var(--text-muted); font-size: 14px; line-height: 1.6; }
  </style>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
  <div class="checkout-card">
    <div id="checkoutContent">
      <div class="badge">One-time payment, no auto-renew</div>
      <h1>Upgrade to AutoForm AI Pro</h1>
      <p class="subtext">Choose your pass to unlock 300 AI form fills per month with high-speed priority failover.</p>
      
      <div id="errorBox" class="error-box"></div>
      
      ${!paymentsEnabled ? `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; padding: 16px; border-radius: 12px; margin: 16px 0; text-align: center; font-size: 14px; line-height: 1.6;">
        🚀 <strong>Pro passes are coming soon</strong><br>
        Paid checkout is currently undergoing maintenance. Please enjoy your free monthly form quota!
      </div>
      ` : ''}

      <div class="plans-grid">
        <label class="plan-option" onclick="selectPlan('pass_14d')">
          <input type="radio" name="plan" value="pass_14d" style="display:none;">
          <div class="plan-info">
            <span class="plan-name">14-Day Pro Pass</span>
            <span class="plan-sub">₹99 one-time payment</span>
          </div>
          <span class="plan-price">₹99</span>
        </label>

        <label class="plan-option selected" onclick="selectPlan('pass_30d')">
          <input type="radio" name="plan" value="pass_30d" checked style="display:none;">
          <div class="plan-info">
            <span class="plan-name">30-Day Pro Pass ⭐</span>
            <span class="plan-sub">₹149 one-time payment</span>
          </div>
          <span class="plan-price">₹149</span>
        </label>

        <label class="plan-option" onclick="selectPlan('pass_90d')">
          <input type="radio" name="plan" value="pass_90d" style="display:none;">
          <div class="plan-info">
            <span class="plan-name">90-Day Pro Pass</span>
            <span class="plan-sub">₹349 one-time payment</span>
          </div>
          <span class="plan-price">₹349</span>
        </label>
      </div>

      <div class="features-list">
        <div class="feature-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>300 AI form fills per month</span>
        </div>
        <div class="feature-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>All AI engines (Groq, Gemini, OpenRouter, NVIDIA)</span>
        </div>
        <div class="feature-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Resume binary vault & auto-attach on job forms</span>
        </div>
        <div class="feature-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Non-recurring: Never billed automatically</span>
        </div>
      </div>

      ${!paymentsEnabled ? `
      <button id="btnPay" class="btn-pay" disabled style="opacity: 0.5; cursor: not-allowed;">Pro passes are coming soon</button>
      ` : `
      <button id="btnPay" class="btn-pay" onclick="handlePay()">Proceed to Pay with Razorpay</button>
      `}

      <p class="notice">
        By proceeding, you agree to our <a href="/site/terms.html" target="_blank">Terms of Service</a> and <a href="/site/refund.html" target="_blank">Refund Policy</a>.<br>
        Payments are securely processed via Razorpay (UPI, Debit/Credit Cards, Netbanking).
      </p>
    </div>

    <div id="successBox" class="success-box">
      <h2>🎉 Pro Pass Activated!</h2>
      <p>Thank you! Your AutoForm AI Pro pass is now active with 300 monthly AI form fills.<br><br>You can safely close this tab and return to your forms.</p>
    </div>
  </div>

  <script>
    let currentPlan = 'pass_30d';

    function selectPlan(planId) {
      currentPlan = planId;
      document.querySelectorAll('.plan-option').forEach(el => el.classList.remove('selected'));
      const activeEl = document.querySelector('input[value="' + planId + '"]')?.parentElement;
      if (activeEl) activeEl.classList.add('selected');
    }

    function getSessionToken() {
      // Read short-lived session token from URL hash fragment (#token=...), never from query string
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      return params.get('token');
    }

    // Auto-select plan from query string if specified
    const urlPlan = new URLSearchParams(window.location.search).get('plan');
    if (urlPlan && ['pass_14d', 'pass_30d', 'pass_90d'].includes(urlPlan)) {
      selectPlan(urlPlan);
    }

    async function handlePay() {
      const token = getSessionToken();
      const errBox = document.getElementById('errorBox');
      const btn = document.getElementById('btnPay');

      if (!token) {
        errBox.textContent = 'Session token not found. Please click "Upgrade to Pro" directly from the AutoForm AI extension popup.';
        errBox.style.display = 'block';
        return;
      }

      errBox.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Creating secure order...';

      try {
        const orderRes = await fetch('/api/v1/payments/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ planId: currentPlan })
        });

        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.success) {
          throw new Error(orderData.error || 'Failed to initiate order.');
        }

        btn.textContent = 'Opening Razorpay...';

        const rzp = new Razorpay({
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'AutoForm AI',
          description: orderData.planName + ' (One-Time)',
          order_id: orderData.orderId,
          prefill: {
            email: orderData.userEmail || ''
          },
          theme: { color: '#3b82f6' },
          handler: async function (response) {
            btn.textContent = 'Verifying payment...';
            try {
              const verifyRes = await fetch('/api/v1/payments/verify-checkout', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                })
              });

              const verifyData = await verifyRes.json();
              if (verifyRes.ok && verifyData.success) {
                document.getElementById('checkoutContent').style.display = 'none';
                document.getElementById('successBox').style.display = 'block';
              } else {
                throw new Error(verifyData.error || 'Payment verification failed.');
              }
            } catch (vErr) {
              errBox.textContent = vErr.message;
              errBox.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Proceed to Pay with Razorpay';
            }
          },
          modal: {
            ondismiss: function() {
              btn.disabled = false;
              btn.textContent = 'Proceed to Pay with Razorpay';
            }
          }
        });

        rzp.open();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Proceed to Pay with Razorpay';
      }
    }
  </script>
</body>
</html>`;
}

// Payment Confirmation Screen
// Displayed when payment succeeds or Razorpay redirects back.
// Confirms transaction and signals AutoForm AI extension to activate Pro instantly.
app.get(['/payment/success', '/payment-success'], (req, res) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https:;"
    );
    const paymentId = req.query.razorpay_payment_id || req.query.payment_id || req.query.paymentId || '';
    res.send(renderPaymentSuccessHtml(paymentId));
});

function renderPaymentSuccessHtml(paymentId = '') {
    const safePaymentId = String(paymentId).replace(/[^a-zA-Z0-9_-]/g, '');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful — AutoForm Pro Activated</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .success-card {
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.2);
    }
    .check-icon-circle {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px auto;
      box-shadow: 0 0 30px rgba(16, 185, 129, 0.4);
      animation: check-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .check-icon-circle svg {
      width: 36px;
      height: 36px;
      color: #ffffff;
    }
    @keyframes check-pop {
      0% { transform: scale(0.4); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    .pro-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      color: #92400e;
      border: 1px solid #fcd34d;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
      text-transform: uppercase;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .subtext {
      color: var(--text-muted);
      font-size: 14.5px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .payment-id-pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed var(--card-border);
      border-radius: 10px;
      padding: 10px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      color: #cbd5e1;
      display: inline-block;
      margin-bottom: 24px;
      word-break: break-all;
    }
    .features-grid {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 28px;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .feature-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13.5px;
      color: #e2e8f0;
    }
    .feature-row span.icon {
      color: var(--accent);
      font-weight: bold;
    }
    .status-alert {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .actions-row {
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14.5px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
    }
  </style>
</head>
<body>
  <div class="success-card">
    <div class="check-icon-circle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>

    <div class="pro-badge">AutoForm AI Pro</div>
    <h1>Payment Successful!</h1>
    <p class="subtext">Your Pro pass is active with unlimited AI form fills and high-speed multi-provider routing.</p>

    <div class="status-alert">
      ✓ AutoForm AI extension upgraded to Pro automatically
    </div>

    ${safePaymentId ? `
    <div class="payment-id-pill">
      Payment ID: <strong>${safePaymentId}</strong>
    </div>` : ''}

    <div class="features-grid">
      <div class="feature-row">
        <span class="icon">✓</span>
        <span>Unlimited AI Form Fills (Fair-use 300/mo)</span>
      </div>
      <div class="feature-row">
        <span class="icon">✓</span>
        <span>All 4 AI Providers (Groq, Gemini, OpenRouter, NVIDIA)</span>
      </div>
      <div class="feature-row">
        <span class="icon">✓</span>
        <span>Resume Binary Vault & Auto-Attach</span>
      </div>
      <div class="feature-row">
        <span class="icon">✓</span>
        <span>Zero manual activation needed — plan is live now</span>
      </div>
    </div>

    <div class="actions-row">
      <button class="btn btn-primary" onclick="handleReturn()">Return to Forms</button>
      <a class="btn btn-secondary" href="https://docs.google.com/forms" target="_blank">Open Google Forms</a>
    </div>
  </div>

  <script>
    const pid = new URLSearchParams(window.location.search).get('razorpay_payment_id') ||
                new URLSearchParams(window.location.search).get('payment_id') ||
                '${safePaymentId}';

    if (pid && pid.startsWith('pay_')) {
      fetch('/api/v1/payments/verify-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: pid })
      }).catch(() => {});
    }

    function handleReturn() {
      if (window.opener) {
        window.close();
      } else {
        window.location.href = 'https://docs.google.com/forms';
      }
    }
  </script>
</body>
</html>`;
}


// Dynamic Extension Configuration Endpoint
// Returns runtime config that extensions can cache locally.
// Allows model changes, selector patches, and announcements without store updates.
app.get('/api/v1/config', (req, res) => {
    const status = router.getStatus();
    res.json({
        version: '2.0.6',
        providers: status.activeProviders || [],
        rateLimitPerHour: config.rateLimitPerHour,
        maintenanceMode: false,
        announcement: process.env.ANNOUNCEMENT_TEXT || '',
        paymentsEnabled: config.paymentsEnabled,
        features: {
            instantProfile: true,
            hybridRag: true,
            wholeFormReasoning: true,
            storyDeduplication: true,
            previewBeforeFill: true,
            resumeVault: true,
            resumeAutoAttach: true
        },
        googleClientId: process.env.GOOGLE_CLIENT_ID || '124825767907-8i59japp45ibhclluloh8bs5ididjmkp.apps.googleusercontent.com',
        selectorPatches: {},
        timestamp: new Date().toISOString()
    });
});

// Middleware to authenticate /solve or allow controlled legacy anonymous solve
async function solveAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return requireAuth(req, res, next);
    }

    // New installs get two locally tracked guest form trials. They identify
    // these requests explicitly; older extension compatibility remains behind
    // the legacy environment flag.
    const guestTrialRequest = req.headers['x-autoform-guest-trial'] === '1';
    const legacyAllowed = guestTrialRequest || config.legacyAnonSolve || process.env.LEGACY_ANON_SOLVE === 'true' || process.env.LEGACY_ANON_SOLVE === '1';

    if (!legacyAllowed) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Please sign in with your Google account.',
            code: 'AUTH_REQUIRED'
        });
    }

    // Legacy anonymous solve mode: per-IP daily cap
    // Reads strictly from req.ip (trust proxy handled by Express), never raw X-Forwarded-For header
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const legacyCap = guestTrialRequest
        ? config.guestTrialDailyIpCap
        : (config.legacyDailyIpCap || parseInt(process.env.LEGACY_DAILY_IP_CAP || '150', 10));
    const dayKey = db.getTodayDateKeyIST();

    const currentCount = await db.getLegacyIpDailySolveCount(ip, dayKey);
    if (currentCount >= legacyCap) {
        console.warn(`[Legacy Solve] IP reached legacy daily cap (${currentCount}/${legacyCap})`);
        return res.status(429).json({
            success: false,
            code: 'LEGACY_IP_CAP_EXCEEDED',
            error: guestTrialRequest
                ? 'Guest trial limit reached. Sign in with Google to continue.'
                : `Daily anonymous legacy solve limit reached (${legacyCap} solves/day). Please update extension to AutoForm AI v2.0.6 and sign in with Google for full access.`,
            dailyLimit: legacyCap,
            dailySolves: currentCount,
            requestId: req.id
        });
    }

    console.log(`[Legacy Solve] Anonymous solve from IP (count: ${currentCount + 1}/${legacyCap})`);
    req.isLegacyAnon = true;
    req.legacyIp = ip;
    req.legacyDayKey = dayKey;
    next();
}

// Primary Solve Endpoint
// Protected by solveAuthMiddleware (requireAuth or legacyAnonSolve per-IP cap), rateLimiter, and validateSolveRequest.
// Enforces form session validation, 30m expiry, 60-question cap, and marks fill success on valid answer.
app.post('/api/v1/solve', solveAuthMiddleware, rateLimiter, validateSolveRequest, async (req, res) => {
    const sessionToken = req.headers['x-form-session-token'] || req.body?.formSessionToken;

    try {
        let isPro = false;
        if (!req.isLegacyAnon) {
            // Enforce session validation, expiration, and 60-question cap
            formSessionManager.validateAndRecordSolve(sessionToken, req.user.userId);

            // Enforce per-user daily solve cap (200 free / 1500 pro, configurable via env)
            const entitlement = await db.getActiveEntitlement(req.user.userId);
            isPro = !!entitlement;
            const dailyLimit = isPro ? config.dailySolveCapPro : config.dailySolveCapFree;
            const currentDailySolves = await db.getDailySolveCount(req.user.userId);

            if (currentDailySolves >= dailyLimit) {
                return res.status(429).json({
                    success: false,
                    code: 'DAILY_SOLVE_CAP_EXCEEDED',
                    error: `Daily solve limit reached (${dailyLimit} solves/day on ${isPro ? 'Pro' : 'Free'} plan). Limits reset at midnight IST.`,
                    dailyLimit,
                    dailySolves: currentDailySolves,
                    requestId: req.id
                });
            }
        } else if ((req.headers['x-user-plan'] || req.body?.userPlan || '').toLowerCase() === 'pro') {
            isPro = true;
        }

        const { question, type, choices, customContext, tone } = req.body;

        const result = await router.solve({
            question,
            type,
            choices,
            customContext,
            tone,
            isPro,
            userPlan: isPro ? 'pro' : 'free'
        });

        if (req.isLegacyAnon) {
            await db.incrementLegacyIpDailySolveCount(req.legacyIp, req.legacyDayKey);
        } else {
            // Increment daily solve counter on attempt
            await db.incrementDailySolveCount(req.user.userId);

            // Mark form session as successful on the server when at least one solve returns a valid answer
            if (result && (result.answer || (result.answers && result.answers.length > 0))) {
                await formSessionManager.markSessionSuccess(sessionToken);
            }
        }

        res.json({
            success: true,
            answer: result.answer,
            answers: result.answers,
            provider: result.provider,
            latencyMs: result.latencyMs,
            confidence: result.confidence || 'high',
            reasoning: result.reasoning || '',
            tier: result.tier || (isPro ? 'pro' : 'free'),
            modelTier: result.modelTier || (isPro ? '70b-flagship-reasoning' : 'standard'),
            requestId: req.id
        });

    } catch (err) {
        console.error(`[API /solve Error] [req:${req.id}]:`, err.message);

        // Session-specific status codes (e.g. 400 for missing token, 403 for invalid, 410 for expired, 429 for cap)
        if (err.code && err.statusCode) {
            return res.status(err.statusCode).json({
                success: false,
                code: err.code,
                error: err.message,
                retryable: err.retryable || false,
                requestId: req.id
            });
        }

        const isProd = config.env === 'production';
        const publicError = isProd ? 'AI solving failed across all available providers' : err.message;
        res.status(500).json({
            success: false,
            error: publicError,
            requestId: req.id
        });
    }
});

// Resume Intelligence Parsing Endpoint
// Extracts structured identity, education, links, and memory snippets from uploaded resume text
app.post('/api/v1/parse-resume', rateLimiter, async (req, res) => {
    try {
        const { resumeText, fileName } = req.body || {};
        if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: "resumeText" must be a non-empty string'
            });
        }

        const cleanText = resumeText.trim().slice(0, 15000);
        const result = await router.solve({
            question: `Extract structured profile from resume ${fileName ? `"${fileName}"` : ''}`,
            type: 'resume_parse',
            resumeText: cleanText
        });

        const profile = result.profile || (result.answer ? JSON.parse(result.answer) : null);
        if (!profile) {
            throw new Error('Failed to parse structured profile from AI response');
        }

        res.json({
            success: true,
            profile,
            provider: result.provider,
            latencyMs: result.latencyMs,
            requestId: req.id
        });
    } catch (err) {
        console.error(`[API /parse-resume Error] [req:${req.id}]:`, err.message);
        const isProd = config.env === 'production';
        const publicError = isProd ? 'Resume parsing failed on available AI engines' : err.message;
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
