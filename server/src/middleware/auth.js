/**
 * @file server/src/middleware/auth.js
 * @description Express middleware to enforce JWT session authentication.
 */

const db = require('../db');
const { verifyUserToken } = require('../services/auth');

/**
 * Middleware that strictly requires a valid Bearer session JWT.
 * Verifies that the user still exists in the database so deleted users are rejected.
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Please sign in with your Google account.',
            code: 'AUTH_REQUIRED'
        });
    }

    const token = authHeader.slice(7).trim();

    try {
        const decoded = verifyUserToken(token);
        
        // Verify user still exists in database (rejects token after DELETE /auth/me)
        const user = await db.findUserById(decoded.userId);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User account not found or has been deleted.',
                code: 'USER_DELETED'
            });
        }

        req.user = decoded;
        req.dbUser = user;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired session token. Please sign in again.',
            code: 'AUTH_INVALID_TOKEN'
        });
    }
}

/**
 * Middleware that optionally decodes a Bearer token if present.
 */
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';

    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        try {
            const decoded = verifyUserToken(token);
            const user = await db.findUserById(decoded.userId);
            req.user = user ? decoded : null;
        } catch {
            req.user = null;
        }
    } else {
        req.user = null;
    }
    next();
}

const crypto = require('crypto');

/**
 * Middleware that protects admin routes.
 * Enforces:
 * - Header only: X-Admin-Token or Authorization: Bearer <token>
 * - No query param ?token= allowed
 * - Constant-time comparison with crypto.timingSafeEqual
 * - Never logs the token
 */
function requireAdminAuth(req, res, next) {
    const expectedToken = process.env.ADMIN_STATS_TOKEN;
    if (!expectedToken) {
        return res.status(500).json({
            success: false,
            error: 'ADMIN_STATS_TOKEN is not configured on the server.'
        });
    }

    // Header only: X-Admin-Token or Authorization: Bearer <token>
    let provided = req.headers['x-admin-token'];
    if (!provided && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        provided = req.headers.authorization.slice(7).trim();
    }

    if (!provided || typeof provided !== 'string') {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Missing admin authentication token in request headers.'
        });
    }

    const provBuf = Buffer.from(provided, 'utf8');
    const expBuf = Buffer.from(expectedToken, 'utf8');

    if (provBuf.length !== expBuf.length || !crypto.timingSafeEqual(provBuf, expBuf)) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Invalid admin authentication token.'
        });
    }

    next();
}

module.exports = {
    requireAuth,
    optionalAuth,
    requireAdminAuth
};
