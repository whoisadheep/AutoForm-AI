/**
 * @file server/tests/authService.test.js
 * @description Unit & integration tests for Auth & Paid Plan service, Freemium quota tracking,
 * and Smart Delight review trigger heuristics.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import authService from extension services
const authService = require(path.join(__dirname, '../../src/services/authService.js'));
const app = require('../src/index');
const db = require('../src/db');

describe('AuthService — Freemium Monthly Quota & Plan Management', () => {
    it('generates valid current month key in YYYY-MM-01 format', () => {
        const key = authService.getCurrentMonthKey();
        assert.match(key, /^\d{4}-\d{2}-01$/);
    });

    it('normalizes stats and resets monthly count if month has rolled over', () => {
        const oldStats = {
            questionsUsedThisMonth: 25,
            monthResetDate: '2025-01-01',
            formsCompletedCount: 5,
            questionsSolvedTotal: 40
        };

        const normalized = authService.normalizeUsageStats(oldStats);
        assert.equal(normalized.questionsUsedThisMonth, 0);
        assert.equal(normalized.monthResetDate, authService.getCurrentMonthKey());
        assert.equal(normalized.formsCompletedCount, 5);
        assert.equal(normalized.questionsSolvedTotal, 40);
    });

    it('preserves monthly usage count if within current month', () => {
        const currentMonth = authService.getCurrentMonthKey();
        const currentStats = {
            questionsUsedThisMonth: 12,
            monthResetDate: currentMonth,
            formsCompletedCount: 3,
            questionsSolvedTotal: 12
        };

        const normalized = authService.normalizeUsageStats(currentStats);
        assert.equal(normalized.questionsUsedThisMonth, 12);
        assert.equal(normalized.monthResetDate, currentMonth);
    });

    it('reports correct quota for Free Tier users (10 forms/month)', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 4,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const status = authService.getMonthlyQuotaStatus(user, stats);
        assert.equal(status.isPro, false);
        assert.equal(status.limit, 10);
        assert.equal(status.used, 4);
        assert.equal(status.remaining, 6);
        assert.equal(status.plan, 'free');
    });

    it('reports Unlimited quota for Pro Plan users', () => {
        const user = { plan: 'pro' };
        const stats = {
            questionsUsedThisMonth: 50,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const status = authService.getMonthlyQuotaStatus(user, stats);
        assert.equal(status.isPro, true);
        assert.equal(status.limit, Infinity);
        assert.equal(status.remaining, Infinity);
        assert.equal(status.plan, 'pro');
    });

    it('canSolveQuestion permits solving when free quota remains', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 9,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, true);
        assert.equal(result.remaining, 1);
        assert.equal(result.isPro, false);
    });

    it('canSolveQuestion blocks solving and returns upgrade reason when free quota is exhausted', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 10,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.isPro, false);
        assert.match(result.reason, /used all 10 free/i);
    });

    it('canSolveQuestion always permits solving for Pro users regardless of usage', () => {
        const user = { plan: 'pro' };
        const stats = {
            questionsUsedThisMonth: 500,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, true);
        assert.equal(result.remaining, Infinity);
        assert.equal(result.isPro, true);
    });
});

describe('AuthService — Smart Delight Review Trigger Heuristics', () => {
    it('does not show review prompt on fresh install with zero forms and few questions', () => {
        const stats = {
            formsCompletedCount: 1,
            questionsSolvedTotal: 7,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), false);
    });

    it('shows review prompt after the 2nd completed form', () => {
        const stats = {
            formsCompletedCount: 2,
            questionsSolvedTotal: 8,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), true);
    });

    it('shows review prompt after 15 or more lifetime questions solved', () => {
        const stats = {
            formsCompletedCount: 1,
            questionsSolvedTotal: 15,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), true);
    });

    it('does not show review prompt if user has already reviewed or dismissed', () => {
        const reviewedStats = {
            formsCompletedCount: 5,
            questionsSolvedTotal: 50,
            reviewPromptState: 'reviewed'
        };
        assert.equal(authService.shouldShowReviewPrompt(reviewedStats), false);

        const dismissedStats = {
            formsCompletedCount: 5,
            questionsSolvedTotal: 50,
            reviewPromptState: 'dismissed'
        };
        assert.equal(authService.shouldShowReviewPrompt(dismissedStats), false);
    });

    it('respects 3-day snooze duration before showing prompt again', () => {
        const now = 1700000000000;
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const fourDaysAgo = now - (4 * 24 * 60 * 60 * 1000);

        // Snoozed 1 day ago -> should NOT show
        const snoozedRecentStats = {
            formsCompletedCount: 3,
            questionsSolvedTotal: 25,
            reviewPromptState: 'snoozed',
            reviewDismissedAt: oneDayAgo
        };
        assert.equal(authService.shouldShowReviewPrompt(snoozedRecentStats, now), false);

        // Snoozed 4 days ago (> 3 days snooze period) -> should show again
        const snoozeExpiredStats = {
            formsCompletedCount: 3,
            questionsSolvedTotal: 25,
            reviewPromptState: 'snoozed',
            reviewDismissedAt: fourDaysAgo
        };
        assert.equal(authService.shouldShowReviewPrompt(snoozeExpiredStats, now), true);
    });
});

describe('Backend Server — Pro Tier Rate Limit & Quota Integration', () => {
    let server;
    let baseUrl;

    before(async () => {
        if (process.env.DATABASE_URL_TEST) {
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

    it('returns Unlimited quota on /api/v1/quota when X-User-Plan: pro header is sent', async () => {
        const res = await fetch(`${baseUrl}/api/v1/quota?clientId=test-pro-client-123`, {
            headers: {
                'X-Client-ID': 'test-pro-client-123',
                'X-User-Plan': 'pro'
            }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.isPro, true);
        assert.equal(data.limit, 'Unlimited');
        assert.equal(data.remaining, 'Unlimited');
    });

    it('reports standard rate limit quota for free / anonymous clients', async () => {
        const res = await fetch(`${baseUrl}/api/v1/quota?clientId=test-free-client-456`, {
            headers: {
                'X-Client-ID': 'test-free-client-456'
            }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.isPro, false);
        assert.equal(typeof data.limit, 'number');
        assert.equal(typeof data.remaining, 'number');
    });

    it('rejects invalid payment ID formats on /api/v1/verify-payment', async () => {
        const res = await fetch(`${baseUrl}/api/v1/verify-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId: 'invalid_123' })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.match(data.error, /must start with "pay_"/i);
    });

    it('verifies valid Razorpay payment ID and activates Pro on /api/v1/verify-payment', async () => {
        const res = await fetch(`${baseUrl}/api/v1/verify-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId: 'pay_ABC1234567890xyz' })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.plan, 'pro');
    });

    it('verifyAndActivateRazorpayPayment validates and upgrades user plan via /api/v1/payments/verify-checkout', async () => {
        const db = require('../src/db');
        const { signUserToken } = require('../src/services/auth');
        const crypto = require('crypto');

        const uniqueId = crypto.randomBytes(6).toString('hex');
        const user = await db.createUser({
            googleSub: `sub_auth_service_${uniqueId}`,
            email: `authservice_${uniqueId}@example.com`
        });
        const token = signUserToken(user);

        const order = await db.createPaymentOrder({
            userId: user.id,
            orderId: `order_auth_${uniqueId}`,
            plan: 'pass_30d',
            amount: 14900,
            currency: 'INR'
        });

        const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
        const secret = process.env.RAZORPAY_KEY_SECRET || 'test_key_secret_placeholder_not_for_prod';
        const signature = crypto
            .createHmac('sha256', secret)
            .update(`${order.razorpay_order_id}|${paymentId}`)
            .digest('hex');

        const result = await authService.verifyAndActivateRazorpayPayment(paymentId, {
            serverUrl: baseUrl,
            token,
            orderId: order.razorpay_order_id,
            signature
        });

        assert.equal(result.success, true);
        assert.equal(result.plan, 'pro');
    });
});

describe('Firefox Optional Data Consent & Permission Guarding', () => {
    let originalBrowser;
    let originalChrome;
    let originalFetch;

    before(() => {
        originalBrowser = global.browser;
        originalChrome = global.chrome;
        originalFetch = global.fetch;
    });

    after(() => {
        global.browser = originalBrowser;
        global.chrome = originalChrome;
        global.fetch = originalFetch;
    });

    it('requestOptionalDataConsent handles user denial and returns friendly cancellation message', async () => {
        global.browser = {
            permissions: {
                request: async ({ data_collection }) => {
                    assert.deepStrictEqual(data_collection, ['authenticationInfo']);
                    return false; // User clicked "Don't Allow" / denied
                }
            }
        };

        const result = await authService.requestOptionalDataConsent('authenticationInfo');
        assert.strictEqual(result.granted, false);
        assert.match(result.error, /Permission to access account & authentication info was declined/i);
    });

    it('treats exceptions thrown by browser.permissions.request as denied (never granted: true)', async () => {
        global.browser = {
            permissions: {
                request: async () => {
                    throw new Error('User dismissed or blocked permission prompt');
                }
            }
        };

        const result = await authService.requestOptionalDataConsent('authenticationInfo');
        assert.strictEqual(result.granted, false, 'Thrown error was erroneously treated as granted');
        assert.match(result.error, /prompt|declined|failed/i);
    });

    it('treats absence of browser.permissions API (Chromium) as granted', async () => {
        delete global.browser;
        const result = await authService.requestOptionalDataConsent('authenticationInfo');
        assert.strictEqual(result.granted, true);
    });

    it('signInWithGoogle aborts early without sending any network request when authenticationInfo consent is denied', async () => {
        let fetchCalled = false;
        global.fetch = async () => {
            fetchCalled = true;
            throw new Error('Network should never be reached when consent is denied!');
        };

        global.browser = {
            permissions: {
                request: async () => false // Denied by user
            }
        };

        const res = await authService.signInWithGoogle({
            serverUrl: 'https://autoform-ai.onrender.com',
            mockIdToken: 'test_token_123'
        });

        assert.strictEqual(res.success, false);
        assert.match(res.error, /declined/i);
        assert.match(res.error, /authentication/i);
        assert.strictEqual(fetchCalled, false, 'Fetch was executed despite permission denial!');
    });

    it('verifyAndActivateRazorpayPayment aborts early without sending any network request when financialAndPaymentInfo consent is denied', async () => {
        let fetchCalled = false;
        global.fetch = async () => {
            fetchCalled = true;
            throw new Error('Network should never be reached when payment consent is denied!');
        };

        global.browser = {
            permissions: {
                request: async ({ data_collection }) => {
                    assert.deepStrictEqual(data_collection, ['financialAndPaymentInfo']);
                    return false; // Denied by user
                }
            }
        };

        const res = await authService.verifyAndActivateRazorpayPayment('pay_1234567890abcdef', {
            serverUrl: 'https://autoform-ai.onrender.com'
        });

        assert.strictEqual(res.success, false);
        assert.match(res.error, /declined/i);
        assert.match(res.error, /payment/i);
        assert.strictEqual(fetchCalled, false, 'Payment verification fetch was executed despite permission denial!');
    });

    it('allows sign-in and payment to proceed smoothly when browser permissions are granted', async () => {
        global.browser = {
            permissions: {
                request: async () => true // User granted
            }
        };

        global.fetch = async () => ({
            ok: true,
            json: async () => ({
                success: true,
                token: 'granted_session_token_123',
                user: { plan: 'free' },
                quota: { limit: 10, remaining: 10, used: 0, plan: 'free' }
            })
        });

        const res = await authService.signInWithGoogle({
            serverUrl: 'https://autoform-ai.onrender.com',
            mockIdToken: 'valid_mock_token'
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.token, 'granted_session_token_123');
    });
});


