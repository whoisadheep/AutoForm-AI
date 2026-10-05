/**
 * @file server/src/services/formSessionManager.js
 * @description Manages AI form fill sessions, prevents quota cheating,
 * handles reservation-at-start, auto-settlement on valid solve,
 * 30-minute expiry, and 60 question caps per session.
 */

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const FREE_MONTHLY_LIMIT = 10;
const PRO_MONTHLY_LIMIT = 300;
const MAX_QUESTIONS_PER_SESSION = 60;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// In-memory active session registry (sessionToken -> session object)
const activeSessions = new Map();

/**
 * Returns active unconfirmed sessions currently open for a user.
 * @param {string} userId 
 * @returns {number}
 */
function getActivePendingSessionCount(userId) {
    const now = Date.now();
    let count = 0;
    for (const session of activeSessions.values()) {
        if (session.userId === userId && !session.hasSuccessfulSolve && session.expiresAt > now) {
            count++;
        }
    }
    return count;
}

/**
 * Computes the real-time IST monthly quota status for a user.
 * Takes into account both confirmed successful form fills and active reserved sessions.
 * @param {string} userId 
 * @returns {Promise<Object>}
 */
async function getUserQuotaStatus(userId) {
    const entitlement = await db.getActiveEntitlement(userId);
    const isPro = !!entitlement;
    const plan = isPro ? 'pro' : 'free';
    const limit = isPro ? PRO_MONTHLY_LIMIT : FREE_MONTHLY_LIMIT;

    const successfulForms = await db.getMonthlySuccessfulFormsCount(userId);
    const pendingReservations = getActivePendingSessionCount(userId);
    const totalUsed = successfulForms + pendingReservations;
    const remaining = Math.max(0, limit - totalUsed);
    const resetDate = db.getNextMonthResetDateIST().toISOString();

    return {
        userId,
        plan,
        isPro,
        limit,
        used: totalUsed,
        successfulForms,
        pendingReservations,
        remaining,
        resetDate,
        proExpiresAt: entitlement ? entitlement.expires_at : null,
        paymentsEnabled: config.paymentsEnabled || process.env.PAYMENTS_ENABLED === 'true' || process.env.PAYMENTS_ENABLED === '1'
    };
}

/**
 * Starts a new form fill session by reserving a usage slot against the user's monthly quota.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} [params.formCategory]
 * @returns {Promise<Object>}
 */
async function startFormSession({ userId, formCategory = 'generic' }) {
    if (!userId) {
        throw new Error('User ID is required to start a form session.');
    }

    // Atomically check quota and reserve slot inside DB transaction + user lock
    const reservation = await db.reserveFormSessionSlot({ userId, formCategory });

    if (!reservation.allowed) {
        // Record limit_hit event for analytics
        const todayKey = db.getTodayDateKeyIST();
        await db.recordLimitHitEvent(userId, todayKey);

        const quota = await getUserQuotaStatus(userId);
        const paymentsOn = config.paymentsEnabled || process.env.PAYMENTS_ENABLED === 'true' || process.env.PAYMENTS_ENABLED === '1';
        const formattedResetDate = new Date(quota.resetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        return {
            allowed: false,
            error: 'QUOTA_EXCEEDED',
            message: reservation.isPro
                ? 'You have reached the monthly fair-use cap of 300 forms on Pro.'
                : (paymentsOn
                    ? 'You have used all 10 free AI form fills for this month. Upgrade to Pro for unlimited forms.'
                    : `You have used all 10 free AI form fills for this month. Your monthly limit resets on ${formattedResetDate}. Pro passes are coming soon!`),
            quota,
            paymentsEnabled: paymentsOn
        };
    }

    const sessionToken = 'fses_' + crypto.randomBytes(24).toString('hex');
    const now = Date.now();

    const session = {
        sessionToken,
        userId,
        formCategory,
        reservedEventId: reservation.eventId,
        startedAt: now,
        expiresAt: now + SESSION_TTL_MS,
        solveCount: 0,
        hasSuccessfulSolve: false
    };

    activeSessions.set(sessionToken, session);

    const resetDate = db.getNextMonthResetDateIST().toISOString();

    return {
        allowed: true,
        sessionToken,
        expiresAt: new Date(session.expiresAt).toISOString(),
        quota: {
            userId,
            plan: reservation.isPro ? 'pro' : 'free',
            isPro: reservation.isPro,
            limit: reservation.limit,
            used: reservation.used,
            remaining: reservation.remaining,
            resetDate
        }
    };
}

/**
 * Validates session ownership, expiration, and question limits before a question solve.
 * Increments the question counter in the session.
 * @param {string} sessionToken 
 * @param {string} userId 
 * @returns {Object} Active session
 */
function validateAndRecordSolve(sessionToken, userId) {
    if (!sessionToken || typeof sessionToken !== 'string') {
        const err = new Error('Missing form session token. Call /api/v1/form/start before solving questions.');
        err.code = 'MISSING_SESSION_TOKEN';
        err.statusCode = 400;
        throw err;
    }

    const session = activeSessions.get(sessionToken);

    if (!session || session.userId !== userId) {
        const err = new Error('Invalid or unrecognized form session token for this user.');
        err.code = 'INVALID_SESSION';
        err.statusCode = 403;
        throw err;
    }

    if (Date.now() > session.expiresAt) {
        const err = new Error('Form session expired. Form sessions expire after 30 minutes.');
        err.code = 'SESSION_EXPIRED';
        err.statusCode = 410;
        throw err;
    }

    if (session.solveCount >= MAX_QUESTIONS_PER_SESSION) {
        const err = new Error(`Exceeded maximum of ${MAX_QUESTIONS_PER_SESSION} questions per form session.`);
        err.code = 'SESSION_QUESTION_CAP_EXCEEDED';
        err.statusCode = 429;
        throw err;
    }

    session.solveCount++;
    return session;
}

/**
 * Confirms a successful form fill on the server when at least one question
 * in the session returns a valid, non-error answer from an AI provider.
 * @param {string} sessionToken 
 */
async function markSessionSuccess(sessionToken) {
    const session = activeSessions.get(sessionToken);
    if (!session) return;

    if (!session.hasSuccessfulSolve) {
        session.hasSuccessfulSolve = true;
        try {
            await db.markUsageEventSuccess(session.reservedEventId);
        } catch (err) {
            console.error('[FormSession] Error confirming usage event success:', err.message);
        }
    }
}

/**
 * Releases the reserved quota if the form fill finished with zero successful solves
 * (e.g., all provider calls failed or form was abandoned before answering).
 * @param {string} sessionToken 
 */
async function releaseSessionIfFailed(sessionToken) {
    const session = activeSessions.get(sessionToken);
    if (!session) return;

    if (!session.hasSuccessfulSolve) {
        try {
            await db.deleteUsageEvent(session.reservedEventId);
        } catch (err) {
            console.error('[FormSession] Error deleting reserved event:', err.message);
        }
    }

    activeSessions.delete(sessionToken);
}

/**
 * Periodic sweep to clean up expired sessions and release reservations
 * that ended with zero successful solves.
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (session.expiresAt <= now) {
            if (!session.hasSuccessfulSolve) {
                db.deleteUsageEvent(session.reservedEventId).catch(() => {});
            }
            activeSessions.delete(token);
        }
    }
}

// Run cleanup every 2 minutes
const cleanupTimer = setInterval(cleanupExpiredSessions, 2 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Resets all active sessions (used in unit test teardowns).
 */
function resetSessions() {
    activeSessions.clear();
}

module.exports = {
    FREE_MONTHLY_LIMIT,
    PRO_MONTHLY_LIMIT,
    MAX_QUESTIONS_PER_SESSION,
    SESSION_TTL_MS,
    getUserQuotaStatus,
    startFormSession,
    validateAndRecordSolve,
    markSessionSuccess,
    releaseSessionIfFailed,
    cleanupExpiredSessions,
    resetSessions,
    _getActiveSessionsCount: () => activeSessions.size
};
