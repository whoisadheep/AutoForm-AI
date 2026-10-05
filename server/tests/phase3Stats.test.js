/**
 * @file server/tests/phase3Stats.test.js
 * @description Comprehensive automated tests for Phase 3:
 * - Production safety for payments & admin tokens
 * - Backward compatibility: LEGACY_ANON_SOLVE mode and per-IP daily caps
 * - Admin authentication: header-only (X-Admin-Token or Bearer), constant-time, query token rejected
 * - /api/v1/usage/instant-fill-summary validation: auth required, integer 0..1000, 2-day IST range, upsert
 * - /admin/stats metrics: signups, limit_hit events, paid users, revenue per day/pass, refunds,
 *   returning users, fills per day/user, form categories, instant fills, and "since last server restart" label
 * - Zero Data Leak guarantee: asserts no form questions, answers, or URLs in DB or stats
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../src/index');
const db = require('../src/db');
const config = require('../src/config');
const { signUserToken } = require('../src/services/auth');
const paymentService = require('../src/services/paymentService');
const router = require('../src/services/router');

describe('Phase 3 — Simple Usage Stats, Production Hardening & Privacy Suite', () => {
    let server;
    let baseUrl;
    let originalRouterSolve;
    const TEST_ADMIN_TOKEN = 'test_admin_secret_token_phase3_xyz789';
    const TEST_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
    const TEST_RAZORPAY_SECRET = 'test_razorpay_secret_key_67890';

    before(async () => {
        process.env.ADMIN_STATS_TOKEN = TEST_ADMIN_TOKEN;
        process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
        process.env.RAZORPAY_KEY_SECRET = TEST_RAZORPAY_SECRET;

        // Stub router.solve for deterministic testing
        originalRouterSolve = router.solve.bind(router);
        router.solve = async ({ question, type, choices }) => {
            let answer = 'Mocked test answer';
            if (type === 'choice' && choices && choices.length > 0) {
                answer = choices[0];
            }
            return {
                answer,
                provider: 'groq',
                latencyMs: 35,
                confidence: 'high',
                reasoning: 'Mocked reasoning'
            };
        };

        if (process.env.DATABASE_URL_TEST) {
            console.log('[Test] Running Phase 3 suite against real PostgreSQL (DATABASE_URL_TEST)');
            await db.initDb(process.env.DATABASE_URL_TEST);
        } else {
            await db.initDb();
        }

        return new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (originalRouterSolve) {
            router.solve = originalRouterSolve;
        }
        await db.closeDb();
        return new Promise((resolve) => {
            if (server) server.close(resolve);
            else resolve();
        });
    });

    beforeEach(async () => {
        await db.resetTestDb();
        // Reset legacy flags to default
        config.legacyAnonSolve = false;
        config.legacyDailyIpCap = 150;
        config.paymentsEnabled = false;
        process.env.LEGACY_ANON_SOLVE = 'false';
        process.env.PAYMENTS_ENABLED = 'false';
    });

    // =========================================================================
    // SECTION A: PRODUCTION SAFETY FOR PAYMENTS & CONFIG
    // =========================================================================
    describe('Section A: Production Safety for Payments & Config', () => {
        it('should refuse validation if Razorpay keys or webhook secrets are missing or placeholders in production', () => {
            const badEnv = {
                NODE_ENV: 'production',
                DATABASE_URL: 'postgres://user:pass@localhost:5432/autoform',
                JWT_SECRET: 'a_very_secure_and_long_jwt_secret_key_string_32_chars!',
                GOOGLE_CLIENT_ID: 'google-client-id-12345.apps.googleusercontent.com',
                RAZORPAY_KEY_ID: 'rzp_test_placeholder',
                RAZORPAY_KEY_SECRET: '',
                RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_key_placeholder',
                ADMIN_STATS_TOKEN: 'admin_placeholder_token'
            };

            const result = config.validateProductionConfig(badEnv);
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('RAZORPAY_KEY_ID')));
            assert.ok(result.errors.some(e => e.includes('RAZORPAY_KEY_SECRET')));
            assert.ok(result.errors.some(e => e.includes('RAZORPAY_WEBHOOK_SECRET')));
            assert.ok(result.errors.some(e => e.includes('ADMIN_STATS_TOKEN')));
        });

        it('should pass production validation when all required production keys are valid and non-placeholder', () => {
            const goodEnv = {
                NODE_ENV: 'production',
                DATABASE_URL: 'postgres://prod_user:strong_password@aws-rds.internal:5432/autoform_prod',
                JWT_SECRET: 'super_secure_production_secret_key_with_at_least_32_chars_now!',
                GOOGLE_CLIENT_ID: 'google-client-id-prod-789.apps.googleusercontent.com',
                RAZORPAY_KEY_ID: 'rzp_live_999999999999',
                RAZORPAY_KEY_SECRET: 'live_secret_key_999999999999',
                RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_999999999999',
                ADMIN_STATS_TOKEN: 'prod_admin_secret_token_1234567890'
            };

            const result = config.validateProductionConfig(goodEnv);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        it('should refuse createOrder test fallback and throw 500 when NODE_ENV=production and keys are missing', async () => {
            const originalEnv = process.env.NODE_ENV;
            const originalKeyId = process.env.RAZORPAY_KEY_ID;
            const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;

            try {
                process.env.NODE_ENV = 'production';
                process.env.RAZORPAY_KEY_ID = '';
                process.env.RAZORPAY_KEY_SECRET = '';

                await assert.rejects(
                    async () => {
                        await paymentService.createOrder({
                            userId: 'user_prod_test_01',
                            userEmail: 'user_prod@example.com',
                            planId: 'pass_30d'
                        });
                    },
                    (err) => {
                        assert.strictEqual(err.statusCode, 500);
                        assert.ok(err.message.includes('Razorpay'));
                        return true;
                    }
                );
            } finally {
                process.env.NODE_ENV = originalEnv;
                process.env.RAZORPAY_KEY_ID = originalKeyId;
                process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
            }
        });
    });

    // =========================================================================
    // SECTION B: BACKWARD COMPATIBILITY (LEGACY_ANON_SOLVE & IP CAP)
    // =========================================================================
    describe('Section B: Backward Compatibility & Legacy Anon Solve', () => {
        it('should reject unauthenticated /solve requests with 401 AUTH_REQUIRED when LEGACY_ANON_SOLVE=false', async () => {
            config.legacyAnonSolve = false;
            process.env.LEGACY_ANON_SOLVE = 'false';

            const res = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: 'What is your graduation year?',
                    type: 'text'
                })
            });

            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.success, false);
            assert.strictEqual(data.code, 'AUTH_REQUIRED');
        });

        it('should allow unauthenticated /solve requests when LEGACY_ANON_SOLVE=true and track per-IP cap', async () => {
            config.legacyAnonSolve = true;
            config.legacyDailyIpCap = 2; // Strict cap of 2 for testing
            process.env.LEGACY_ANON_SOLVE = 'true';

            // 1st anonymous solve from IP
            const res1 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': '198.51.100.42'
                },
                body: JSON.stringify({
                    question: 'Select your preferred location',
                    type: 'choice',
                    choices: ['San Francisco', 'New York', 'Remote']
                })
            });

            assert.strictEqual(res1.status, 200);
            const data1 = await res1.json();
            assert.strictEqual(data1.success, true);
            assert.ok(data1.answer);

            // 2nd anonymous solve from same IP
            const res2 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': '198.51.100.42'
                },
                body: JSON.stringify({
                    question: 'Select your degree',
                    type: 'choice',
                    choices: ['B.S.', 'M.S.', 'Ph.D.']
                })
            });

            assert.strictEqual(res2.status, 200);
            const data2 = await res2.json();
            assert.strictEqual(data2.success, true);

            // 3rd anonymous solve from same IP exceeds cap of 2 -> 429 LEGACY_IP_CAP_EXCEEDED
            const res3 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': '198.51.100.42'
                },
                body: JSON.stringify({
                    question: 'What is your primary skill?',
                    type: 'text'
                })
            });

            assert.strictEqual(res3.status, 429);
            const data3 = await res3.json();
            assert.strictEqual(data3.success, false);
            assert.strictEqual(data3.code, 'LEGACY_IP_CAP_EXCEEDED');
            assert.strictEqual(data3.dailyLimit, 2);
            assert.strictEqual(data3.dailySolves, 2);

            // A different IP is not blocked
            const resOtherIp = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': '198.51.100.99'
                },
                body: JSON.stringify({
                    question: 'What is your primary skill?',
                    type: 'text'
                })
            });
            assert.strictEqual(resOtherIp.status, 200);
        });
    });

    // =========================================================================
    // SECTION C1: ADMIN AUTHENTICATION
    // =========================================================================
    describe('Section C1: Admin Authentication', () => {
        it('should reject GET /admin/stats with 401 when no auth header is provided', async () => {
            const res = await fetch(`${baseUrl}/admin/stats`);
            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.success, false);
        });

        it('should reject GET /admin/stats?token=... with 401 when passed in query string (header only requirement)', async () => {
            const res = await fetch(`${baseUrl}/admin/stats?token=${TEST_ADMIN_TOKEN}`);
            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.success, false);
            assert.ok(data.error.includes('headers'));
        });

        it('should reject GET /admin/stats with 401 when invalid token is provided in header', async () => {
            const res = await fetch(`${baseUrl}/admin/stats`, {
                headers: { 'X-Admin-Token': 'wrong_admin_token_abcdef' }
            });
            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.success, false);
            assert.ok(data.error.includes('Invalid'));
        });

        it('should accept GET /admin/stats with valid X-Admin-Token header', async () => {
            const res = await fetch(`${baseUrl}/admin/stats`, {
                headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN }
            });
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
        });

        it('should accept GET /api/v1/admin/stats with valid Authorization: Bearer <adminToken>', async () => {
            const res = await fetch(`${baseUrl}/api/v1/admin/stats`, {
                headers: { 'Authorization': `Bearer ${TEST_ADMIN_TOKEN}` }
            });
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
        });
    });

    // =========================================================================
    // SECTION C2: INSTANT FILL SUMMARY VALIDATION & UPSERT
    // =========================================================================
    describe('Section C2: Instant Fill Summary API & Storage', () => {
        let user;
        let token;

        beforeEach(async () => {
            user = await db.createUser({
                email: 'instant_summary_user@example.com',
                googleSub: 'google_sub_instant_001',
                name: 'Instant User'
            });
            token = signUserToken(user);
        });

        it('should reject unauthenticated instant-fill-summary submissions with 401', async () => {
            const todayIst = db.getTodayDateKeyIST();
            const res = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count: 5, date: todayIst })
            });

            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.code, 'AUTH_REQUIRED');
        });

        it('should reject invalid count values (<0, >1000, non-integer, string, null) with 400 INVALID_COUNT', async () => {
            const todayIst = db.getTodayDateKeyIST();
            const invalidCounts = [-1, 1001, 5.5, '5', null, undefined, NaN];

            for (const count of invalidCounts) {
                const res = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ count, date: todayIst })
                });

                assert.strictEqual(res.status, 400, `Expected 400 for count=${count}`);
                const data = await res.json();
                assert.strictEqual(data.code, 'INVALID_COUNT');
            }
        });

        it('should reject invalid date formats with 400 INVALID_DATE_FORMAT', async () => {
            const invalidDates = ['10/05/2026', '2026-5-1', 'invalid-date', ''];

            for (const date of invalidDates) {
                const res = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ count: 10, date })
                });

                assert.strictEqual(res.status, 400, `Expected 400 for date=${date}`);
                const data = await res.json();
                assert.strictEqual(data.code, 'INVALID_DATE_FORMAT');
            }
        });

        it('should reject dates older than 2 days in IST with 400 DATE_OUT_OF_RANGE', async () => {
            const oldDate = '2026-01-01';
            const res = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ count: 10, date: oldDate })
            });

            assert.strictEqual(res.status, 400);
            const data = await res.json();
            assert.strictEqual(data.code, 'DATE_OUT_OF_RANGE');
        });

        it('should accept valid count and date, upserting one row per (user_id, day_key)', async () => {
            const todayIst = db.getTodayDateKeyIST();

            // First submission: count = 7
            const res1 = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ count: 7, date: todayIst })
            });

            assert.strictEqual(res1.status, 200);
            const data1 = await res1.json();
            assert.strictEqual(data1.success, true);
            assert.strictEqual(data1.summary.count, 7);
            assert.strictEqual(data1.summary.dayKey, todayIst);
            assert.strictEqual(data1.summary.userId, user.id);

            // Second submission on same day: count = 15 (upsert should update, not insert duplicate)
            const res2 = await fetch(`${baseUrl}/api/v1/usage/instant-fill-summary`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ count: 15, date: todayIst })
            });

            assert.strictEqual(res2.status, 200);
            const data2 = await res2.json();
            assert.strictEqual(data2.success, true);
            assert.strictEqual(data2.summary.count, 15);

            // Verify via /admin/stats that total equals 15 (not 7 + 15 = 22)
            const statsRes = await fetch(`${baseUrl}/admin/stats`, {
                headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN }
            });
            const stats = await statsRes.json();
            assert.strictEqual(stats.forms.instantProfileFillsTotal, 15);
        });
    });

    // =========================================================================
    // SECTION C3 & C4: ADMIN STATS PAYLOAD & PROVIDER LABELING
    // =========================================================================
    describe('Section C3 & C4: Comprehensive Administrative Stats', () => {
        it('should compute and return all required business, retention, quota, and provider metrics', async () => {
            const todayIst = db.getTodayDateKeyIST();

            // 1. Create 3 users
            const user1 = await db.createUser({ email: 'user1_stats@example.com', googleSub: 'sub_stats_1', name: 'User 1' });
            const user2 = await db.createUser({ email: 'user2_stats@example.com', googleSub: 'sub_stats_2', name: 'User 2' });
            const user3 = await db.createUser({ email: 'user3_stats@example.com', googleSub: 'sub_stats_3', name: 'User 3' });

            // 2. Record form fills across categories
            // user1: 2 successful fills (google_forms, greenhouse)
            const ev1 = await db.createUsageEvent({ userId: user1.id, formTypeCategory: 'google_forms' });
            await db.markUsageEventSuccess(ev1.id);
            const ev2 = await db.createUsageEvent({ userId: user1.id, formTypeCategory: 'greenhouse' });
            await db.markUsageEventSuccess(ev2.id);

            // user2: 1 successful fill (lever)
            const ev3 = await db.createUsageEvent({ userId: user2.id, formTypeCategory: 'lever' });
            await db.markUsageEventSuccess(ev3.id);

            // 3. Record limit hit event for user3 (blocked by limit)
            await db.recordLimitHitEvent(user3.id, todayIst);

            // 4. Record payments (one captured pass_30d ₹149, one refunded pass_14d ₹99)
            await db.createPaymentOrder({
                userId: user1.id,
                orderId: 'order_stats_captured_01',
                plan: 'pass_30d',
                amount: 14900,
                currency: 'INR'
            });
            await db.recordPayment({
                userId: user1.id,
                orderId: 'order_stats_captured_01',
                paymentId: 'pay_stats_captured_01',
                amount: 14900,
                currency: 'INR',
                status: 'captured'
            });
            await db.grantEntitlement({
                userId: user1.id,
                plan: 'pro',
                paymentId: 'pay_stats_captured_01',
                durationDays: 30
            });

            await db.createPaymentOrder({
                userId: user2.id,
                orderId: 'order_stats_refunded_01',
                plan: 'pass_14d',
                amount: 9900,
                currency: 'INR'
            });
            await db.recordPayment({
                userId: user2.id,
                orderId: 'order_stats_refunded_01',
                paymentId: 'pay_stats_refunded_01',
                amount: 9900,
                currency: 'INR',
                status: 'refunded'
            });

            // 5. Record instant fill summary
            await db.recordInstantFillSummary({
                userId: user1.id,
                dayKey: todayIst,
                count: 12
            });

            // Fetch admin stats
            const res = await fetch(`${baseUrl}/admin/stats`, {
                headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN }
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();

            // Validate top-level keys
            assert.strictEqual(data.success, true);
            assert.ok(data.timeZone.includes('Asia/Kolkata'));
            assert.strictEqual(data.dateIST, todayIst);

            // Validate users metrics
            assert.strictEqual(data.users.usersWithSuccessfulFill, 2); // user1 and user2
            assert.strictEqual(data.users.blockedByFreeLimit.today, 1); // user3
            assert.strictEqual(data.users.blockedByFreeLimit.total, 1);
            assert.ok(Array.isArray(data.users.signupsPerDay));
            assert.ok(data.users.signupsPerDay.some(s => s.count >= 3));

            // Validate forms metrics
            assert.strictEqual(data.forms.totalSuccessfulFills, 3);
            assert.strictEqual(data.forms.avgFillsPerUser, 1.5); // 3 fills / 2 active users = 1.5
            assert.strictEqual(data.forms.instantProfileFillsTotal, 12);
            assert.ok(Array.isArray(data.forms.categoryBreakdown));
            const catNames = data.forms.categoryBreakdown.map(c => c.category);
            assert.ok(catNames.includes('google_forms'));
            assert.ok(catNames.includes('greenhouse'));
            assert.ok(catNames.includes('lever'));

            // Validate revenue metrics
            assert.strictEqual(data.revenue.paidUsersCount, 1); // user1 has active entitlement
            assert.strictEqual(data.revenue.totalPaise, 14900);
            assert.strictEqual(data.revenue.totalInr, 149.00);
            assert.strictEqual(data.revenue.refundCount, 1);
            assert.ok(Array.isArray(data.revenue.revenueByPassType));
            assert.ok(data.revenue.revenueByPassType.some(p => p.plan === 'pass_30d' && p.totalPaise === 14900));

            // Validate provider stats label (Requirement C4)
            assert.strictEqual(data.providers.label, 'since last server restart');
            assert.ok(data.providers.activeProviders);
            assert.ok(data.providers.performance);
        });
    });

    // =========================================================================
    // SECTION C6: ZERO DATA LEAK GUARANTEE
    // =========================================================================
    describe('Section C6: Zero Data Leak Verification', () => {
        it('should strictly guarantee that NO question text, answer text, or form URLs exist in the database or in /admin/stats', async () => {
            const user = await db.createUser({
                email: 'zeroleak_user@example.com',
                googleSub: 'zeroleak_sub_001',
                name: 'Zero Leak'
            });
            const token = signUserToken(user);

            const SECRET_QUESTION = 'SECRET_TEST_QUESTION_WHAT_IS_YOUR_FAVORITE_CRYPTOCURRENCY_12345';
            const SECRET_CHOICE_A = 'SECRET_CHOICE_BITCOIN_98765';
            const SECRET_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfSECRET_TEST_URL_TOKEN_XYZ/viewform';

            // Run a form session start & solve with the secret data
            const startRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    formTypeCategory: 'google_forms'
                    // Notice: no form URL is sent or accepted
                })
            });
            assert.strictEqual(startRes.status, 200);
            const { sessionToken } = await startRes.json();

            // Run solve with unique secret strings
            const solveRes = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Form-Session-Token': sessionToken
                },
                body: JSON.stringify({
                    question: SECRET_QUESTION,
                    type: 'choice',
                    choices: [SECRET_CHOICE_A, 'Ethereum', 'Solana']
                })
            });
            assert.strictEqual(solveRes.status, 200);
            const solveData = await solveRes.json();
            assert.ok(solveData.answer);
            const SECRET_ANSWER = solveData.answer;

            // 1. Fetch /admin/stats JSON payload
            const statsRes = await fetch(`${baseUrl}/admin/stats`, {
                headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN }
            });
            const statsText = await statsRes.text();

            // Assert secret strings NEVER appear in /admin/stats output
            assert.strictEqual(statsText.includes(SECRET_QUESTION), false, 'Question leaked in /admin/stats!');
            assert.strictEqual(statsText.includes(SECRET_CHOICE_A), false, 'Choice leaked in /admin/stats!');
            assert.strictEqual(statsText.includes(SECRET_URL), false, 'URL leaked in /admin/stats!');
            assert.strictEqual(statsText.includes(SECRET_ANSWER), false, 'Answer leaked in /admin/stats!');

            // 2. Query the entire database tables and verify zero secret string occurrences
            if (process.env.DATABASE_URL_TEST) {
                const { Pool } = require('pg');
                const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
                try {
                    const tables = [
                        'users',
                        'entitlements',
                        'payments',
                        'usage_events',
                        'daily_solve_counts',
                        'instant_fill_summaries',
                        'limit_hit_events',
                        'legacy_ip_solve_counts'
                    ];

                    for (const table of tables) {
                        const res = await pool.query(`SELECT * FROM ${table}`);
                        const tableDump = JSON.stringify(res.rows);

                        assert.strictEqual(tableDump.includes(SECRET_QUESTION), false, `Question leaked in DB table ${table}!`);
                        assert.strictEqual(tableDump.includes(SECRET_CHOICE_A), false, `Choice leaked in DB table ${table}!`);
                        assert.strictEqual(tableDump.includes(SECRET_URL), false, `URL leaked in DB table ${table}!`);
                        assert.strictEqual(tableDump.includes(SECRET_ANSWER), false, `Answer leaked in DB table ${table}!`);
                    }
                } finally {
                    await pool.end();
                }
            }
        });
    });

    // =========================================================================
    // SECTION C7: CLIENT IP RESOLUTION & SPOOFED HEADER PROTECTION
    // =========================================================================
    describe('Section C7: Client IP Resolution, Trust Proxy & Spoofed Header Protection', () => {
        it('should use Express req.ip (trust proxy 1 hop) and prevent bypassing legacy cap with spoofed X-Forwarded-For headers', async () => {
            config.legacyAnonSolve = true;
            config.legacyDailyIpCap = 2; // Cap of 2
            process.env.LEGACY_ANON_SOLVE = 'true';

            const realProxyClientIp = '198.51.100.77';

            // 1st request with spoofed leading IP
            const res1 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': `10.0.0.1, ${realProxyClientIp}`
                },
                body: JSON.stringify({ question: 'Question 1', type: 'text' })
            });
            assert.strictEqual(res1.status, 200);

            // 2nd request attempting to spoof different client IP in first position
            const res2 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': `10.0.0.2, ${realProxyClientIp}`
                },
                body: JSON.stringify({ question: 'Question 2', type: 'text' })
            });
            assert.strictEqual(res2.status, 200);

            // 3rd request attempting another spoofed first position IP -> Still recognized as realProxyClientIp -> 429
            const res3 = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Forwarded-For': `10.0.0.3, ${realProxyClientIp}`
                },
                body: JSON.stringify({ question: 'Question 3', type: 'text' })
            });
            assert.strictEqual(res3.status, 429);
            const data3 = await res3.json();
            assert.strictEqual(data3.code, 'LEGACY_IP_CAP_EXCEEDED');
            assert.strictEqual(data3.dailyLimit, 2);
        });
    });

    // =========================================================================
    // SECTION C8: IP HMAC HASHING & 7-DAY AUTO-CLEANUP
    // =========================================================================
    describe('Section C8: IP HMAC Hashing & 7-Day Auto-Cleanup', () => {
        it('should hash IP addresses with HMAC-SHA256 and never store raw IP in database', async () => {
            const rawIp = '203.0.113.195';
            const hashed = db.hashIp(rawIp);

            assert.strictEqual(typeof hashed, 'string');
            assert.strictEqual(hashed.length, 64); // SHA-256 hex string is 64 characters
            assert.notStrictEqual(hashed, rawIp);

            const todayIst = db.getTodayDateKeyIST();
            await db.incrementLegacyIpDailySolveCount(rawIp, todayIst);

            const count = await db.getLegacyIpDailySolveCount(rawIp, todayIst);
            assert.strictEqual(count, 1);

            // Verify raw IP is never present in stored table/memory
            if (db.isInMemory()) {
                const keys = Array.from(db.__getMemoryStore ? db.__getMemoryStore().legacy_ip_solve_counts.keys() : []);
                // If __getMemoryStore not exposed, check via hashIp key
                assert.ok(!keys.some(k => k.includes(rawIp)));
            } else if (process.env.DATABASE_URL_TEST) {
                const { Pool } = require('pg');
                const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
                try {
                    const res = await pool.query('SELECT ip FROM legacy_ip_solve_counts');
                    const storedIps = res.rows.map(r => r.ip);
                    assert.ok(!storedIps.includes(rawIp), 'Raw IP found in legacy_ip_solve_counts table!');
                    assert.ok(storedIps.includes(hashed), 'Hashed IP not found in legacy_ip_solve_counts table!');
                } finally {
                    await pool.end();
                }
            }
        });

        it('should automatically delete legacy IP abuse counter rows older than 7 days', async () => {
            const rawIp = '198.51.100.88';
            const todayIst = db.getTodayDateKeyIST();
            const oldDayKey = '2026-01-01'; // Far past date (> 7 days)

            // Increment for today
            await db.incrementLegacyIpDailySolveCount(rawIp, todayIst);

            // Increment directly for old date
            await db.incrementLegacyIpDailySolveCount(rawIp, oldDayKey);

            const countOldBefore = await db.getLegacyIpDailySolveCount(rawIp, oldDayKey);
            assert.strictEqual(countOldBefore, 1);

            // Run 7-day cleanup
            await db.cleanupOldLegacyIpCounts(7);

            // Verify old record was purged
            const countOldAfter = await db.getLegacyIpDailySolveCount(rawIp, oldDayKey);
            assert.strictEqual(countOldAfter, 0, 'Records older than 7 days should be purged');

            // Today's record should remain
            const countTodayAfter = await db.getLegacyIpDailySolveCount(rawIp, todayIst);
            assert.strictEqual(countTodayAfter, 1, 'Current records should be preserved');
        });
    });

    // =========================================================================
    // SECTION C9: PAYMENTS_ENABLED FLAG & MAINTENANCE ENFORCEMENT
    // =========================================================================
    describe('Section C9: PAYMENTS_ENABLED Flag & Maintenance Gating', () => {
        let user;
        let token;

        beforeEach(async () => {
            user = await db.createUser({
                email: 'payments_gate_user@example.com',
                googleSub: 'google_sub_gate_001',
                name: 'Payment Gate User'
            });
            token = signUserToken(user);
        });

        it('should return 503 PAYMENTS_DISABLED from /payments/create-order and render disabled state when PAYMENTS_ENABLED=false', async () => {
            config.paymentsEnabled = false;
            process.env.PAYMENTS_ENABLED = 'false';

            // 1. /api/v1/payments/create-order returns 503
            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_30d' })
            });
            assert.strictEqual(orderRes.status, 503);
            const orderData = await orderRes.json();
            assert.strictEqual(orderData.success, false);
            assert.strictEqual(orderData.code, 'PAYMENTS_DISABLED');

            // 2. /api/v1/config reports paymentsEnabled: false
            const configRes = await fetch(`${baseUrl}/api/v1/config`);
            assert.strictEqual(configRes.status, 200);
            const configData = await configRes.json();
            assert.strictEqual(configData.paymentsEnabled, false);

            // 3. /checkout page renders coming soon message and disabled button
            const checkoutRes = await fetch(`${baseUrl}/checkout`);
            assert.strictEqual(checkoutRes.status, 200);
            const checkoutHtml = await checkoutRes.text();
            assert.match(checkoutHtml, /Pro passes are coming soon/i);
            assert.match(checkoutHtml, /disabled/i);
        });

        it('should allow /payments/create-order and render active Razorpay button when PAYMENTS_ENABLED=true', async () => {
            config.paymentsEnabled = true;
            process.env.PAYMENTS_ENABLED = 'true';

            // 1. /api/v1/payments/create-order succeeds with 200
            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_30d' })
            });
            assert.strictEqual(orderRes.status, 200);
            const orderData = await orderRes.json();
            assert.strictEqual(orderData.success, true);
            assert.ok(orderData.orderId);

            // 2. /api/v1/config reports paymentsEnabled: true
            const configRes = await fetch(`${baseUrl}/api/v1/config`);
            assert.strictEqual(configRes.status, 200);
            const configData = await configRes.json();
            assert.strictEqual(configData.paymentsEnabled, true);

            // 3. /checkout page renders active Proceed to Pay with Razorpay button
            const checkoutRes = await fetch(`${baseUrl}/checkout`);
            assert.strictEqual(checkoutRes.status, 200);
            const checkoutHtml = await checkoutRes.text();
            assert.match(checkoutHtml, /Proceed to Pay with Razorpay/);
        });
    });

    // =========================================================================
    // SECTION C10: DATA SENSITIVITY ROUTING & 503 RETRYABLE ERROR
    // =========================================================================
    describe('Section C10: Data Sensitivity HTTP Integration & Retryable Error', () => {
        let user;
        let token;
        let sessionToken;

        beforeEach(async () => {
            user = await db.createUser({
                email: 'pii_test_user@example.com',
                googleSub: 'pii_sub_001',
                name: 'PII Test User'
            });
            token = signUserToken(user);

            const startRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formTypeCategory: 'google_forms' })
            });
            const startData = await startRes.json();
            sessionToken = startData.sessionToken;
        });

        it('should return HTTP 503 PII_PROVIDER_UNAVAILABLE with retryable: true when zero-retention routes fail on personal profile data', async () => {
            const originalSolve = router.solve;
            try {
                // Mock router.solve throwing PII_PROVIDER_UNAVAILABLE
                router.solve = async () => {
                    const err = new Error('All zero-retention AI providers failed for personal profile data. Request was not routed to secondary non-zero-retention providers.');
                    err.code = 'PII_PROVIDER_UNAVAILABLE';
                    err.statusCode = 503;
                    err.retryable = true;
                    throw err;
                };

                const res = await fetch(`${baseUrl}/api/v1/solve`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Form-Session-Token': sessionToken
                    },
                    body: JSON.stringify({
                        question: 'What is your current role?',
                        type: 'text',
                        customContext: 'Name: Alex Rivera, Role: Senior Engineer'
                    })
                });

                assert.strictEqual(res.status, 503);
                const data = await res.json();
                assert.strictEqual(data.success, false);
                assert.strictEqual(data.code, 'PII_PROVIDER_UNAVAILABLE');
                assert.strictEqual(data.retryable, true);
                assert.match(data.error, /zero-retention/i);
            } finally {
                router.solve = originalSolve;
            }
        });
    });

    // =========================================================================
    // SECTION C11: SERVER LOGGING ZERO-LEAKAGE VERIFICATION
    // =========================================================================
    describe('Section C11: Server Logging Zero-Leakage Verification', () => {
        it('should never print request bodies, questions, choices, customContext, or answers to server console logs', async () => {
            const user = await db.createUser({
                email: 'nolog_user@example.com',
                googleSub: 'nolog_sub_001',
                name: 'No Log User'
            });
            const token = signUserToken(user);

            const startRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formTypeCategory: 'google_forms' })
            });
            const { sessionToken } = await startRes.json();

            const SECRET_QUESTION = 'CONFIDENTIAL_TEST_QUESTION_SECRET_987654';
            const SECRET_CONTEXT = 'CONFIDENTIAL_RESUME_SNIPPET_USER_ALEX_DO_NOT_LOG_987654';
            const SECRET_CHOICE = 'CONFIDENTIAL_SECRET_CHOICE_A_987654';

            // Intercept console.log, console.warn, console.error
            const capturedLogs = [];
            const originalLog = console.log;
            const originalWarn = console.warn;
            const originalError = console.error;

            const capture = (...args) => {
                const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                capturedLogs.push(line);
            };

            console.log = capture;
            console.warn = capture;
            console.error = capture;

            try {
                const solveRes = await fetch(`${baseUrl}/api/v1/solve`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Form-Session-Token': sessionToken
                    },
                    body: JSON.stringify({
                        question: SECRET_QUESTION,
                        type: 'choice',
                        choices: [SECRET_CHOICE, 'Regular Option B'],
                        customContext: SECRET_CONTEXT
                    })
                });
                assert.strictEqual(solveRes.status, 200);
            } finally {
                console.log = originalLog;
                console.warn = originalWarn;
                console.error = originalError;
            }

            // Verify none of the captured logs contain the confidential content
            const allLogsJoined = capturedLogs.join('\n');
            assert.strictEqual(allLogsJoined.includes(SECRET_QUESTION), false, 'Question leaked in console logs!');
            assert.strictEqual(allLogsJoined.includes(SECRET_CONTEXT), false, 'customContext / PII leaked in console logs!');
            assert.strictEqual(allLogsJoined.includes(SECRET_CHOICE), false, 'Choice text leaked in console logs!');
        });
    });

    // =========================================================================
    // SECTION C12: DIAGNOSTIC DEBUG IP ROUTE
    // =========================================================================
    describe('Section C12: Diagnostic Debug IP Route', () => {
        it('should return 404 when debug endpoint is disabled and no admin token is supplied', async () => {
            delete process.env.DEBUG_IP_ENDPOINT;

            const res = await fetch(`${baseUrl}/api/v1/admin/debug-ip`);
            assert.strictEqual(res.status, 404);
            const data = await res.json();
            assert.strictEqual(data.success, false);

            const res2 = await fetch(`${baseUrl}/debug-ip`);
            assert.strictEqual(res2.status, 404);
        });

        it('should return 200 with resolved IP and proxy information when valid X-Admin-Token is provided', async () => {
            delete process.env.DEBUG_IP_ENDPOINT;

            const res = await fetch(`${baseUrl}/api/v1/admin/debug-ip`, {
                headers: {
                    'X-Admin-Token': TEST_ADMIN_TOKEN,
                    'X-Forwarded-For': '198.51.100.99'
                }
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
            assert.ok(data.resolvedIp);
            assert.ok(data.remoteAddress);
            assert.strictEqual(data.rawXForwardedFor, '198.51.100.99');
            assert.strictEqual(data.trustProxyHops, 1);
            assert.ok(data.nodeEnv);
        });

        it('should return 200 without admin token when DEBUG_IP_ENDPOINT=true is set in environment', async () => {
            process.env.DEBUG_IP_ENDPOINT = 'true';
            try {
                const res = await fetch(`${baseUrl}/debug-ip`);
                assert.strictEqual(res.status, 200);
                const data = await res.json();
                assert.strictEqual(data.success, true);
                assert.ok(data.resolvedIp);
            } finally {
                delete process.env.DEBUG_IP_ENDPOINT;
            }
        });
    });
});

