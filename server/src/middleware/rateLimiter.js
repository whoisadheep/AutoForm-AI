/**
 * @file server/src/middleware/rateLimiter.js
 * @description In-memory sliding-window rate limiter per client ID or IP.
 */

const config = require('../config');

const usageMap = new Map();

// Periodic cleanup of stale client records every 10 minutes
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [clientId, timestamps] of usageMap.entries()) {
        const filtered = timestamps.filter(t => t > oneHourAgo);
        if (filtered.length === 0) {
            usageMap.delete(clientId);
        } else {
            usageMap.set(clientId, filtered);
        }
    }
}, 10 * 60 * 1000);

function rateLimiter(req, res, next) {
    const clientId = req.body?.clientId || req.headers['x-client-id'] || req.ip || 'anonymous';
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const history = usageMap.get(clientId) || [];
    const validTimestamps = history.filter(t => t > oneHourAgo);

    const limit = config.rateLimitPerHour;

    if (validTimestamps.length >= limit) {
        const oldest = validTimestamps[0];
        const resetInSeconds = Math.ceil((oldest + (60 * 60 * 1000) - now) / 1000);

        res.set('Retry-After', String(resetInSeconds));
        return res.status(429).json({
            success: false,
            error: `Hourly rate limit of ${limit} questions reached. Please try again in ${Math.ceil(resetInSeconds / 60)} minutes.`,
            retryAfterSeconds: resetInSeconds
        });
    }

    validTimestamps.push(now);
    usageMap.set(clientId, validTimestamps);

    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(limit - validTimestamps.length));

    next();
}

function getQuotaStatus(clientId) {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const history = usageMap.get(clientId) || [];
    const used = history.filter(t => t > oneHourAgo).length;
    const limit = config.rateLimitPerHour;

    return {
        used,
        limit,
        remaining: Math.max(0, limit - used)
    };
}

module.exports = {
    rateLimiter,
    getQuotaStatus
};
