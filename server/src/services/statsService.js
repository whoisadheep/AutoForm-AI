/**
 * @file server/src/services/statsService.js
 * @description Aggregates usage statistics, revenue, user retention,
 * and AI provider reliability for the password-protected /admin/stats endpoint.
 * Strictly guarantees that no question text, answers, or URLs are ever exposed.
 */

const db = require('../db');

/**
 * Builds the complete administrative statistics payload.
 * @param {Object} [options]
 * @param {Object} [options.routerStatus] Status from router.getStatus()
 * @returns {Promise<Object>}
 */
async function buildAdminStats({ routerStatus = null } = {}) {
    const todayIst = db.getTodayDateKeyIST();
    const dbStats = await db.getAdminStats(todayIst);

    // Format provider performance metrics with explicit "since last server restart" label
    const rawMetrics = routerStatus?.metrics || {};
    const formattedProviders = {};

    for (const [providerName, m] of Object.entries(rawMetrics)) {
        const successes = m.success || 0;
        const failures = m.failures || 0;
        const totalReqs = successes + failures;
        const errorRatePercent = totalReqs > 0 ? +((failures / totalReqs) * 100).toFixed(1) : 0;
        const successRatePercent = totalReqs > 0 ? +((successes / totalReqs) * 100).toFixed(1) : 100;

        formattedProviders[providerName] = {
            configured: m.configured,
            circuitState: m.circuit?.state || 'CLOSED',
            totalRequests: totalReqs,
            successes,
            failures,
            errorRatePercent,
            successRatePercent,
            avgLatencyMs: Math.round(m.avgLatencyMs || 0)
        };
    }

    return {
        success: true,
        generatedAt: new Date().toISOString(),
        timeZone: 'Asia/Kolkata (IST)',
        dateIST: todayIst,
        users: {
            dailyActiveUsers: dbStats.dailyActiveUsers,
            usersWithSuccessfulFill: dbStats.usersWithSuccessfulFill,
            returningUsers: dbStats.returningUsers, // active across >= 2 calendar weeks
            signupsPerDay: dbStats.signupsPerDay,
            blockedByFreeLimit: dbStats.usersBlockedByFreeLimit
        },
        forms: {
            totalSuccessfulFills: dbStats.fills.totalSuccessfulFills,
            avgFillsPerUser: dbStats.fills.avgFillsPerUser,
            fillsPerDay: dbStats.fills.fillsPerDay,
            categoryBreakdown: dbStats.formCategoryBreakdown,
            instantProfileFillsTotal: dbStats.instantFillTotals
        },
        revenue: {
            paidUsersCount: dbStats.paidUsers,
            totalPaise: dbStats.revenue.totalPaise,
            totalInr: dbStats.revenue.totalInr,
            refundCount: dbStats.refundCount,
            revenuePerDay: dbStats.revenue.revenuePerDay,
            revenueByPassType: dbStats.revenue.revenueByPassType
        },
        providers: {
            label: "since last server restart",
            activeProviders: routerStatus?.activeProviders || [],
            performance: formattedProviders
        }
    };
}

module.exports = {
    buildAdminStats
};
