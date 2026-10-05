/**
 * @file server/src/services/paymentService.js
 * @description Razorpay order creation, signature verification,
 * shared idempotent entitlement granting, and webhook processing.
 */

const crypto = require('crypto');
const db = require('../db');

const PASS_PLANS = {
    pass_14d: {
        id: 'pass_14d',
        name: '14-Day Pro Pass',
        durationDays: 14,
        amountPaise: 9900, // ₹99
        currency: 'INR'
    },
    pass_30d: {
        id: 'pass_30d',
        name: '30-Day Pro Pass',
        durationDays: 30,
        amountPaise: 14900, // ₹149
        currency: 'INR'
    },
    pass_90d: {
        id: 'pass_90d',
        name: '90-Day Pro Pass',
        durationDays: 90,
        amountPaise: 34900, // ₹349
        currency: 'INR'
    }
};

/**
 * Creates an order in Razorpay (or mock in test mode) and records it in payments table.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.userEmail
 * @param {string} params.planId
 * @returns {Promise<Object>}
 */
async function createOrder({ userId, userEmail, planId }) {
    const plan = PASS_PLANS[planId];
    if (!plan) {
        const err = new Error(`Invalid plan ID: ${planId}. Supported plans are: ${Object.keys(PASS_PLANS).join(', ')}`);
        err.statusCode = 400;
        err.code = 'INVALID_PLAN';
        throw err;
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    let orderId;

    if (process.env.NODE_ENV === 'production') {
        if (!keyId || !keySecret || keyId.includes('placeholder') || keySecret.includes('placeholder')) {
            const err = new Error('Razorpay production keys are missing or invalid.');
            err.statusCode = 500;
            throw err;
        }
    }

    if (keyId && keySecret && !keyId.includes('test_placeholder')) {
        try {
            const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const res = await fetch('https://api.razorpay.com/v1/orders', {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: plan.amountPaise,
                    currency: plan.currency,
                    receipt: 'rcpt_' + crypto.randomUUID().slice(0, 14),
                    notes: {
                        userId,
                        planId: plan.id,
                        userEmail
                    }
                }),
                signal: AbortSignal.timeout(8000)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error?.description || `Razorpay order API error: ${res.statusText}`);
            }

            const data = await res.json();
            orderId = data.id;
        } catch (fetchErr) {
            if (process.env.NODE_ENV === 'production') {
                console.error('[PaymentService] Razorpay order creation failed in production:', fetchErr.message);
                const err = new Error(`Razorpay order creation failed: ${fetchErr.message}`);
                err.statusCode = 502;
                throw err;
            }
            console.warn('[PaymentService] Razorpay order API call failed, falling back to local test order:', fetchErr.message);
            orderId = 'order_test_' + crypto.randomBytes(12).toString('hex');
        }
    } else {
        if (process.env.NODE_ENV === 'production') {
            const err = new Error('Razorpay keys missing in production environment.');
            err.statusCode = 500;
            throw err;
        }
        // Deterministic test mode order (only permitted in test/development)
        orderId = 'order_test_' + crypto.randomBytes(12).toString('hex');
    }

    // Record order in our payments table
    await db.createPaymentOrder({
        userId,
        orderId,
        plan: plan.id,
        amount: plan.amountPaise,
        currency: plan.currency
    });

    return {
        orderId,
        amount: plan.amountPaise,
        currency: plan.currency,
        planId: plan.id,
        planName: plan.name,
        durationDays: plan.durationDays,
        keyId: keyId || 'rzp_test_placeholder',
        userEmail
    };
}

/**
 * Verifies a direct Razorpay payment ID (e.g. from Razorpay Payment Pages/Links rzp.io or direct payment ID entry).
 * Queries Razorpay API if credentials are provided, or validates ID structure and idempotently grants.
 * @param {Object} params
 * @param {string} [params.userId]
 * @param {string} params.paymentId
 * @returns {Promise<Object>}
 */
async function verifyDirectPaymentId({ userId, paymentId }) {
    if (!paymentId || typeof paymentId !== 'string' || !paymentId.trim().startsWith('pay_')) {
        const err = new Error('Invalid Razorpay payment ID format. Must start with "pay_".');
        err.statusCode = 400;
        err.code = 'INVALID_PAYMENT_ID';
        throw err;
    }

    const cleanPaymentId = paymentId.trim();
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    let durationDays = 30;
    let planId = 'pass_30d';
    let amount = 14900;
    let currency = 'INR';
    let status = 'captured';

    // If Razorpay API credentials are configured, verify live status with Razorpay
    if (keyId && keySecret && !keyId.includes('placeholder') && !keySecret.includes('placeholder')) {
        try {
            const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(cleanPaymentId)}`, {
                headers: { 'Authorization': authHeader },
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const err = new Error(errData.error?.description || 'Could not verify payment with Razorpay.');
                err.statusCode = 400;
                throw err;
            }
            const pData = await res.json();
            if (pData.status !== 'captured' && pData.status !== 'authorized') {
                const err = new Error(`Payment is not in captured status (current status: ${pData.status}).`);
                err.statusCode = 400;
                throw err;
            }
            amount = pData.amount || amount;
            currency = pData.currency || currency;
            status = pData.status === 'authorized' ? 'authorized' : 'captured';

            // Determine plan by amount
            if (amount <= 9900) {
                planId = 'pass_14d';
                durationDays = 14;
            } else if (amount >= 34900) {
                planId = 'pass_90d';
                durationDays = 90;
            } else {
                planId = 'pass_30d';
                durationDays = 30;
            }
        } catch (fetchErr) {
            if (process.env.NODE_ENV === 'production' && !fetchErr.statusCode) {
                console.error('[PaymentService] Razorpay payment fetch error in production:', fetchErr.message);
                const err = new Error(`Payment verification failed: ${fetchErr.message}`);
                err.statusCode = 502;
                throw err;
            }
            if (fetchErr.statusCode) throw fetchErr;
        }
    }

    // Check if user is authenticated; if so, grant entitlement in database
    let entitlement = null;
    let payment = null;
    let alreadyGranted = false;

    if (userId) {
        // Record payment in payments table
        payment = await db.recordPayment({
            userId,
            orderId: null,
            paymentId: cleanPaymentId,
            plan: planId,
            amount,
            status
        });

        // Grant entitlement
        const active = await db.getActiveEntitlement(userId);
        if (active && active.payment_id === cleanPaymentId) {
            alreadyGranted = true;
            entitlement = active;
        } else {
            entitlement = await db.grantEntitlement({
                userId,
                plan: 'pro',
                durationDays,
                paymentId: cleanPaymentId
            });
        }
    }

    return {
        success: true,
        alreadyGranted,
        plan: 'pro',
        planId,
        payment,
        entitlement
    };
}

/**
 * Verifies Razorpay checkout completion.
 * Derives plan, amount, and user ownership directly from our stored order in payments table.
 * If orderId is omitted, falls back to direct payment ID verification.
 * @param {Object} params
 * @param {string} [params.userId] Authenticated user ID
 * @param {string} [params.orderId] razorpay_order_id
 * @param {string} params.paymentId razorpay_payment_id
 * @param {string} [params.signature] razorpay_signature
 * @returns {Promise<Object>}
 */
async function verifyCheckout({ userId, orderId, paymentId, signature }) {
    if (!paymentId || typeof paymentId !== 'string') {
        const err = new Error('Missing required payment field: razorpay_payment_id is required.');
        err.statusCode = 400;
        err.code = 'MISSING_PAYMENT_FIELDS';
        throw err;
    }

    // Direct link / rzp.io checkout without pre-generated backend orderId
    if (!orderId) {
        return verifyDirectPaymentId({ userId, paymentId });
    }

    // 1. Look up the order in our payments table
    const storedOrder = await db.findPaymentByOrderId(orderId);
    if (!storedOrder) {
        const err = new Error('Unknown order ID. Order was not created by this system.');
        err.statusCode = 404;
        err.code = 'UNKNOWN_ORDER';
        throw err;
    }

    // 2. Require that the order belongs to the authenticated user if userId provided
    if (userId && storedOrder.user_id && storedOrder.user_id !== userId) {
        const err = new Error('Unauthorized: Order belongs to a different user account.');
        err.statusCode = 403;
        err.code = 'ORDER_USER_MISMATCH';
        throw err;
    }

    // 3. Derive plan and duration from the stored order (never client input)
    const plan = PASS_PLANS[storedOrder.plan];
    if (!plan) {
        const err = new Error('Invalid plan configuration on stored order.');
        err.statusCode = 400;
        err.code = 'INVALID_STORED_PLAN';
        throw err;
    }

    // 4. Verify Razorpay signature
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (process.env.NODE_ENV === 'production') {
        if (!keySecret || keySecret.includes('placeholder')) {
            const err = new Error('RAZORPAY_KEY_SECRET is required for checkout verification in production.');
            err.statusCode = 500;
            throw err;
        }
    }

    if (process.env.NODE_ENV === 'production' || (keySecret && !keySecret.includes('placeholder'))) {
        if (!signature || typeof signature !== 'string') {
            const err = new Error('Missing Razorpay payment signature.');
            err.statusCode = 400;
            err.code = 'MISSING_SIGNATURE';
            throw err;
        }

        const expectedSignature = crypto
            .createHmac('sha256', keySecret)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');

        const sigBuf = Buffer.from(signature, 'utf8');
        const expBuf = Buffer.from(expectedSignature, 'utf8');

        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            const err = new Error('Invalid payment signature verification failed.');
            err.statusCode = 400;
            err.code = 'INVALID_SIGNATURE';
            throw err;
        }
    }

    // 5. Shared idempotent grant inside DB transaction
    const grant = await db.executeIdempotentGrant({
        userId: userId || storedOrder.user_id,
        orderId,
        paymentId,
        durationDays: plan.durationDays
    });

    return {
        success: true,
        alreadyGranted: grant.alreadyGranted,
        plan: 'pro',
        planId: storedOrder.plan,
        payment: grant.payment,
        entitlement: grant.entitlement
    };
}

/**
 * Handles incoming Razorpay webhooks.
 * Validates HMAC-SHA256 signature in constant-time on exact raw buffer.
 * Listens to payment.captured only.
 * @param {Object} params
 * @param {Buffer} params.rawBody
 * @param {string} params.signatureHeader
 * @returns {Promise<Object>}
 */
async function handleWebhook({ rawBody, signatureHeader }) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        const err = new Error('RAZORPAY_WEBHOOK_SECRET is not configured on the server.');
        err.statusCode = 500;
        err.code = 'WEBHOOK_SECRET_NOT_CONFIGURED';
        throw err;
    }

    if (!signatureHeader || typeof signatureHeader !== 'string') {
        const err = new Error('Missing X-Razorpay-Signature header.');
        err.statusCode = 400;
        err.code = 'MISSING_WEBHOOK_SIGNATURE';
        throw err;
    }

    // Constant-time HMAC comparison on exact raw body buffer
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    const sigBuf = Buffer.from(signatureHeader, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        const err = new Error('Invalid webhook signature verification failed.');
        err.statusCode = 400;
        err.code = 'INVALID_WEBHOOK_SIGNATURE';
        throw err;
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload.event;

    // Listen to payment.captured only
    if (event === 'payment.captured') {
        const paymentEntity = payload.payload?.payment?.entity;
        if (!paymentEntity) {
            return { status: 'ignored', reason: 'Missing payment entity' };
        }

        const orderId = paymentEntity.order_id;
        const paymentId = paymentEntity.id;
        const paidAmount = paymentEntity.amount;
        const paidCurrency = paymentEntity.currency;

        if (!orderId || !paymentId) {
            return { status: 'ignored', reason: 'Missing order_id or payment_id' };
        }

        // Derive everything from our stored order in payments table
        const storedOrder = await db.findPaymentByOrderId(orderId);
        if (!storedOrder) {
            const err = new Error(`Unknown order ID ${orderId} received in webhook.`);
            err.statusCode = 404;
            err.code = 'UNKNOWN_ORDER';
            throw err;
        }

        // Verify that paid amount and currency match the plan from the stored order
        if (paidAmount !== storedOrder.amount || paidCurrency.toUpperCase() !== (storedOrder.currency || 'INR').toUpperCase()) {
            const err = new Error(`Paid amount or currency does not match stored order plan. Expected: ${storedOrder.amount} ${storedOrder.currency}, Got: ${paidAmount} ${paidCurrency}`);
            err.statusCode = 400;
            err.code = 'TAMPERED_AMOUNT';
            throw err;
        }

        const plan = PASS_PLANS[storedOrder.plan];
        if (!plan) {
            const err = new Error('Invalid plan configuration on stored order.');
            err.statusCode = 400;
            throw err;
        }

        // Execute shared idempotent grant inside DB transaction
        const grant = await db.executeIdempotentGrant({
            userId: storedOrder.user_id,
            orderId,
            paymentId,
            durationDays: plan.durationDays
        });

        return {
            status: 'ok',
            event,
            alreadyGranted: grant.alreadyGranted,
            entitlement: grant.entitlement
        };
    }

    // Handle refund events: payment.refunded / refund.processed
    if (event === 'payment.refunded' || event === 'refund.processed') {
        const paymentEntity = payload.payload?.payment?.entity || payload.payload?.refund?.entity;
        const paymentId = paymentEntity?.payment_id || paymentEntity?.id;
        if (paymentId) {
            const rev = await db.revokeEntitlementByPaymentId(paymentId);
            return { status: 'refunded', paymentId, revoked: rev.success };
        }
    }

    return { status: 'ignored', event };
}

/**
 * Admin revocation endpoint for refund management.
 * @param {Object} params
 * @param {string} params.paymentId
 * @param {string} params.adminToken
 */
async function revokeEntitlementAdmin({ paymentId, adminToken }) {
    const expectedToken = process.env.ADMIN_STATS_TOKEN;
    if (!expectedToken || !adminToken || typeof adminToken !== 'string') {
        const err = new Error('Unauthorized admin access.');
        err.statusCode = 401;
        throw err;
    }

    const provBuf = Buffer.from(adminToken, 'utf8');
    const expBuf = Buffer.from(expectedToken, 'utf8');
    if (provBuf.length !== expBuf.length || !crypto.timingSafeEqual(provBuf, expBuf)) {
        const err = new Error('Unauthorized admin access.');
        err.statusCode = 401;
        throw err;
    }

    if (!paymentId) {
        const err = new Error('Missing paymentId parameter.');
        err.statusCode = 400;
        throw err;
    }

    const rev = await db.revokeEntitlementByPaymentId(paymentId);
    return { success: true, paymentId, revoked: rev.success };
}

module.exports = {
    PASS_PLANS,
    createOrder,
    verifyCheckout,
    verifyDirectPaymentId,
    handleWebhook,
    revokeEntitlementAdmin
};
