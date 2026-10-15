/**
 * @file server/tests/solveAnalytics.test.js
 * @description Automated test suite for user agent parsing, non-sensitive solve analytics recording,
 * zero data leak enforcement, and administrative analytics endpoints.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { parseUserAgent } = require('../src/utils/userAgentParser');
const db = require('../src/db');
const app = require('../src/index');

describe('Solve Analytics & User-Agent Parsing Suite', () => {
    let server;
    let baseUrl;
    const TEST_ADMIN_TOKEN = 'test_admin_token_analytics_12345';

    before(async () => {
        process.env.ADMIN_STATS_TOKEN = TEST_ADMIN_TOKEN;
        db.resetInMemoryDb();

        return new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    beforeEach(async () => {
        db.resetInMemoryDb();
    });

    describe('1. Zero-Dependency User-Agent Parser', () => {
        it('should accurately detect Microsoft Edge on Windows', () => {
            const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
            const parsed = parseUserAgent(ua);
            assert.strictEqual(parsed.browser, 'Edge');
            assert.strictEqual(parsed.os, 'Windows');
            assert.strictEqual(parsed.device, 'desktop');
        });

        it('should accurately detect Google Chrome on macOS', () => {
            const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
            const parsed = parseUserAgent(ua);
            assert.strictEqual(parsed.browser, 'Chrome');
            assert.strictEqual(parsed.os, 'macOS');
            assert.strictEqual(parsed.device, 'desktop');
        });

        it('should accurately detect Mozilla Firefox on Linux', () => {
            const ua = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0';
            const parsed = parseUserAgent(ua);
            assert.strictEqual(parsed.browser, 'Firefox');
            assert.strictEqual(parsed.os, 'Linux');
            assert.strictEqual(parsed.device, 'desktop');
        });

        it('should detect Mobile Chrome on Android', () => {
            const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
            const parsed = parseUserAgent(ua);
            assert.strictEqual(parsed.browser, 'Chrome');
            assert.strictEqual(parsed.os, 'Android');
            assert.strictEqual(parsed.device, 'mobile');
        });

        it('should detect Safari on iPhone (iOS)', () => {
            const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
            const parsed = parseUserAgent(ua);
            assert.strictEqual(parsed.browser, 'Safari');
            assert.strictEqual(parsed.os, 'iOS');
            assert.strictEqual(parsed.device, 'mobile');
        });

        it('should fallback gracefully on empty or non-string inputs', () => {
            assert.deepStrictEqual(parseUserAgent(null), { browser: 'Unknown', os: 'Unknown', device: 'desktop' });
            assert.deepStrictEqual(parseUserAgent(''), { browser: 'Unknown', os: 'Unknown', device: 'desktop' });
            assert.deepStrictEqual(parseUserAgent(12345), { browser: 'Unknown', os: 'Unknown', device: 'desktop' });
        });
    });

    describe('2. In-Memory Solve Analytics Database Adapter', () => {
        it('should record non-sensitive solve analytics and compute aggregations', async () => {
            await db.recordSolveAnalytics({
                dayKey: '2026-10-15',
                userId: 'user_1',
                userType: 'registered',
                browser: 'Edge',
                os: 'Windows',
                device: 'desktop',
                questionType: 'text',
                provider: 'groq',
                latencyMs: 300,
                confidence: 'high',
                isPro: false
            });

            await db.recordSolveAnalytics({
                dayKey: '2026-10-15',
                userId: 'user_2',
                userType: 'registered',
                browser: 'Chrome',
                os: 'macOS',
                device: 'desktop',
                questionType: 'radio',
                provider: 'gemini',
                latencyMs: 500,
                confidence: 'high',
                isPro: true
            });

            await db.recordSolveAnalytics({
                dayKey: '2026-10-15',
                userId: null,
                userType: 'guest',
                browser: 'Firefox',
                os: 'Linux',
                device: 'desktop',
                questionType: 'text',
                provider: 'groq',
                latencyMs: 400,
                confidence: 'unsure',
                isPro: false
            });

            const summary = await db.getSolveAnalyticsSummary(14);
            assert.strictEqual(summary.totalSolves, 3);

            // Browsers
            assert.strictEqual(summary.byBrowser.length, 3);
            const edge = summary.byBrowser.find(b => b.browser === 'Edge');
            assert.ok(edge);
            assert.strictEqual(edge.count, 1);
            assert.strictEqual(edge.percentage, 33.3);

            // Providers & Latency
            const groq = summary.byProvider.find(p => p.provider === 'groq');
            assert.ok(groq);
            assert.strictEqual(groq.count, 2);
            assert.strictEqual(groq.avgLatencyMs, 350);
            assert.strictEqual(groq.minLatencyMs, 300);
            assert.strictEqual(groq.maxLatencyMs, 400);

            // Traffic Segmentation
            const registered = summary.byUserType.find(u => u.userType === 'registered');
            const guest = summary.byUserType.find(u => u.userType === 'guest');
            assert.strictEqual(registered.count, 2);
            assert.strictEqual(guest.count, 1);

            // Confidence
            const highConf = summary.byConfidence.find(c => c.confidence === 'high');
            assert.strictEqual(highConf.count, 2);
        });

        it('should strictly guarantee ZERO data leak: fields never include question text or answers', async () => {
            const recorded = await db.recordSolveAnalytics({
                dayKey: '2026-10-15',
                userId: 'user_leak_check',
                userType: 'registered',
                browser: 'Chrome',
                os: 'Windows',
                device: 'desktop',
                questionType: 'text',
                provider: 'groq',
                latencyMs: 250,
                confidence: 'high',
                isPro: false
            });

            // Assert that forbidden sensitive properties are undefined
            assert.strictEqual(recorded.question, undefined);
            assert.strictEqual(recorded.questionText, undefined);
            assert.strictEqual(recorded.answer, undefined);
            assert.strictEqual(recorded.answers, undefined);
            assert.strictEqual(recorded.formUrl, undefined);
            assert.strictEqual(recorded.choices, undefined);
            assert.strictEqual(recorded.customContext, undefined);
        });
    });

    describe('3. Admin Analytics HTTP Endpoints', () => {
        it('should reject GET /api/v1/admin/analytics with 401 when unauthenticated', async () => {
            const res = await fetch(`${baseUrl}/api/v1/admin/analytics`);
            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.success, false);
        });

        it('should return analytics report on GET /api/v1/admin/analytics with valid X-Admin-Token', async () => {
            const res = await fetch(`${baseUrl}/api/v1/admin/analytics?days=7`, {
                headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN }
            });
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.timeZone, 'Asia/Kolkata (IST)');
            assert.ok(Array.isArray(data.byBrowser));
            assert.ok(Array.isArray(data.byOs));
            assert.ok(Array.isArray(data.byDevice));
            assert.ok(Array.isArray(data.byUserType));
            assert.ok(Array.isArray(data.byProvider));
            assert.ok(Array.isArray(data.dailyTrend));
        });

        it('should accept Authorization: Bearer <token> on GET /admin/analytics', async () => {
            const res = await fetch(`${baseUrl}/admin/analytics`, {
                headers: { 'Authorization': `Bearer ${TEST_ADMIN_TOKEN}` }
            });
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
        });
    });
});
