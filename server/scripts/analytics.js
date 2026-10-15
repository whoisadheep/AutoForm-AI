#!/usr/bin/env node
/**
 * @file server/scripts/analytics.js
 * @description Comprehensive CLI analytics report for AutoForm AI.
 * Displays user breakdown, platform distribution (Browser / OS / Device),
 * AI engine latencies, and usage trends from the database.
 * 
 * Usage:
 *   node scripts/analytics.js [days]
 *   npm run analytics
 * 
 * Example:
 *   npm run analytics
 *   node scripts/analytics.js 30
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const db = require('../src/db');

function renderProgressBar(percentage, width = 20) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

async function run() {
    const days = parseInt(process.argv[2] || '14', 10);
    const dbUrl = process.env.DATABASE_URL;

    console.log(`\n================================================================`);
    console.log(`          AUTOFORM AI — USAGE & TELEMETRY ANALYTICS`);
    console.log(`================================================================`);
    console.log(`Time Zone    : Asia/Kolkata (IST)`);
    console.log(`Window       : Past ${days} days`);
    console.log(`Database     : ${dbUrl ? 'PostgreSQL (Render Oregon)' : 'In-Memory Adapter'}`);
    console.log(`Report Time  : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`);

    try {
        await db.initDb(dbUrl);

        // 1. High-Level User Base & Core Health
        const adminStats = await db.getAdminStats(db.getTodayDateKeyIST());
        const solveAnalytics = await db.getSolveAnalyticsSummary(days);

        console.log(`----------------------------------------------------------------`);
        console.log(` 1. OVERALL AUDIENCE & REVENUE OVERVIEW`);
        console.log(`----------------------------------------------------------------`);
        console.log(`  • Daily Active Users (Today) : ${adminStats.dailyActiveUsers}`);
        console.log(`  • Total Users with Successful Fill: ${adminStats.usersWithSuccessfulFill}`);
        console.log(`  • Returning Users (>= 2 weeks): ${adminStats.returningUsers}`);
        console.log(`  • Active Pro Subscriptions   : ${adminStats.paidUsers}`);
        console.log(`  • Total Fills Recorded       : ${adminStats.fills.totalSuccessfulFills} (Avg ${adminStats.fills.avgFillsPerUser} / user)`);
        console.log(`  • Instant Profile Fills      : ${adminStats.instantFillTotals}`);
        console.log(`  • Gross Revenue              : ₹${adminStats.revenue.totalInr} (${adminStats.paidUsers} paid accounts)\n`);

        // 2. Extension Client Platform Distribution
        console.log(`----------------------------------------------------------------`);
        console.log(` 2. BROWSER BREAKDOWN (Past ${days} Days)`);
        console.log(`----------------------------------------------------------------`);
        if (solveAnalytics.byBrowser.length === 0) {
            console.log(`  No browser solve analytics recorded yet in this window.`);
        } else {
            console.log(`  BROWSER        COUNT    SHARE    DISTRIBUTION`);
            console.log(`  -------------------------------------------------------------`);
            for (const b of solveAnalytics.byBrowser) {
                const name = b.browser.padEnd(14);
                const count = String(b.count).padStart(5);
                const pct = `${b.percentage}%`.padStart(7);
                const bar = renderProgressBar(b.percentage);
                console.log(`  ${name} ${count}  ${pct}  [${bar}]`);
            }
        }
        console.log('');

        // 3. Operating System & Device Breakdown
        console.log(`----------------------------------------------------------------`);
        console.log(` 3. OPERATING SYSTEM & DEVICE TYPE`);
        console.log(`----------------------------------------------------------------`);
        if (solveAnalytics.byOs.length === 0) {
            console.log(`  No OS analytics recorded yet.`);
        } else {
            for (const o of solveAnalytics.byOs) {
                const name = o.os.padEnd(14);
                const count = String(o.count).padStart(5);
                const pct = `${o.percentage}%`.padStart(7);
                console.log(`  OS     : ${name} ${count}  ${pct}  [${renderProgressBar(o.percentage, 15)}]`);
            }
        }
        console.log('');
        for (const d of solveAnalytics.byDevice) {
            const name = d.device.padEnd(14);
            const count = String(d.count).padStart(5);
            const pct = `${d.percentage}%`.padStart(7);
            console.log(`  DEVICE : ${name} ${count}  ${pct}  [${renderProgressBar(d.percentage, 15)}]`);
        }
        console.log('');

        // 4. User Types (Registered vs Guest vs Legacy)
        console.log(`----------------------------------------------------------------`);
        console.log(` 4. TRAFFIC SEGMENTATION`);
        console.log(`----------------------------------------------------------------`);
        for (const u of solveAnalytics.byUserType) {
            const typeLabel = (u.userType === 'registered' ? 'Registered Account' : (u.userType === 'guest' ? 'Anonymous Guest Trial' : 'Legacy IP Solve')).padEnd(24);
            const count = String(u.count).padStart(5);
            const pct = `${u.percentage}%`.padStart(7);
            console.log(`  • ${typeLabel}: ${count}  ${pct}  [${renderProgressBar(u.percentage, 15)}]`);
        }
        console.log('');

        // 5. AI Engine Latency & Performance
        console.log(`----------------------------------------------------------------`);
        console.log(` 5. AI ENGINE SPEED & VOLUME (Past ${days} Days)`);
        console.log(`----------------------------------------------------------------`);
        if (solveAnalytics.byProvider.length === 0) {
            console.log(`  No AI provider solves recorded yet.`);
        } else {
            console.log(`  PROVIDER     SOLVES   AVG LATENCY   MIN LATENCY   MAX LATENCY`);
            console.log(`  -------------------------------------------------------------`);
            for (const p of solveAnalytics.byProvider) {
                const prov = p.provider.padEnd(12);
                const count = String(p.count).padStart(6);
                const avg = p.avgLatencyMs ? `${p.avgLatencyMs}ms`.padStart(11) : '—'.padStart(11);
                const min = p.minLatencyMs ? `${p.minLatencyMs}ms`.padStart(11) : '—'.padStart(11);
                const max = p.maxLatencyMs ? `${p.maxLatencyMs}ms`.padStart(11) : '—'.padStart(11);
                console.log(`  ${prov} ${count}   ${avg}   ${min}   ${max}`);
            }
        }
        console.log('');

        // 6. Question Types & Confidence
        console.log(`----------------------------------------------------------------`);
        console.log(` 6. FORM QUESTION PATTERNS & CONFIDENCE`);
        console.log(`----------------------------------------------------------------`);
        const qTypes = solveAnalytics.byQuestionType.map(q => `${q.questionType}: ${q.count}`).join('  •  ');
        console.log(`  Question Types : ${qTypes || 'None'}`);
        const confLevels = solveAnalytics.byConfidence.map(c => `${c.confidence}: ${c.count}`).join('  •  ');
        console.log(`  Confidence     : ${confLevels || 'None'}\n`);

        // 7. Daily Activity Trend
        console.log(`----------------------------------------------------------------`);
        console.log(` 7. DAILY SOLVE TREND`);
        console.log(`----------------------------------------------------------------`);
        if (solveAnalytics.dailyTrend.length === 0) {
            console.log(`  No trend data available.`);
        } else {
            console.log(`  DATE (IST)    TOTAL   REGISTERED   GUEST   AVG SPEED`);
            console.log(`  ----------------------------------------------------`);
            for (const t of solveAnalytics.dailyTrend.slice(0, 14)) {
                const date = t.dayKey.padEnd(12);
                const tot = String(t.total).padStart(5);
                const reg = String(t.registered).padStart(10);
                const gst = String(t.guest).padStart(7);
                const speed = t.avgLatencyMs ? `${t.avgLatencyMs}ms`.padStart(9) : '—'.padStart(9);
                console.log(`  ${date} ${tot}   ${reg}   ${gst}   ${speed}`);
            }
        }

        console.log(`\n================================================================`);
        console.log(`  Zero Data Leak: Zero questions, answers, or URLs stored.`);
        console.log(`================================================================\n`);

    } catch (err) {
        console.error('Analytics Error:', err);
    } finally {
        await db.closeDb();
    }
}

run();
