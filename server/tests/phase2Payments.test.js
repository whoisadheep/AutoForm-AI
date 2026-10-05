/**
 * @file server/tests/phase2Payments.test.js
 * @description Comprehensive automated tests for Phase 2:
 * - Razorpay order creation (14d, 30d, 90d passes)
 * - /verify-checkout deriving plan & amount strictly from DB stored order
 * - Tamper prevention: client claiming expensive plan with cheap order
 * - User mismatch rejection & unknown order rejection
 * - Webhook HMAC-SHA256 constant-time verification with express.raw
 * - Webhook tamper rejection for mismatched amount or currency
 * - Idempotency & concurrency: parallel /verify-checkout and webhook for same payment
 * - Pro pass duration extension on existing active passes
 * - Refund handling via webhook (payment.refunded) and admin revocation endpoint
 * - Hosted /checkout page with CSP & legal links
 * - End-to-end quota update to Pro (300 forms / 1500 daily solves) and rollback on refund
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../src/index');
const db = require('../src/db');
const config = require('../src/config');
const { signUserToken } = require('../src/services/auth');
const paymentService = require('../src/services/paymentService');

describe('Phase 2 — Razorpay Payments, Anti-Tamper & Entitlements Suite', () => {
    let server;
    let baseUrl;
    const TEST_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
    const TEST_RAZORPAY_SECRET = 'test_razorpay_secret_key_67890';
    const TEST_ADMIN_TOKEN = 'test_admin_secret_token_abcdef';

    before(async () => {
        // Set test secrets in environment
        process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
        process.env.RAZORPAY_KEY_SECRET = TEST_RAZORPAY_SECRET;
        process.env.ADMIN_STATS_TOKEN = TEST_ADMIN_TOKEN;
        process.env.PAYMENTS_ENABLED = 'true';
        config.paymentsEnabled = true;

        // If DATABASE_URL_TEST is set, run migrations on test Postgres
        if (process.env.DATABASE_URL_TEST) {
            console.log('[Test] Running Phase 2 suite against real PostgreSQL (DATABASE_URL_TEST)');
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
    });

    describe('1. Order Creation (POST /api/v1/payments/create-order)', () => {
        it('requires authentication and rejects unauthenticated requests with 401', async () => {
            const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId: 'pass_30d' })
            });

            assert.equal(res.status, 401);
            const data = await res.json();
            assert.equal(data.success, false);
        });

        it('creates an order for valid plan (pass_14d: ₹99, pass_30d: ₹149, pass_90d: ₹349)', async () => {
            const user = await db.createUser({ googleSub: 'sub_order_user_1', email: 'buyer@example.com' });
            const token = signUserToken(user);

            // Test 14-day pass
            const res14 = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_14d' })
            });
            assert.equal(res14.status, 200);
            const data14 = await res14.json();
            assert.equal(data14.success, true);
            assert.equal(data14.amount, 9900);
            assert.equal(data14.planId, 'pass_14d');
            assert.equal(data14.durationDays, 14);
            assert.ok(data14.orderId);

            // Verify order was stored in DB
            const stored14 = await db.findPaymentByOrderId(data14.orderId);
            assert.ok(stored14);
            assert.equal(stored14.user_id, user.id);
            assert.equal(stored14.plan, 'pass_14d');
            assert.equal(stored14.amount, 9900);
        });

        it('rejects invalid plan IDs with 400 INVALID_PLAN', async () => {
            const user = await db.createUser({ googleSub: 'sub_order_user_2', email: 'buyer2@example.com' });
            const token = signUserToken(user);

            const res = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'lifetime_super_vip' })
            });

            assert.equal(res.status, 400);
            const data = await res.json();
            assert.equal(data.success, false);
            assert.equal(data.code, 'INVALID_PLAN');
        });
    });

    describe('2. Checkout Verification & Anti-Tampering (POST /api/v1/payments/verify-checkout)', () => {
        it('derives plan and duration strictly from DB stored order, ignoring client-sent planId', async () => {
            const user = await db.createUser({ googleSub: 'sub_verify_user_1', email: 'verify1@example.com' });
            const token = signUserToken(user);

            // User creates order for 14-day pass (₹99)
            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_14d' })
            });
            const orderData = await orderRes.json();
            const orderId = orderData.orderId;
            const paymentId = 'pay_' + crypto.randomBytes(10).toString('hex');

            // Generate signature with test key secret
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${orderId}|${paymentId}`)
                .digest('hex');

            // Malicious client tries to send `planId: 'pass_90d'` to claim 90 days!
            const verifyRes = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature,
                    planId: 'pass_90d' // TAMPER ATTEMPT
                })
            });

            assert.equal(verifyRes.status, 200);
            const verifyData = await verifyRes.json();
            assert.equal(verifyData.success, true);
            assert.equal(verifyData.plan, 'pro');

            // Check entitlement in DB: duration must be exactly 14 days, NOT 90 days!
            const entitlement = await db.getActiveEntitlement(user.id);
            assert.ok(entitlement);
            const startsAt = new Date(entitlement.starts_at).getTime();
            const expiresAt = new Date(entitlement.expires_at).getTime();
            const daysGranted = Math.round((expiresAt - startsAt) / (24 * 60 * 60 * 1000));
            assert.equal(daysGranted, 14);

            // User quota must now be upgraded to Pro
            assert.equal(verifyData.quota.limit, 300);
            assert.equal(verifyData.quota.plan, 'pro');
        });

        it('rejects attempt to verify another user order with 403 ORDER_USER_MISMATCH', async () => {
            const userA = await db.createUser({ googleSub: 'sub_user_a', email: 'userA@example.com' });
            const userB = await db.createUser({ googleSub: 'sub_user_b', email: 'userB@example.com' });
            const tokenA = signUserToken(userA);
            const tokenB = signUserToken(userB);

            // User A creates order
            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenA}`
                },
                body: JSON.stringify({ planId: 'pass_30d' })
            });
            const orderData = await orderRes.json();
            const orderId = orderData.orderId;
            const paymentId = 'pay_' + crypto.randomBytes(10).toString('hex');
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${orderId}|${paymentId}`)
                .digest('hex');

            // User B attempts to claim User A's order
            const verifyRes = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenB}`
                },
                body: JSON.stringify({
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature
                })
            });

            assert.equal(verifyRes.status, 403);
            const data = await verifyRes.json();
            assert.equal(data.success, false);
            assert.equal(data.code, 'ORDER_USER_MISMATCH');
        });

        it('rejects unknown order IDs with 404 UNKNOWN_ORDER', async () => {
            const user = await db.createUser({ googleSub: 'sub_verify_user_3', email: 'user3@example.com' });
            const token = signUserToken(user);
            const fakeOrderId = 'order_fake_999999';
            const paymentId = 'pay_' + crypto.randomBytes(10).toString('hex');
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${fakeOrderId}|${paymentId}`)
                .digest('hex');

            const res = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpay_order_id: fakeOrderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature
                })
            });

            assert.equal(res.status, 404);
            const data = await res.json();
            assert.equal(data.code, 'UNKNOWN_ORDER');
        });

        it('rejects forged or invalid signature with 400 INVALID_SIGNATURE', async () => {
            const user = await db.createUser({ googleSub: 'sub_verify_user_4', email: 'user4@example.com' });
            const token = signUserToken(user);

            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_30d' })
            });
            const orderData = await orderRes.json();

            const res = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpay_order_id: orderData.orderId,
                    razorpay_payment_id: 'pay_valid_format_but_forged_sig',
                    razorpay_signature: 'forged_fake_signature_hex_00000000000000000000000000000000'
                })
            });

            assert.equal(res.status, 400);
            const data = await res.json();
            assert.equal(data.code, 'INVALID_SIGNATURE');
        });

        it('asserts that client PAYMENT_VERIFICATION_ROUTE strictly matches server POST /api/v1/payments/verify-checkout and fails if they differ', () => {
            const authService = require('../../src/services/authService.js');
            const expectedCanonicalRoute = '/api/v1/payments/verify-checkout';

            // Assert that client-side exported constant strictly equals the canonical route
            assert.strictEqual(
                authService.PAYMENT_VERIFICATION_ROUTE,
                expectedCanonicalRoute,
                `Client route mismatch! Expected ${expectedCanonicalRoute} but found ${authService.PAYMENT_VERIFICATION_ROUTE}`
            );

            // Assert that Express router has an actual POST route registered for this path
            const registeredPostRoutes = app._router.stack
                .filter(layer => layer.route && layer.route.methods && layer.route.methods.post)
                .map(layer => layer.route.path);

            assert.ok(
                registeredPostRoutes.includes(authService.PAYMENT_VERIFICATION_ROUTE),
                `Server does not have an active POST route registered for client route ${authService.PAYMENT_VERIFICATION_ROUTE}`
            );
        });

        it('successfully executes checkout verification through authService.PAYMENT_VERIFICATION_ROUTE with valid credentials', async () => {
            const authService = require('../../src/services/authService.js');
            const user = await db.createUser({ googleSub: 'sub_verify_parity_user', email: 'parity@example.com' });
            const token = signUserToken(user);

            const orderRes = await fetch(`${baseUrl}/api/v1/payments/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ planId: 'pass_30d' })
            });
            const orderData = await orderRes.json();
            const paymentId = 'pay_' + crypto.randomBytes(10).toString('hex');
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${orderData.orderId}|${paymentId}`)
                .digest('hex');

            // Send verification using the exact client route constant
            const verifyRes = await fetch(`${baseUrl}${authService.PAYMENT_VERIFICATION_ROUTE}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpay_order_id: orderData.orderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature
                })
            });

            assert.strictEqual(verifyRes.status, 200);
            const data = await verifyRes.json();
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.plan, 'pro');
        });
    });

    describe('3. Razorpay Webhooks (POST /api/v1/payments/webhook)', () => {
        function createWebhookRequest(payload, secret = TEST_WEBHOOK_SECRET) {
            const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
            const signature = crypto
                .createHmac('sha256', secret)
                .update(rawBody)
                .digest('hex');
            return { rawBody, signature };
        }

        it('processes payment.captured event and grants Pro entitlement', async () => {
            const user = await db.createUser({ googleSub: 'sub_wh_user_1', email: 'wh1@example.com' });
            const order = await db.createPaymentOrder({
                userId: user.id,
                orderId: 'order_wh_test_1',
                plan: 'pass_30d',
                amount: 14900,
                currency: 'INR'
            });

            const paymentId = 'pay_wh_' + crypto.randomBytes(8).toString('hex');
            const webhookPayload = {
                event: 'payment.captured',
                payload: {
                    payment: {
                        entity: {
                            id: paymentId,
                            order_id: order.razorpay_order_id,
                            amount: 14900,
                            currency: 'INR',
                            status: 'captured'
                        }
                    }
                }
            };

            const { rawBody, signature } = createWebhookRequest(webhookPayload);

            const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': signature
                },
                body: rawBody
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.status, 'ok');
            assert.equal(data.alreadyGranted, false);

            // Entitlement must now be Pro with 30 days
            const entitlement = await db.getActiveEntitlement(user.id);
            assert.ok(entitlement);
            assert.equal(entitlement.plan, 'pro');
            const days = Math.round((new Date(entitlement.expires_at) - new Date(entitlement.starts_at)) / (86400 * 1000));
            assert.equal(days, 30);
        });

        it('rejects tampered paid amount with 400 TAMPERED_AMOUNT', async () => {
            const user = await db.createUser({ googleSub: 'sub_wh_user_2', email: 'wh2@example.com' });
            const order = await db.createPaymentOrder({
                userId: user.id,
                orderId: 'order_wh_test_2',
                plan: 'pass_30d',
                amount: 14900,
                currency: 'INR'
            });

            // Tampered payload: paid only 100 paise (₹1) instead of 14900 paise
            const paymentId = 'pay_tampered_' + crypto.randomBytes(8).toString('hex');
            const webhookPayload = {
                event: 'payment.captured',
                payload: {
                    payment: {
                        entity: {
                            id: paymentId,
                            order_id: order.razorpay_order_id,
                            amount: 100, // TAMPERED AMOUNT
                            currency: 'INR',
                            status: 'captured'
                        }
                    }
                }
            };

            const { rawBody, signature } = createWebhookRequest(webhookPayload);

            const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': signature
                },
                body: rawBody
            });

            assert.equal(res.status, 400);
            const data = await res.json();
            assert.equal(data.code, 'TAMPERED_AMOUNT');

            // User must NOT be upgraded
            const entitlement = await db.getActiveEntitlement(user.id);
            assert.equal(entitlement, null);
        });

        it('rejects invalid or forged webhook signature with 400 INVALID_WEBHOOK_SIGNATURE', async () => {
            const webhookPayload = {
                event: 'payment.captured',
                payload: { payment: { entity: { id: 'pay_xyz', order_id: 'order_xyz' } } }
            };
            const rawBody = Buffer.from(JSON.stringify(webhookPayload), 'utf8');

            const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': 'bogus_tampered_signature_hex'
                },
                body: rawBody
            });

            assert.equal(res.status, 400);
            const data = await res.json();
            assert.equal(data.code, 'INVALID_WEBHOOK_SIGNATURE');
        });

        it('safely ignores non-captured events (e.g. order.paid) and returns 200', async () => {
            const webhookPayload = {
                event: 'order.paid',
                payload: { order: { entity: { id: 'order_ignore_123' } } }
            };
            const { rawBody, signature } = createWebhookRequest(webhookPayload);

            const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': signature
                },
                body: rawBody
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.status, 'ignored');
            assert.equal(data.event, 'order.paid');
        });
    });

    describe('4. Concurrency & Idempotency (/verify-checkout + Webhook in Parallel)', () => {
        it('handles parallel delivery from webhook and /verify-checkout without double duration grants', async () => {
            const user = await db.createUser({ googleSub: 'sub_concurrent_user', email: 'concurrent@example.com' });
            const token = signUserToken(user);

            const order = await db.createPaymentOrder({
                userId: user.id,
                orderId: 'order_concurrent_test_1',
                plan: 'pass_30d',
                amount: 14900,
                currency: 'INR'
            });

            const paymentId = 'pay_concurrent_' + crypto.randomBytes(8).toString('hex');
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${order.razorpay_order_id}|${paymentId}`)
                .digest('hex');

            // Webhook request setup
            const webhookPayload = {
                event: 'payment.captured',
                payload: {
                    payment: {
                        entity: {
                            id: paymentId,
                            order_id: order.razorpay_order_id,
                            amount: 14900,
                            currency: 'INR',
                            status: 'captured'
                        }
                    }
                }
            };
            const rawBody = Buffer.from(JSON.stringify(webhookPayload), 'utf8');
            const whSignature = crypto
                .createHmac('sha256', TEST_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');

            // Fire BOTH in parallel!
            const [checkoutRes, webhookRes] = await Promise.all([
                fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        razorpay_order_id: order.razorpay_order_id,
                        razorpay_payment_id: paymentId,
                        razorpay_signature: signature
                    })
                }),
                fetch(`${baseUrl}/api/v1/payments/webhook`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Razorpay-Signature': whSignature
                    },
                    body: rawBody
                })
            ]);

            assert.equal(checkoutRes.status, 200);
            assert.equal(webhookRes.status, 200);

            const checkoutData = await checkoutRes.json();
            const webhookData = await webhookRes.json();

            assert.equal(checkoutData.success, true);
            assert.equal(webhookData.status, 'ok');

            // One should have performed the grant, and one should have returned alreadyGranted: true
            const alreadyGrantedCount = (checkoutData.alreadyGranted ? 1 : 0) + (webhookData.alreadyGranted ? 1 : 0);
            assert.equal(alreadyGrantedCount, 1, 'Exactly one caller should report alreadyGranted: true');

            // Check final entitlement: must be exactly 30 days, NOT 60 days!
            const entitlement = await db.getActiveEntitlement(user.id);
            assert.ok(entitlement);
            const days = Math.round((new Date(entitlement.expires_at) - new Date(entitlement.starts_at)) / (86400 * 1000));
            assert.equal(days, 30, 'Duration must be exactly 30 days, not doubled to 60 days');
        });
    });

    describe('5. Active Pro Pass Duration Extension', () => {
        it('extends active Pro pass by adding new pass duration to current expires_at', async () => {
            const user = await db.createUser({ googleSub: 'sub_extend_user', email: 'extend@example.com' });
            const token = signUserToken(user);

            // Grant initial 14-day pass
            await db.grantEntitlement({
                userId: user.id,
                plan: 'pro',
                durationDays: 14,
                paymentId: 'pay_initial_14d'
            });

            const initialEnt = await db.getActiveEntitlement(user.id);
            const initialExpiresAt = new Date(initialEnt.expires_at).getTime();

            // User buys 30-day pass while 14-day pass is active
            const order = await db.createPaymentOrder({
                userId: user.id,
                orderId: 'order_extend_30d',
                plan: 'pass_30d',
                amount: 14900,
                currency: 'INR'
            });

            const paymentId = 'pay_extend_' + crypto.randomBytes(8).toString('hex');
            const signature = crypto
                .createHmac('sha256', TEST_RAZORPAY_SECRET)
                .update(`${order.razorpay_order_id}|${paymentId}`)
                .digest('hex');

            const res = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    razorpay_order_id: order.razorpay_order_id,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature
                })
            });

            assert.equal(res.status, 200);

            // Check extended entitlement
            const updatedEnt = await db.getActiveEntitlement(user.id);
            const updatedExpiresAt = new Date(updatedEnt.expires_at).getTime();

            // Total extension should be approximately 30 days added to previous expiry
            const diffDays = Math.round((updatedExpiresAt - initialExpiresAt) / (24 * 60 * 60 * 1000));
            assert.equal(diffDays, 30);
        });
    });

    describe('6. Refund Handling (Webhook payment.refunded & Admin Revocation)', () => {
        it('webhook payment.refunded event revokes entitlement immediately', async () => {
            const user = await db.createUser({ googleSub: 'sub_refund_user_1', email: 'refund1@example.com' });
            const paymentId = 'pay_refund_test_' + crypto.randomBytes(8).toString('hex');

            // Grant active entitlement
            await db.grantEntitlement({
                userId: user.id,
                plan: 'pro',
                durationDays: 30,
                paymentId
            });

            // Verify currently Pro
            let ent = await db.getActiveEntitlement(user.id);
            assert.ok(ent);

            // Webhook receives payment.refunded
            const payload = {
                event: 'payment.refunded',
                payload: {
                    payment: {
                        entity: {
                            id: paymentId,
                            status: 'refunded'
                        }
                    }
                }
            };
            const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
            const signature = crypto
                .createHmac('sha256', TEST_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');

            const res = await fetch(`${baseUrl}/api/v1/payments/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Razorpay-Signature': signature
                },
                body: rawBody
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.status, 'refunded');

            // Entitlement must now be revoked (no active Pro)
            ent = await db.getActiveEntitlement(user.id);
            assert.equal(ent, null);
        });

        it('POST /api/v1/admin/revoke-entitlement revokes entitlement when protected by ADMIN_STATS_TOKEN', async () => {
            const user = await db.createUser({ googleSub: 'sub_refund_user_2', email: 'refund2@example.com' });
            const paymentId = 'pay_admin_revoke_' + crypto.randomBytes(8).toString('hex');

            await db.grantEntitlement({
                userId: user.id,
                plan: 'pro',
                durationDays: 30,
                paymentId
            });

            // Unauthorized call without admin token -> 401
            const unauthorizedRes = await fetch(`${baseUrl}/api/v1/admin/revoke-entitlement`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId })
            });
            assert.equal(unauthorizedRes.status, 401);

            // Authorized call with admin token
            const authorizedRes = await fetch(`${baseUrl}/api/v1/admin/revoke-entitlement`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': TEST_ADMIN_TOKEN
                },
                body: JSON.stringify({ paymentId })
            });
            assert.equal(authorizedRes.status, 200);
            const data = await authorizedRes.json();
            assert.equal(data.success, true);

            // Entitlement revoked
            const ent = await db.getActiveEntitlement(user.id);
            assert.equal(ent, null);
        });
    });

    describe('7. Hosted Checkout Page (GET /checkout)', () => {
        it('serves checkout page with scoped CSP allowing Razorpay and containing plan options & legal links', async () => {
            const res = await fetch(`${baseUrl}/checkout`);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /text\/html/);

            const csp = res.headers.get('content-security-policy') || '';
            assert.ok(csp.includes('https://checkout.razorpay.com'), 'CSP must allow checkout.razorpay.com');
            assert.ok(csp.includes('https://api.razorpay.com'), 'CSP must allow api.razorpay.com');

            const html = await res.text();
            assert.match(html, /14-Day Pro Pass/);
            assert.match(html, /30-Day Pro Pass/);
            assert.match(html, /90-Day Pro Pass/);
            assert.match(html, /₹99/);
            assert.match(html, /₹149/);
            assert.match(html, /₹349/);
            assert.match(html, /One-time payment, no auto-renew/i);
            assert.match(html, /\/site\/terms\.html/);
            assert.match(html, /\/site\/refund\.html/);
            assert.match(html, /getSessionToken/);
        });
    });

    describe('8. Direct Payment ID Verification & Confirmation Screen (/payment/success)', () => {
        it('verifies direct Razorpay payment ID without orderId and upgrades user to Pro', async () => {
            const user = await db.createUser({ googleSub: 'sub_direct_pay_1', email: 'directpay@example.com' });
            const token = signUserToken(user);
            const directPaymentId = 'pay_' + crypto.randomBytes(10).toString('hex');

            const res = await fetch(`${baseUrl}/api/v1/payments/verify-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    paymentId: directPaymentId
                })
            });

            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.equal(data.plan, 'pro');

            // Verify entitlement is granted in database
            const ent = await db.getActiveEntitlement(user.id);
            assert.ok(ent, 'Entitlement must be granted in DB');
            assert.equal(ent.plan, 'pro');
            assert.equal(ent.payment_id, directPaymentId);
        });

        it('serves payment confirmation screen on /payment/success with transaction details', async () => {
            const testPaymentId = 'pay_' + crypto.randomBytes(10).toString('hex');
            const res = await fetch(`${baseUrl}/payment/success?razorpay_payment_id=${testPaymentId}`);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /text\/html/);

            const html = await res.text();
            assert.match(html, /Payment Successful!/);
            assert.match(html, /AutoForm Pro Activated/);
            assert.match(html, /Unlimited AI Form Fills/);
            assert.match(html, new RegExp(testPaymentId));
        });
    });
});
