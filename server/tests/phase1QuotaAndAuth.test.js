/**
 * @file server/tests/phase1QuotaAndAuth.test.js
 * @description Comprehensive automated tests for Phase 1:
 * - Google Sign-in & JWT session issuance
 * - Server-enforced monthly quota (10 free / 300 pro, IST calendar month)
 * - Quota reservation at /form/start & server auto-settlement on valid solve
 * - Skipping /complete handling
 * - Reusing session after expiry (> 30m)
 * - Exceeding question cap (60 questions per form session)
 * - Opening multiple concurrent sessions (reservation per session)
 * - Zero-solve session failure releases reservation
 * - DELETE /api/v1/auth/me cascade deletion
 * - Postgres integration test support via DATABASE_URL_TEST
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');
const db = require('../src/db');
const config = require('../src/config');
const { signUserToken, validateGoogleTokenPayload } = require('../src/services/auth');
const formSessionManager = require('../src/services/formSessionManager');

describe('Phase 1 — Google Auth, Quota Reservation & Anti-Cheating Suite', () => {
    let server;
    let baseUrl;

    before(async () => {
        // If DATABASE_URL_TEST is set, run migrations on test Postgres
        if (process.env.DATABASE_URL_TEST) {
            console.log('[Test] Running Phase 1 suite against real PostgreSQL (DATABASE_URL_TEST)');
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
        await db.closeDb();
        return new Promise((resolve) => {
            if (server) server.close(resolve);
            else resolve();
        });
    });

    beforeEach(async () => {
        await db.resetTestDb();
        formSessionManager.resetSessions();
    });

    describe('1. Google Authentication & Session Tokens', () => {
        it('authenticates with Google ID token, creates user, and returns signed JWT with quota', async () => {
            const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idToken: 'mock_google_token_sub12345_alexrivera'
                })
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.ok(data.token);
            assert.equal(data.user.email, 'alexrivera@example.com');
            assert.equal(data.quota.limit, 10);
            assert.equal(data.quota.remaining, 10);
            assert.equal(data.quota.plan, 'free');
        });

        it('rejects missing Google ID token with 400', async () => {
            const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            assert.equal(res.status, 400);
            const data = await res.json();
            assert.equal(data.success, false);
            assert.match(data.error, /Missing Google ID token/i);
        });

        it('returns authenticated user profile on GET /api/v1/auth/me', async () => {
            const user = await db.createUser({ googleSub: 'google-sub-789', email: 'me@example.com' });
            const token = signUserToken(user);

            const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.equal(data.user.id, user.id);
            assert.equal(data.user.email, 'me@example.com');
            assert.equal(data.quota.limit, 10);
        });

        it('strictly verifies Google ID token security: audience, issuer, expiry, and email_verified', () => {
            const validExp = Math.floor(Date.now() / 1000) + 3600;

            // 1. Valid payload succeeds
            const valid = validateGoogleTokenPayload({
                aud: 'expected-client-id.apps.googleusercontent.com',
                iss: 'accounts.google.com',
                exp: validExp,
                email_verified: true,
                sub: '1092834710',
                email: 'user@example.com',
                name: 'Verified User'
            }, 'expected-client-id.apps.googleusercontent.com');
            assert.equal(valid.email, 'user@example.com');

            // 2. Audience mismatch throws error
            assert.throws(() => {
                validateGoogleTokenPayload({
                    aud: 'wrong-client-id',
                    iss: 'accounts.google.com',
                    exp: validExp,
                    email_verified: true,
                    sub: '1092834710',
                    email: 'user@example.com'
                }, 'expected-client-id.apps.googleusercontent.com');
            }, /audience mismatch/i);

            // 3. Invalid issuer throws error
            assert.throws(() => {
                validateGoogleTokenPayload({
                    aud: 'expected-client-id.apps.googleusercontent.com',
                    iss: 'evil-issuer.com',
                    exp: validExp,
                    email_verified: true,
                    sub: '1092834710',
                    email: 'user@example.com'
                }, 'expected-client-id.apps.googleusercontent.com');
            }, /invalid google id token issuer/i);

            // 4. Expired token throws error
            assert.throws(() => {
                validateGoogleTokenPayload({
                    aud: 'expected-client-id.apps.googleusercontent.com',
                    iss: 'accounts.google.com',
                    exp: Math.floor(Date.now() / 1000) - 60, // expired 60 seconds ago
                    email_verified: true,
                    sub: '1092834710',
                    email: 'user@example.com'
                }, 'expected-client-id.apps.googleusercontent.com');
            }, /has expired/i);

            // 5. Unverified email throws error
            assert.throws(() => {
                validateGoogleTokenPayload({
                    aud: 'expected-client-id.apps.googleusercontent.com',
                    iss: 'accounts.google.com',
                    exp: validExp,
                    email_verified: false,
                    sub: '1092834710',
                    email: 'unverified@example.com'
                }, 'expected-client-id.apps.googleusercontent.com');
            }, /must be verified/i);
        });
    });

    describe('2. Monthly IST Quota & Reservation Logic', () => {
        it('calculates start of month and reset dates accurately according to IST offset (+5:30)', () => {
            const startOfISTMonth = db.getStartOfCurrentMonthIST();
            const resetDate = db.getNextMonthResetDateIST();

            assert.ok(startOfISTMonth instanceof Date);
            assert.ok(resetDate instanceof Date);
            assert.ok(resetDate.getTime() > startOfISTMonth.getTime());

            // IST offset check: UTC time of IST midnight is 18:30:00 of previous day
            const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
            assert.equal(resetDate.getUTCHours(), 18);
            assert.equal(resetDate.getUTCMinutes(), 30);
        });

        it('free users get 10 forms limit; Pro users get 300 forms fair-use cap', async () => {
            const freeUser = await db.createUser({ googleSub: 'free-user-sub', email: 'free@example.com' });
            const freeQuota = await formSessionManager.getUserQuotaStatus(freeUser.id);
            assert.equal(freeQuota.limit, 10);
            assert.equal(freeQuota.plan, 'free');

            const proUser = await db.createUser({ googleSub: 'pro-user-sub', email: 'pro@example.com' });
            await db.grantEntitlement({
                userId: proUser.id,
                plan: 'pro',
                durationDays: 30
            });
            const proQuota = await formSessionManager.getUserQuotaStatus(proUser.id);
            assert.equal(proQuota.limit, 300);
            assert.equal(proQuota.plan, 'pro');
            assert.equal(proQuota.isPro, true);
        });
    });

    describe('3. Form Session Management & Quota Anti-Cheating', () => {
        it('reserves a form slot immediately at /form/start before any solve', async () => {
            const user = await db.createUser({ googleSub: 'user-reserve-1', email: 'res1@example.com' });
            const token = signUserToken(user);

            const res = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formCategory: 'greenhouse' })
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.ok(data.sessionToken);
            assert.ok(data.sessionToken.startsWith('fses_'));
            assert.equal(data.quota.used, 1);
            assert.equal(data.quota.remaining, 9);
        });

        it('prevents quota cheating when client skips /complete (server marks success on valid solve)', async () => {
            const user = await db.createUser({ googleSub: 'user-skip-complete', email: 'skip@example.com' });
            const token = signUserToken(user);

            // 1. Start form session (reserves 1 slot)
            const sessionRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formCategory: 'lever' })
            });
            const sessionData = await sessionRes.json();
            const sessionToken = sessionData.sessionToken;

            // 2. Mark a successful solve inside this session (simulating AI answer generation)
            await formSessionManager.markSessionSuccess(sessionToken);

            // 3. Client never calls any complete endpoint. Check user's DB confirmed count.
            const confirmedCount = await db.getMonthlySuccessfulFormsCount(user.id);
            assert.equal(confirmedCount, 1, 'Form count must be confirmed on server after successful solve even without client /complete');
        });

        it('rejects solve attempt when session expires after 30 minutes', async () => {
            const user = await db.createUser({ googleSub: 'user-expiry-check', email: 'expiry@example.com' });
            const token = signUserToken(user);

            const session = await formSessionManager.startFormSession({
                userId: user.id,
                formCategory: 'generic'
            });

            // Fast-forward session expiration
            const active = formSessionManager.validateAndRecordSolve(session.sessionToken, user.id);
            active.expiresAt = Date.now() - 1000; // Expired 1 second ago

            // Next solve must fail
            assert.throws(() => {
                formSessionManager.validateAndRecordSolve(session.sessionToken, user.id);
            }, (err) => {
                return err.code === 'SESSION_EXPIRED' && err.statusCode === 410;
            });
        });

        it('enforces maximum 60 questions cap per form session', async () => {
            const user = await db.createUser({ googleSub: 'user-cap-check', email: 'cap@example.com' });
            const session = await formSessionManager.startFormSession({
                userId: user.id,
                formCategory: 'google_forms'
            });

            // Simulate 60 solves
            for (let i = 0; i < 60; i++) {
                formSessionManager.validateAndRecordSolve(session.sessionToken, user.id);
            }

            // 61st solve must trigger question cap error
            assert.throws(() => {
                formSessionManager.validateAndRecordSolve(session.sessionToken, user.id);
            }, (err) => {
                return err.code === 'SESSION_QUESTION_CAP_EXCEEDED' && err.statusCode === 429;
            });
        });

        it('prevents opening unlimited sessions (opening 10 sessions exhausts free quota and 11th is rejected)', async () => {
            const user = await db.createUser({ googleSub: 'user-multi-session', email: 'multi@example.com' });
            const token = signUserToken(user);

            // Open 10 sessions
            for (let i = 0; i < 10; i++) {
                const res = await fetch(`${baseUrl}/api/v1/form/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ formCategory: 'google_forms' })
                });
                assert.equal(res.status, 200);
            }

            // 11th session must be rejected with 403 QUOTA_EXCEEDED
            const res11 = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formCategory: 'google_forms' })
            });

            assert.equal(res11.status, 403);
            const data11 = await res11.json();
            assert.equal(data11.success, false);
            assert.equal(data11.code, 'QUOTA_EXCEEDED');
            assert.equal(data11.quota.remaining, 0);
        });

        it('prevents race conditions: 10 parallel /form/start calls at 9/10 quota only allows 1 to succeed', async () => {
            const user = await db.createUser({ googleSub: 'user-race-test', email: 'race@example.com' });
            const token = signUserToken(user);

            // Simulate 9 completed forms for this user
            for (let i = 0; i < 9; i++) {
                await db.createUsageEvent({ userId: user.id, formCategory: 'generic', success: true });
            }

            const initialQuota = await formSessionManager.getUserQuotaStatus(user.id);
            assert.equal(initialQuota.used, 9);
            assert.equal(initialQuota.remaining, 1);

            // Fire 10 parallel /form/start requests concurrently
            const parallelRequests = Array.from({ length: 10 }, () =>
                fetch(`${baseUrl}/api/v1/form/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ formCategory: 'job_application' })
                })
            );

            const responses = await Promise.all(parallelRequests);
            const statuses = responses.map(r => r.status);
            const successes = statuses.filter(s => s === 200);
            const quotaExceeded = statuses.filter(s => s === 403);

            assert.equal(successes.length, 1, 'Exactly one parallel request must succeed at 9/10 quota');
            assert.equal(quotaExceeded.length, 9, 'All other 9 parallel requests must be rejected with 403 QUOTA_EXCEEDED');

            const finalQuota = await formSessionManager.getUserQuotaStatus(user.id);
            assert.equal(finalQuota.used, 10, 'Total quota used must be exactly 10, never exceeded');
            assert.equal(finalQuota.remaining, 0);
        });

        it('releases reserved slot if form fill fails with zero successful solves', async () => {
            const user = await db.createUser({ googleSub: 'user-fail-release', email: 'fail@example.com' });
            const session = await formSessionManager.startFormSession({
                userId: user.id,
                formCategory: 'generic'
            });

            const quotaDuring = await formSessionManager.getUserQuotaStatus(user.id);
            assert.equal(quotaDuring.used, 1);
            assert.equal(quotaDuring.remaining, 9);

            // Release session (failed provider calls / abandoned form)
            await formSessionManager.releaseSessionIfFailed(session.sessionToken);

            const quotaAfter = await formSessionManager.getUserQuotaStatus(user.id);
            assert.equal(quotaAfter.used, 0);
            assert.equal(quotaAfter.remaining, 10, 'Quota must be restored when session ends with zero successful solves');
        });

        it('rejects session token used by a different user', async () => {
            const userA = await db.createUser({ googleSub: 'sub-user-a', email: 'a@example.com' });
            const userB = await db.createUser({ googleSub: 'sub-user-b', email: 'b@example.com' });

            const session = await formSessionManager.startFormSession({
                userId: userA.id,
                formCategory: 'generic'
            });

            assert.throws(() => {
                formSessionManager.validateAndRecordSolve(session.sessionToken, userB.id);
            }, (err) => {
                return err.code === 'INVALID_SESSION' && err.statusCode === 403;
            });
        });
    });

    describe('4. User Account & Data Deletion (DELETE /api/v1/auth/me)', () => {
        it('deletes user and all linked usage events, entitlements, and payments in cascade', async () => {
            const user = await db.createUser({ googleSub: 'delete-sub-999', email: 'delete-me@example.com' });
            const token = signUserToken(user);

            // Add entitlement, usage event, and payment
            await db.grantEntitlement({ userId: user.id, plan: 'pro', durationDays: 14 });
            await db.createUsageEvent({ userId: user.id, formCategory: 'google_forms', success: true });
            await db.recordPayment({ userId: user.id, orderId: 'order_123', paymentId: 'pay_DEL1234567890', amount: 9900 });

            // Call DELETE /api/v1/auth/me
            const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);

            // Confirm user and all linked records are gone
            const foundUser = await db.findUserById(user.id);
            assert.equal(foundUser, null);

            const ent = await db.getActiveEntitlement(user.id);
            assert.equal(ent, null);

            const count = await db.getMonthlySuccessfulFormsCount(user.id);
            assert.equal(count, 0);
        });

        it('session token cannot be used after DELETE /api/v1/auth/me', async () => {
            const user = await db.createUser({ googleSub: 'sub-token-inval', email: 'inval@example.com' });
            const token = signUserToken(user);

            // 1. Verify token works before deletion
            const meRes1 = await fetch(`${baseUrl}/api/v1/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            assert.equal(meRes1.status, 200);

            // 2. Delete user account
            const delRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            assert.equal(delRes.status, 200);

            // 3. Verify token is now rejected on protected endpoints
            const meRes2 = await fetch(`${baseUrl}/api/v1/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            assert.equal(meRes2.status, 401);
            const err2 = await meRes2.json();
            assert.equal(err2.code, 'USER_DELETED');

            const startRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formCategory: 'generic' })
            });
            assert.equal(startRes.status, 401);
            const errStart = await startRes.json();
            assert.equal(errStart.code, 'USER_DELETED');
        });
    });

    describe('5. Production Safety & In-Memory Restriction', () => {
        it('validateProductionConfig refuses startup in production if DATABASE_URL is missing', () => {
            const res = config.validateProductionConfig({
                NODE_ENV: 'production',
                DATABASE_URL: '',
                JWT_SECRET: 'a_very_long_custom_production_secret_key_1234567890',
                GOOGLE_CLIENT_ID: 'google-client-id-123.apps.googleusercontent.com'
            });
            assert.equal(res.valid, false);
            assert.match(res.message, /DATABASE_URL is required in production/i);
        });

        it('validateProductionConfig refuses startup if JWT_SECRET is default, placeholder, or < 32 chars', () => {
            const resPlaceholder = config.validateProductionConfig({
                NODE_ENV: 'production',
                DATABASE_URL: 'postgresql://prod_user:pwd@host:5432/proddb',
                JWT_SECRET: 'autoform_jwt_dev_secret_key_change_in_production_32char',
                GOOGLE_CLIENT_ID: 'google-client-id-123.apps.googleusercontent.com'
            });
            assert.equal(resPlaceholder.valid, false);
            assert.match(resPlaceholder.message, /placeholder/i);

            const resShort = config.validateProductionConfig({
                NODE_ENV: 'production',
                DATABASE_URL: 'postgresql://prod_user:pwd@host:5432/proddb',
                JWT_SECRET: 'short_key',
                GOOGLE_CLIENT_ID: 'google-client-id-123.apps.googleusercontent.com'
            });
            assert.equal(resShort.valid, false);
            assert.match(resShort.message, /at least 32 characters/i);
        });

        it('validateProductionConfig refuses startup if GOOGLE_CLIENT_ID is missing', () => {
            const res = config.validateProductionConfig({
                NODE_ENV: 'production',
                DATABASE_URL: 'postgresql://prod_user:pwd@host:5432/proddb',
                JWT_SECRET: 'a_very_long_custom_production_secret_key_1234567890',
                GOOGLE_CLIENT_ID: ''
            });
            assert.equal(res.valid, false);
            assert.match(res.message, /GOOGLE_CLIENT_ID is required/i);
        });

        it('validateProductionConfig accepts complete and secure production configuration', () => {
            const res = config.validateProductionConfig({
                NODE_ENV: 'production',
                DATABASE_URL: 'postgresql://prod_user:pwd@host:5432/proddb',
                JWT_SECRET: 'super_secure_production_jwt_secret_random_unique_991823',
                GOOGLE_CLIENT_ID: 'google-client-id-123.apps.googleusercontent.com',
                RAZORPAY_KEY_ID: 'rzp_live_key_production_12345',
                RAZORPAY_KEY_SECRET: 'rzp_live_secret_production_67890',
                RAZORPAY_WEBHOOK_SECRET: 'rzp_live_webhook_secret_production_abcde',
                ADMIN_STATS_TOKEN: 'prod_admin_stats_token_secure_xyz123'
            });
            assert.equal(res.valid, true);
            assert.equal(res.errors.length, 0);
        });
    });

    describe('6. Per-User Daily Solve Cap (Cost Guard)', () => {
        it('enforces daily solve cap and returns 429 DAILY_SOLVE_CAP_EXCEEDED when exceeded', async () => {
            const user = await db.createUser({ googleSub: 'sub-daily-cap', email: 'daily@example.com' });
            const token = signUserToken(user);

            // Start a form session
            const sessionRes = await fetch(`${baseUrl}/api/v1/form/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ formCategory: 'generic' })
            });
            const sessionData = await sessionRes.json();
            const sessionToken = sessionData.sessionToken;

            // Simulate user reaching free daily cap (default 200)
            const defaultFreeCap = config.dailySolveCapFree || 200;
            for (let i = 0; i < defaultFreeCap; i++) {
                await db.incrementDailySolveCount(user.id);
            }

            const currentCount = await db.getDailySolveCount(user.id);
            assert.equal(currentCount, defaultFreeCap);

            // Next solve attempt must be rejected with 429 DAILY_SOLVE_CAP_EXCEEDED
            const solveRes = await fetch(`${baseUrl}/api/v1/solve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Form-Session-Token': sessionToken
                },
                body: JSON.stringify({
                    question: 'What is your name?',
                    type: 'text'
                })
            });

            assert.equal(solveRes.status, 429);
            const solveData = await solveRes.json();
            assert.equal(solveData.code, 'DAILY_SOLVE_CAP_EXCEEDED');
            assert.match(solveData.error, /Daily solve limit reached/i);
        });
    });
});
