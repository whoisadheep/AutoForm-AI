/**
 * @file server/src/db/index.js
 * @description PostgreSQL database client with automatic schema initialization
 * and fallback in-memory adapter for fast unit testing and offline development.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

let pool = null;
let isInMemory = false;

// In-Memory store fallback (used when DATABASE_URL is unset)
const memoryStore = {
    users: new Map(), // id -> user
    usersBySub: new Map(), // google_sub -> user
    entitlements: new Map(), // id -> entitlement
    payments: new Map(), // razorpay_payment_id -> payment
    paymentsByOrder: new Map(), // razorpay_order_id -> payment
    usage_events: new Map(), // id -> event
    daily_solves: new Map(), // "userId:YYYY-MM-DD" -> count
    instant_fill_summaries: new Map(), // "userId:YYYY-MM-DD" -> { id, user_id, day_key, count, created_at, updated_at }
    limit_hit_events: new Map(), // "userId:YYYY-MM-DD" -> { id, user_id, day_key, created_at }
    legacy_ip_solve_counts: new Map(), // "ip:YYYY-MM-DD" -> count
    guest_trial_forms: new Map() // sessionId -> { ip_hash, status, created_at }
};

/**
 * Initializes the database connection and runs table migrations.
 * @param {string} [connectionString]
 */
async function initDb(connectionString) {
    const dbUrl = connectionString || process.env.DATABASE_URL;

    if (!dbUrl) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('[Database Error] DATABASE_URL is required in production. In-memory database adapter is not permitted in production.');
        }
        console.log('[Database] No DATABASE_URL provided. Operating with in-memory database adapter.');
        isInMemory = true;
        return;
    }

    try {
        pool = new Pool({
            connectionString: dbUrl,
            ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
                ? false
                : { rejectUnauthorized: false }
        });

        // Test connection
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    google_sub TEXT UNIQUE NOT NULL,
                    email TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS entitlements (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    plan TEXT NOT NULL,
                    starts_at TIMESTAMPTZ NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    payment_id TEXT
                );

                CREATE TABLE IF NOT EXISTS payments (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    razorpay_order_id TEXT UNIQUE,
                    razorpay_payment_id TEXT UNIQUE,
                    plan TEXT,
                    amount INTEGER,
                    currency VARCHAR(10) DEFAULT 'INR',
                    status TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan TEXT;
                ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
                CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(razorpay_order_id);

                CREATE TABLE IF NOT EXISTS usage_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    form_type_category TEXT,
                    success BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS daily_solve_counts (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    day_key VARCHAR(10) NOT NULL,
                    solve_count INT NOT NULL DEFAULT 0,
                    PRIMARY KEY(user_id, day_key)
                );

                CREATE TABLE IF NOT EXISTS instant_fill_summaries (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    day_key VARCHAR(10) NOT NULL,
                    count INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    CONSTRAINT uq_user_day_instant UNIQUE (user_id, day_key)
                );
                CREATE INDEX IF NOT EXISTS idx_instant_fill_day ON instant_fill_summaries(day_key);

                CREATE TABLE IF NOT EXISTS limit_hit_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    day_key VARCHAR(10) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    CONSTRAINT uq_user_day_limit_hit UNIQUE (user_id, day_key)
                );
                CREATE INDEX IF NOT EXISTS idx_limit_hit_day ON limit_hit_events(day_key);

                CREATE TABLE IF NOT EXISTS legacy_ip_solve_counts (
                    ip TEXT NOT NULL,
                    day_key VARCHAR(10) NOT NULL,
                    solve_count INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY(ip, day_key)
                );

                CREATE TABLE IF NOT EXISTS guest_trial_forms (
                    session_id TEXT PRIMARY KEY,
                    ip_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('reserved', 'used')),
                    solve_count INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                ALTER TABLE guest_trial_forms ADD COLUMN IF NOT EXISTS solve_count INT NOT NULL DEFAULT 0;
                CREATE INDEX IF NOT EXISTS idx_guest_trial_ip_created ON guest_trial_forms(ip_hash, created_at);

                CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
                CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_entitlements_user_expires ON entitlements(user_id, expires_at);
            `);
            console.log('[Database] PostgreSQL connection established and schema initialized.');
            isInMemory = false;
        } finally {
            client.release();
        }
    } catch (err) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(`[Database Error] PostgreSQL connection failed in production: ${err.message}`);
        }
        console.warn(`[Database] PostgreSQL connection failed (${err.message}). Falling back to in-memory adapter.`);
        isInMemory = true;
        pool = null;
    }
}

/**
 * Returns the Date representing 00:00:00 IST on the 1st of the current month.
 * IST is UTC+5:30.
 * @returns {Date}
 */
function getStartOfCurrentMonthIST() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowUtcMs = Date.now();
    const istDate = new Date(nowUtcMs + IST_OFFSET_MS);
    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    // 00:00:00.000 IST on 1st of this month converted back to UTC
    return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/**
 * Returns the Date representing 00:00:00 IST on the 1st of next month (rollover date).
 * @returns {Date}
 */
function getNextMonthResetDateIST() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowUtcMs = Date.now();
    const istDate = new Date(nowUtcMs + IST_OFFSET_MS);
    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - IST_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// User Operations
// ---------------------------------------------------------------------------

async function findUserByGoogleSub(googleSub) {
    if (isInMemory) {
        return memoryStore.usersBySub.get(googleSub) || null;
    }
    const res = await pool.query('SELECT * FROM users WHERE google_sub = $1 LIMIT 1', [googleSub]);
    return res.rows[0] || null;
}

async function findUserById(id) {
    if (isInMemory) {
        return memoryStore.users.get(id) || null;
    }
    const res = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
}

async function createUser({ googleSub, email }) {
    const id = crypto.randomUUID();
    const createdAt = new Date();

    if (isInMemory) {
        const user = { id, google_sub: googleSub, email, created_at: createdAt };
        memoryStore.users.set(id, user);
        memoryStore.usersBySub.set(googleSub, user);
        return user;
    }

    const res = await pool.query(
        'INSERT INTO users (id, google_sub, email, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
        [id, googleSub, email, createdAt]
    );
    return res.rows[0];
}

async function deleteUser(userId) {
    if (isInMemory) {
        const user = memoryStore.users.get(userId);
        if (user) {
            memoryStore.usersBySub.delete(user.google_sub);
            memoryStore.users.delete(userId);
            // Cascade delete entitlements, payments, usage_events
            for (const [id, e] of memoryStore.entitlements.entries()) {
                if (e.user_id === userId) memoryStore.entitlements.delete(id);
            }
            for (const [id, p] of memoryStore.payments.entries()) {
                if (p.user_id === userId) memoryStore.payments.delete(id);
            }
            for (const [id, u] of memoryStore.usage_events.entries()) {
                if (u.user_id === userId) memoryStore.usage_events.delete(id);
            }
        }
        return true;
    }

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return true;
}

// ---------------------------------------------------------------------------
// Entitlement Operations
// ---------------------------------------------------------------------------

async function getActiveEntitlement(userId) {
    const now = new Date();
    if (isInMemory) {
        for (const e of memoryStore.entitlements.values()) {
            if (e.user_id === userId && new Date(e.expires_at) > now) {
                return e;
            }
        }
        return null;
    }

    const res = await pool.query(
        'SELECT * FROM entitlements WHERE user_id = $1 AND expires_at > $2 ORDER BY expires_at DESC LIMIT 1',
        [userId, now]
    );
    return res.rows[0] || null;
}

async function grantEntitlement({ userId, plan, durationDays, paymentId }) {
    const active = await getActiveEntitlement(userId);
    const now = new Date();
    let startsAt = now;
    let expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // If already active, extend existing expiration date
    if (active && new Date(active.expires_at) > now) {
        startsAt = new Date(active.starts_at);
        expiresAt = new Date(new Date(active.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    const id = active ? active.id : crypto.randomUUID();

    if (isInMemory) {
        const entitlement = {
            id,
            user_id: userId,
            plan,
            starts_at: startsAt,
            expires_at: expiresAt,
            payment_id: paymentId || active?.payment_id || null
        };
        memoryStore.entitlements.set(id, entitlement);
        return entitlement;
    }

    if (active) {
        const res = await pool.query(
            'UPDATE entitlements SET expires_at = $1, payment_id = COALESCE($2, payment_id) WHERE id = $3 RETURNING *',
            [expiresAt, paymentId, id]
        );
        return res.rows[0];
    } else {
        const res = await pool.query(
            'INSERT INTO entitlements (id, user_id, plan, starts_at, expires_at, payment_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [id, userId, plan, startsAt, expiresAt, paymentId]
        );
        return res.rows[0];
    }
}

// ---------------------------------------------------------------------------
// Payment Operations
// ---------------------------------------------------------------------------

async function createPaymentOrder({ userId, orderId, plan, amount, currency = 'INR' }) {
    const id = crypto.randomUUID();
    const createdAt = new Date();

    if (isInMemory) {
        const payment = {
            id,
            user_id: userId,
            razorpay_order_id: orderId,
            razorpay_payment_id: null,
            plan,
            amount,
            currency,
            status: 'created',
            created_at: createdAt
        };
        memoryStore.paymentsByOrder.set(orderId, payment);
        return payment;
    }

    const res = await pool.query(
        'INSERT INTO payments (id, user_id, razorpay_order_id, plan, amount, currency, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [id, userId, orderId, plan, amount, currency, 'created', createdAt]
    );
    return res.rows[0];
}

async function findPaymentByOrderId(orderId) {
    if (isInMemory) {
        return memoryStore.paymentsByOrder.get(orderId) || null;
    }
    const res = await pool.query('SELECT * FROM payments WHERE razorpay_order_id = $1 LIMIT 1', [orderId]);
    return res.rows[0] || null;
}

async function findPaymentByRazorpayId(paymentId) {
    if (isInMemory) {
        return memoryStore.payments.get(paymentId) || null;
    }
    const res = await pool.query('SELECT * FROM payments WHERE razorpay_payment_id = $1 LIMIT 1', [paymentId]);
    return res.rows[0] || null;
}

/**
 * Shared Idempotent Grant Function
 * Ensures atomic transaction, locks against concurrent webhook and /verify-checkout calls,
 * and handles conflicts via the UNIQUE razorpay_payment_id constraint.
 */
async function executeIdempotentGrant({ userId, orderId, paymentId, durationDays }) {
    if (isInMemory) {
        return withUserLock(`pay_${paymentId}`, async () => {
            const existing = memoryStore.payments.get(paymentId);
            if (existing && (existing.status === 'captured' || existing.status === 'completed')) {
                const activeEnt = await getActiveEntitlement(userId);
                return { alreadyGranted: true, payment: existing, entitlement: activeEnt };
            }

            let payment = memoryStore.paymentsByOrder.get(orderId);
            if (payment) {
                payment.razorpay_payment_id = paymentId;
                payment.status = 'captured';
            } else {
                payment = {
                    id: crypto.randomUUID(),
                    user_id: userId,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    status: 'captured',
                    created_at: new Date()
                };
            }
            memoryStore.payments.set(paymentId, payment);

            // Grant or extend entitlement
            const now = new Date();
            const active = await getActiveEntitlement(userId);
            let startsAt = now;
            let expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

            let entitlementId;
            if (active && new Date(active.expires_at) > now) {
                startsAt = new Date(active.starts_at);
                expiresAt = new Date(new Date(active.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000);
                entitlementId = active.id;
            } else {
                entitlementId = crypto.randomUUID();
            }

            const entitlement = {
                id: entitlementId,
                user_id: userId,
                plan: 'pro',
                starts_at: startsAt,
                expires_at: expiresAt,
                payment_id: paymentId
            };
            memoryStore.entitlements.set(entitlementId, entitlement);

            return { alreadyGranted: false, payment, entitlement };
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Advisory transaction-level lock on paymentId to serialize concurrent webhook + checkout verify
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [paymentId]);

        // 1. Check if already processed
        const existingPayRes = await client.query(
            'SELECT * FROM payments WHERE razorpay_payment_id = $1 LIMIT 1',
            [paymentId]
        );
        if (existingPayRes.rows.length > 0 && (existingPayRes.rows[0].status === 'captured' || existingPayRes.rows[0].status === 'completed')) {
            const entRes = await client.query(
                'SELECT * FROM entitlements WHERE user_id = $1 AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1',
                [userId]
            );
            await client.query('COMMIT');
            return {
                alreadyGranted: true,
                payment: existingPayRes.rows[0],
                entitlement: entRes.rows[0] || null
            };
        }

        // 2. Update payment row with paymentId and status 'captured'
        const updatePayRes = await client.query(
            `UPDATE payments 
             SET razorpay_payment_id = $1, status = 'captured' 
             WHERE razorpay_order_id = $2 
             RETURNING *`,
            [paymentId, orderId]
        );
        const payment = updatePayRes.rows[0];

        // 3. Check active entitlement to extend
        const now = new Date();
        const entRes = await client.query(
            'SELECT * FROM entitlements WHERE user_id = $1 AND expires_at > $2 ORDER BY expires_at DESC LIMIT 1',
            [userId, now]
        );
        const active = entRes.rows[0] || null;

        let entitlement;
        if (active && new Date(active.expires_at) > now) {
            const newExpiresAt = new Date(new Date(active.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000);
            const upd = await client.query(
                'UPDATE entitlements SET expires_at = $1, payment_id = $2 WHERE id = $3 RETURNING *',
                [newExpiresAt, paymentId, active.id]
            );
            entitlement = upd.rows[0];
        } else {
            const newExpiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
            const ins = await client.query(
                'INSERT INTO entitlements (id, user_id, plan, starts_at, expires_at, payment_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [crypto.randomUUID(), userId, 'pro', now, newExpiresAt, paymentId]
            );
            entitlement = ins.rows[0];
        }

        await client.query('COMMIT');
        return { alreadyGranted: false, payment, entitlement };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Revokes an entitlement associated with a refunded payment.
 */
async function revokeEntitlementByPaymentId(paymentId) {
    if (isInMemory) {
        const payment = memoryStore.payments.get(paymentId);
        if (payment) payment.status = 'refunded';
        for (const ent of memoryStore.entitlements.values()) {
            if (ent.payment_id === paymentId) {
                ent.expires_at = new Date(Date.now() - 1000); // Expired immediately
            }
        }
        return { success: true };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE payments SET status = $1 WHERE razorpay_payment_id = $2', ['refunded', paymentId]);
        await client.query('UPDATE entitlements SET expires_at = NOW() WHERE payment_id = $1', [paymentId]);
        await client.query('COMMIT');
        return { success: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function recordPayment({ userId, orderId, paymentId, plan, amount, status = 'captured' }) {
    const id = crypto.randomUUID();
    const createdAt = new Date();

    if (isInMemory) {
        let payment = orderId ? memoryStore.paymentsByOrder.get(orderId) : null;
        if (payment) {
            payment.razorpay_payment_id = paymentId;
            payment.status = status;
            if (plan) payment.plan = plan;
            if (amount !== undefined) payment.amount = amount;
            memoryStore.payments.set(paymentId, payment);
            return payment;
        }

        payment = {
            id,
            user_id: userId,
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            plan: plan || 'unknown',
            amount,
            status,
            created_at: createdAt
        };
        memoryStore.payments.set(paymentId, payment);
        if (orderId) memoryStore.paymentsByOrder.set(orderId, payment);
        return payment;
    }

    if (orderId) {
        const checkOrder = await pool.query('SELECT * FROM payments WHERE razorpay_order_id = $1 LIMIT 1', [orderId]);
        if (checkOrder.rows.length > 0) {
            const updateRes = await pool.query(
                `UPDATE payments 
                 SET razorpay_payment_id = $1, status = $2, plan = COALESCE($3, plan), amount = COALESCE($4, amount) 
                 WHERE razorpay_order_id = $5 
                 RETURNING *`,
                [paymentId, status, plan || null, amount || null, orderId]
            );
            return updateRes.rows[0];
        }
    }

    const res = await pool.query(
        'INSERT INTO payments (id, user_id, razorpay_order_id, razorpay_payment_id, plan, amount, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [id, userId, orderId, paymentId, plan || 'unknown', amount, status, createdAt]
    );
    return res.rows[0];
}

// ---------------------------------------------------------------------------
// Usage Event & Form Quota Operations
// ---------------------------------------------------------------------------

async function createUsageEvent({ userId, formCategory, formTypeCategory, success = false }) {
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const resolvedCategory = formCategory || formTypeCategory || 'generic';

    if (isInMemory) {
        const event = {
            id,
            user_id: userId,
            form_type_category: resolvedCategory,
            success,
            created_at: createdAt
        };
        memoryStore.usage_events.set(id, event);
        return event;
    }

    const res = await pool.query(
        'INSERT INTO usage_events (id, user_id, form_type_category, success, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [id, userId, resolvedCategory, success, createdAt]
    );
    return res.rows[0];
}

async function markUsageEventSuccess(eventId) {
    if (isInMemory) {
        const event = memoryStore.usage_events.get(eventId);
        if (event) {
            event.success = true;
            return event;
        }
        return null;
    }

    const res = await pool.query(
        'UPDATE usage_events SET success = TRUE WHERE id = $1 RETURNING *',
        [eventId]
    );
    return res.rows[0] || null;
}

async function deleteUsageEvent(eventId) {
    if (isInMemory) {
        memoryStore.usage_events.delete(eventId);
        return true;
    }
    await pool.query('DELETE FROM usage_events WHERE id = $1', [eventId]);
    return true;
}

// In-memory user-level mutex queue to prevent race conditions during in-memory tests
const inMemoryUserLocks = new Map();
function withUserLock(userId, fn) {
    const prev = inMemoryUserLocks.get(userId) || Promise.resolve();
    let resolveNext;
    const next = new Promise(r => { resolveNext = r; });
    inMemoryUserLocks.set(userId, next);
    return prev.then(fn).finally(() => {
        if (inMemoryUserLocks.get(userId) === next) {
            inMemoryUserLocks.delete(userId);
        }
        resolveNext();
    });
}

/**
 * Atomically reserves a form usage slot within a database transaction and user advisory lock.
 * Prevents race conditions where parallel /form/start calls at 9/10 both succeed.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} [params.formCategory='generic']
 * @returns {Promise<{ allowed: boolean, eventId?: string, isPro: boolean, limit: number, used: number, remaining: number }>}
 */
async function reserveFormSessionSlot({ userId, formCategory = 'generic' }) {
    if (isInMemory) {
        return withUserLock(userId, async () => {
            const activeEnt = await getActiveEntitlement(userId);
            const isPro = !!activeEnt;
            const limit = isPro ? 300 : 10;
            const startOfMonth = getStartOfCurrentMonthIST();
            const now = Date.now();
            const reservationTtlMs = 30 * 60 * 1000;

            let usedCount = 0;
            for (const ev of memoryStore.usage_events.values()) {
                if (ev.user_id === userId && new Date(ev.created_at) >= startOfMonth) {
                    if (ev.success === true || (now - new Date(ev.created_at).getTime()) < reservationTtlMs) {
                        usedCount++;
                    }
                }
            }

            if (usedCount >= limit) {
                return {
                    allowed: false,
                    isPro,
                    limit,
                    used: usedCount,
                    remaining: 0
                };
            }

            const eventId = crypto.randomUUID();
            const createdAt = new Date();
            const event = {
                id: eventId,
                user_id: userId,
                form_type_category: formCategory || 'generic',
                success: false,
                created_at: createdAt
            };
            memoryStore.usage_events.set(eventId, event);

            return {
                allowed: true,
                eventId,
                isPro,
                limit,
                used: usedCount + 1,
                remaining: Math.max(0, limit - (usedCount + 1))
            };
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Advisory transaction-level lock per user ID hash to serialize concurrent reservations
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

        const now = new Date();
        const entRes = await client.query(
            'SELECT * FROM entitlements WHERE user_id = $1 AND expires_at > $2 ORDER BY expires_at DESC LIMIT 1',
            [userId, now]
        );
        const isPro = (entRes.rows.length > 0);
        const limit = isPro ? 300 : 10;

        const startOfMonth = getStartOfCurrentMonthIST();
        // Count confirmed successful fills AND active reservations in the last 30 minutes
        const countRes = await client.query(
            `SELECT COUNT(*)::int AS count 
             FROM usage_events 
             WHERE user_id = $1 
               AND created_at >= $2 
               AND (success = TRUE OR created_at >= (NOW() - INTERVAL '30 minutes'))`,
            [userId, startOfMonth]
        );
        const usedCount = countRes.rows[0]?.count || 0;

        if (usedCount >= limit) {
            await client.query('ROLLBACK');
            return {
                allowed: false,
                isPro,
                limit,
                used: usedCount,
                remaining: 0
            };
        }

        const eventId = crypto.randomUUID();
        const createdAt = new Date();
        await client.query(
            'INSERT INTO usage_events (id, user_id, form_type_category, success, created_at) VALUES ($1, $2, $3, $4, $5)',
            [eventId, userId, formCategory || 'generic', false, createdAt]
        );

        await client.query('COMMIT');
        return {
            allowed: true,
            eventId,
            isPro,
            limit,
            used: usedCount + 1,
            remaining: Math.max(0, limit - (usedCount + 1))
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Returns the IST day key formatted as 'YYYY-MM-DD'.
 * @returns {string}
 */
function getTodayDateKeyIST() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(Date.now() + IST_OFFSET_MS);
    return istDate.toISOString().slice(0, 10);
}

/**
 * Returns the number of AI solves performed by this user today in IST.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
async function getDailySolveCount(userId) {
    const dayKey = getTodayDateKeyIST();
    if (isInMemory) {
        const key = `${userId}:${dayKey}`;
        return memoryStore.daily_solves.get(key) || 0;
    }

    const res = await pool.query(
        'SELECT solve_count FROM daily_solve_counts WHERE user_id = $1 AND day_key = $2',
        [userId, dayKey]
    );
    return res.rows[0]?.solve_count || 0;
}

/**
 * Atomically increments and returns the daily solve counter for this user.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
async function incrementDailySolveCount(userId) {
    const dayKey = getTodayDateKeyIST();
    if (isInMemory) {
        const key = `${userId}:${dayKey}`;
        const current = (memoryStore.daily_solves.get(key) || 0) + 1;
        memoryStore.daily_solves.set(key, current);
        return current;
    }

    const res = await pool.query(
        `INSERT INTO daily_solve_counts (user_id, day_key, solve_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, day_key)
         DO UPDATE SET solve_count = daily_solve_counts.solve_count + 1
         RETURNING solve_count`,
        [userId, dayKey]
    );
    return res.rows[0]?.solve_count || 1;
}

/**
 * Returns the number of successful forms completed by this user in the current IST month.
 * @param {string} userId 
 * @returns {Promise<number>}
 */
async function getMonthlySuccessfulFormsCount(userId) {
    const startOfMonth = getStartOfCurrentMonthIST();

    if (isInMemory) {
        let count = 0;
        for (const ev of memoryStore.usage_events.values()) {
            if (ev.user_id === userId && ev.success === true && new Date(ev.created_at) >= startOfMonth) {
                count++;
            }
        }
        return count;
    }

    const res = await pool.query(
        'SELECT COUNT(*)::int AS count FROM usage_events WHERE user_id = $1 AND success = TRUE AND created_at >= $2',
        [userId, startOfMonth]
    );
    return res.rows[0]?.count || 0;
}

/**
 * Helper to compute ISO week key in IST (e.g. "2026-W40").
 */
function getIstWeekKey(date) {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns formatted IST date string YYYY-MM-DD for any Date.
 */
function getIstDateString(date = new Date()) {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    return istDate.toISOString().slice(0, 10);
}

/**
 * Records or upserts a daily summary of on-device instant profile fills.
 */
async function recordInstantFillSummary({ userId, dayKey, count }) {
    if (!userId) {
        throw new Error('userId is required for instant fill summary.');
    }
    const id = crypto.randomUUID();
    const now = new Date();

    if (isInMemory) {
        const key = `${userId}:${dayKey}`;
        const item = {
            id,
            user_id: userId,
            day_key: dayKey,
            count,
            created_at: now,
            updated_at: now
        };
        memoryStore.instant_fill_summaries.set(key, item);
        return item;
    }

    const res = await pool.query(
        `INSERT INTO instant_fill_summaries (id, user_id, day_key, count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, day_key)
         DO UPDATE SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [id, userId, dayKey, count, now, now]
    );
    return res.rows[0];
}

/**
 * Records a limit_hit event when a user is blocked by the free form limit at /form/start.
 */
async function recordLimitHitEvent(userId, dayKey) {
    if (!userId || !dayKey) return;
    const id = crypto.randomUUID();
    const now = new Date();

    if (isInMemory) {
        const key = `${userId}:${dayKey}`;
        if (!memoryStore.limit_hit_events.has(key)) {
            memoryStore.limit_hit_events.set(key, {
                id,
                user_id: userId,
                day_key: dayKey,
                created_at: now
            });
        }
        return;
    }

    await pool.query(
        `INSERT INTO limit_hit_events (id, user_id, day_key, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, day_key) DO NOTHING`,
        [id, userId, dayKey, now]
    );
}

/**
 * Hashes an IP address using HMAC-SHA256 with a server secret.
 * Guarantees zero raw IP addresses are ever stored in the database.
 * @param {string} ip
 * @returns {string} 64-character hex hash
 */
function hashIp(ip) {
    const secret = process.env.IP_HASH_SECRET || process.env.JWT_SECRET || 'autoform_server_secret_ip_hmac_salt';
    return crypto.createHmac('sha256', secret).update(String(ip || '127.0.0.1').trim()).digest('hex');
}

const GUEST_TRIAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GUEST_TRIAL_SESSION_TTL_MS = 30 * 60 * 1000;

async function reserveGuestTrialForm(ip, limit = 2) {
    const ipHash = hashIp(ip);
    const now = Date.now();
    const cutoff = new Date(now - GUEST_TRIAL_WINDOW_MS);
    const sessionId = `gfs_${crypto.randomBytes(32).toString('hex')}`;

    if (isInMemory) {
        return withUserLock(`guest:${ipHash}`, async () => {
            for (const [id, row] of memoryStore.guest_trial_forms) {
                const age = now - new Date(row.created_at).getTime();
                if (age >= GUEST_TRIAL_WINDOW_MS || (row.status === 'reserved' && age >= GUEST_TRIAL_SESSION_TTL_MS)) {
                    memoryStore.guest_trial_forms.delete(id);
                }
            }
            const rows = [...memoryStore.guest_trial_forms.values()].filter(row => row.ip_hash === ipHash);
            if (rows.length >= limit) return { allowed: false, remaining: 0 };
            memoryStore.guest_trial_forms.set(sessionId, { ip_hash: ipHash, status: 'reserved', solve_count: 0, created_at: new Date(now) });
            return { allowed: true, sessionId, remaining: Math.max(0, limit - rows.length - 1) };
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`guest:${ipHash}`]);
        await client.query('DELETE FROM guest_trial_forms WHERE created_at < $1 OR (status = \'reserved\' AND created_at < NOW() - INTERVAL \'30 minutes\')', [cutoff]);
        const countRes = await client.query(
            `SELECT COUNT(*)::int AS count FROM guest_trial_forms
             WHERE ip_hash = $1 AND created_at >= $2
               AND (status = 'used' OR created_at >= NOW() - INTERVAL '30 minutes')`,
            [ipHash, cutoff]
        );
        const count = countRes.rows[0]?.count || 0;
        if (count >= limit) {
            await client.query('COMMIT');
            return { allowed: false, remaining: 0 };
        }
        await client.query('INSERT INTO guest_trial_forms (session_id, ip_hash, status) VALUES ($1, $2, \'reserved\')', [sessionId, ipHash]);
        await client.query('COMMIT');
        return { allowed: true, sessionId, remaining: Math.max(0, limit - count - 1) };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function validateGuestTrialForm(sessionId, ip) {
    if (!sessionId || typeof sessionId !== 'string') return false;
    const ipHash = hashIp(ip);
    const cutoff = new Date(Date.now() - GUEST_TRIAL_WINDOW_MS);
    if (isInMemory) {
        const row = memoryStore.guest_trial_forms.get(sessionId);
        const age = row ? Date.now() - new Date(row.created_at).getTime() : Infinity;
        return Boolean(row && row.ip_hash === ipHash && age < GUEST_TRIAL_SESSION_TTL_MS && new Date(row.created_at) >= cutoff);
    }
    const result = await pool.query(
        `SELECT 1 FROM guest_trial_forms WHERE session_id = $1 AND ip_hash = $2
         AND created_at >= $3 AND created_at >= NOW() - INTERVAL '30 minutes' LIMIT 1`,
        [sessionId, ipHash, cutoff]
    );
    return result.rowCount > 0;
}

async function markGuestTrialFormUsed(sessionId, ip) {
    const ipHash = hashIp(ip);
    if (isInMemory) {
        const row = memoryStore.guest_trial_forms.get(sessionId);
        if (row && row.ip_hash === ipHash) row.status = 'used';
        return Boolean(row && row.ip_hash === ipHash);
    }
    const result = await pool.query(
        "UPDATE guest_trial_forms SET status = 'used' WHERE session_id = $1 AND ip_hash = $2 AND status = 'reserved' RETURNING session_id",
        [sessionId, ipHash]
    );
    return result.rowCount > 0;
}

async function releaseGuestTrialForm(sessionId, ip) {
    const ipHash = hashIp(ip);
    if (isInMemory) {
        const row = memoryStore.guest_trial_forms.get(sessionId);
        if (row && row.ip_hash === ipHash && row.status === 'reserved' && row.solve_count === 0) return memoryStore.guest_trial_forms.delete(sessionId);
        return false;
    }
    const result = await pool.query(
        "DELETE FROM guest_trial_forms WHERE session_id = $1 AND ip_hash = $2 AND status = 'reserved' AND solve_count = 0 RETURNING session_id",
        [sessionId, ipHash]
    );
    return result.rowCount > 0;
}

async function beginGuestTrialSolve(sessionId, ip) {
    const ipHash = hashIp(ip);
    if (isInMemory) {
        const row = memoryStore.guest_trial_forms.get(sessionId);
        const age = row ? Date.now() - new Date(row.created_at).getTime() : Infinity;
        if (!row || row.ip_hash !== ipHash || age >= GUEST_TRIAL_SESSION_TTL_MS || row.solve_count >= 60) return false;
        row.solve_count++;
        return true;
    }
    const result = await pool.query(
        `UPDATE guest_trial_forms SET solve_count = solve_count + 1
         WHERE session_id = $1 AND ip_hash = $2 AND created_at >= NOW() - INTERVAL '30 minutes'
           AND solve_count < 60 RETURNING session_id`,
        [sessionId, ipHash]
    );
    return result.rowCount > 0;
}

async function cleanupGuestTrialForms() {
    const cutoff = new Date(Date.now() - GUEST_TRIAL_WINDOW_MS);
    if (isInMemory) {
        for (const [id, row] of memoryStore.guest_trial_forms) {
            if (new Date(row.created_at) < cutoff) memoryStore.guest_trial_forms.delete(id);
        }
        return;
    }
    if (pool) await pool.query('DELETE FROM guest_trial_forms WHERE created_at < $1', [cutoff]);
}

/**
 * Automatically cleans up legacy IP counter records older than daysToKeep (default: 7 days).
 * @param {number} [daysToKeep=7]
 */
async function cleanupOldLegacyIpCounts(daysToKeep = 7) {
    const cutoffDate = new Date(Date.now() - (daysToKeep * 24 * 60 * 60 * 1000));
    const cutoffDayKey = getIstDateString(cutoffDate);

    if (isInMemory) {
        for (const [key] of memoryStore.legacy_ip_solve_counts.entries()) {
            const parts = key.split(':');
            const dayKey = parts[parts.length - 1];
            if (dayKey < cutoffDayKey) {
                memoryStore.legacy_ip_solve_counts.delete(key);
            }
        }
        return;
    }

    if (pool) {
        await pool.query(
            "DELETE FROM legacy_ip_solve_counts WHERE day_key < $1 OR created_at < NOW() - INTERVAL '7 days'",
            [cutoffDayKey]
        );
    }
}

/**
 * Gets legacy IP daily solve count using hashed IP.
 */
async function getLegacyIpDailySolveCount(ip, dayKey) {
    const ipHash = hashIp(ip);
    if (isInMemory) {
        const key = `${ipHash}:${dayKey}`;
        return memoryStore.legacy_ip_solve_counts.get(key) || 0;
    }
    const res = await pool.query(
        'SELECT solve_count FROM legacy_ip_solve_counts WHERE ip = $1 AND day_key = $2',
        [ipHash, dayKey]
    );
    return res.rows[0]?.solve_count || 0;
}

/**
 * Increments legacy IP daily solve count using hashed IP and cleans up records > 7 days old.
 */
async function incrementLegacyIpDailySolveCount(ip, dayKey) {
    const ipHash = hashIp(ip);

    // Trigger auto-cleanup of rows older than 7 days
    cleanupOldLegacyIpCounts(7).catch(() => {});

    if (isInMemory) {
        const key = `${ipHash}:${dayKey}`;
        const current = memoryStore.legacy_ip_solve_counts.get(key) || 0;
        memoryStore.legacy_ip_solve_counts.set(key, current + 1);
        return current + 1;
    }
    const res = await pool.query(
        `INSERT INTO legacy_ip_solve_counts (ip, day_key, solve_count, created_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (ip, day_key)
         DO UPDATE SET solve_count = legacy_ip_solve_counts.solve_count + 1
         RETURNING solve_count`,
        [ipHash, dayKey]
    );
    return res.rows[0]?.solve_count || 1;
}

/**
 * Aggregates complete analytics for /admin/stats.
 */
async function getAdminStats(todayIst = getTodayDateKeyIST()) {
    if (isInMemory) {
        const now = new Date();

        // 1. DAU: distinct users active today in usage_events
        const activeUsersToday = new Set();
        for (const e of memoryStore.usage_events.values()) {
            const eDate = getIstDateString(e.created_at);
            if (eDate === todayIst) {
                activeUsersToday.add(e.user_id);
            }
        }

        // 2. Signups per day
        const signupsByDate = {};
        for (const u of memoryStore.users.values()) {
            const d = getIstDateString(u.created_at);
            signupsByDate[d] = (signupsByDate[d] || 0) + 1;
        }
        const signupsPerDay = Object.entries(signupsByDate)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);

        // 3. Users with at least one successful fill
        const usersWithSuccess = new Set();
        let totalSuccessfulFills = 0;
        const fillsByDate = {};
        const fillsByCategory = {};
        const userWeeks = new Map(); // userId -> Set of weekKeys

        for (const e of memoryStore.usage_events.values()) {
            if (e.success) {
                usersWithSuccess.add(e.user_id);
                totalSuccessfulFills++;
                const d = getIstDateString(e.created_at);
                fillsByDate[d] = (fillsByDate[d] || 0) + 1;
                const cat = e.form_type_category || 'generic';
                fillsByCategory[cat] = (fillsByCategory[cat] || 0) + 1;

                const week = getIstWeekKey(e.created_at);
                if (!userWeeks.has(e.user_id)) userWeeks.set(e.user_id, new Set());
                userWeeks.get(e.user_id).add(week);
            }
        }

        // 4. Users blocked by free limit
        let todayBlockedUsers = 0;
        const totalBlockedUsersSet = new Set();
        for (const h of memoryStore.limit_hit_events.values()) {
            totalBlockedUsersSet.add(h.user_id);
            if (h.day_key === todayIst) todayBlockedUsers++;
        }

        // 5. Paid users (active entitlements)
        const paidUsersSet = new Set();
        for (const ent of memoryStore.entitlements.values()) {
            if (new Date(ent.expires_at) > now) {
                paidUsersSet.add(ent.user_id);
            }
        }

        // 6. Revenue from captured payments
        let totalRevenuePaise = 0;
        const revenueByDate = {};
        const revenueByPlan = {};
        let refundCount = 0;

        for (const p of memoryStore.payments.values()) {
            if (p.status === 'captured') {
                totalRevenuePaise += p.amount;
                const d = getIstDateString(p.created_at);
                if (!revenueByDate[d]) revenueByDate[d] = { total_paise: 0, count: 0 };
                revenueByDate[d].total_paise += p.amount;
                revenueByDate[d].count += 1;

                const plan = p.plan || 'unknown';
                if (!revenueByPlan[plan]) revenueByPlan[plan] = { total_paise: 0, count: 0 };
                revenueByPlan[plan].total_paise += p.amount;
                revenueByPlan[plan].count += 1;
            } else if (p.status === 'refunded') {
                refundCount++;
            }
        }

        const revenuePerDay = Object.entries(revenueByDate)
            .map(([date, val]) => ({
                date,
                totalPaise: val.total_paise,
                totalInr: +(val.total_paise / 100).toFixed(2),
                count: val.count
            }))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);

        const revenueByPassType = Object.entries(revenueByPlan).map(([plan, val]) => ({
            plan,
            totalPaise: val.total_paise,
            totalInr: +(val.total_paise / 100).toFixed(2),
            count: val.count
        }));

        // 7. Returning users (active in >= 2 distinct weeks)
        let returningUsers = 0;
        for (const weeks of userWeeks.values()) {
            if (weeks.size >= 2) returningUsers++;
        }

        // 8. Fills per day and per user
        const fillsPerDay = Object.entries(fillsByDate)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);

        const activeUsersCount = usersWithSuccess.size;
        const avgFillsPerUser = activeUsersCount > 0 ? +(totalSuccessfulFills / activeUsersCount).toFixed(2) : 0;

        // 9. Form category breakdown
        const formCategoryBreakdown = Object.entries(fillsByCategory).map(([category, count]) => ({
            category,
            count
        })).sort((a, b) => b.count - a.count);

        // 10. Instant fill totals
        let instantFillTotal = 0;
        for (const s of memoryStore.instant_fill_summaries.values()) {
            instantFillTotal += (s.count || 0);
        }

        return {
            dailyActiveUsers: activeUsersToday.size,
            signupsPerDay,
            usersWithSuccessfulFill: usersWithSuccess.size,
            usersBlockedByFreeLimit: {
                today: todayBlockedUsers,
                total: totalBlockedUsersSet.size
            },
            paidUsers: paidUsersSet.size,
            revenue: {
                totalPaise: totalRevenuePaise,
                totalInr: +(totalRevenuePaise / 100).toFixed(2),
                revenuePerDay,
                revenueByPassType
            },
            refundCount,
            returningUsers,
            fills: {
                totalSuccessfulFills,
                avgFillsPerUser,
                fillsPerDay
            },
            formCategoryBreakdown,
            instantFillTotals: instantFillTotal
        };
    }

    // Real PostgreSQL implementation
    const client = await pool.connect();
    try {
        // 1. DAU
        const dauRes = await client.query(
            `SELECT COUNT(DISTINCT user_id)::int AS count 
             FROM usage_events 
             WHERE to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $1`,
            [todayIst]
        );

        // 2. Signups per day
        const signupsRes = await client.query(
            `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date, 
                    COUNT(*)::int AS count
             FROM users
             GROUP BY date
             ORDER BY date DESC
             LIMIT 30`
        );

        // 3. Users with successful fill
        const successUsersRes = await client.query(
            'SELECT COUNT(DISTINCT user_id)::int AS count FROM usage_events WHERE success = true'
        );

        // 4. Users blocked by limit
        const limitHitTodayRes = await client.query(
            'SELECT COUNT(DISTINCT user_id)::int AS count FROM limit_hit_events WHERE day_key = $1',
            [todayIst]
        );
        const limitHitTotalRes = await client.query(
            'SELECT COUNT(DISTINCT user_id)::int AS count FROM limit_hit_events'
        );

        // 5. Paid users
        const paidUsersRes = await client.query(
            'SELECT COUNT(DISTINCT user_id)::int AS count FROM entitlements WHERE expires_at > NOW()'
        );

        // 6. Revenue
        const revTotalRes = await client.query(
            `SELECT COALESCE(SUM(amount), 0)::int AS total_paise,
                    ROUND(COALESCE(SUM(amount), 0)::numeric / 100, 2)::float AS total_inr
             FROM payments 
             WHERE status = 'captured'`
        );
        const revPerDayRes = await client.query(
            `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
                    COALESCE(SUM(amount), 0)::int AS "totalPaise",
                    ROUND(COALESCE(SUM(amount), 0)::numeric / 100, 2)::float AS "totalInr",
                    COUNT(*)::int AS count
             FROM payments
             WHERE status = 'captured'
             GROUP BY date
             ORDER BY date DESC
             LIMIT 30`
        );
        const revByPassRes = await client.query(
            `SELECT COALESCE(plan, 'unknown') AS plan,
                    COALESCE(SUM(amount), 0)::int AS "totalPaise",
                    ROUND(COALESCE(SUM(amount), 0)::numeric / 100, 2)::float AS "totalInr",
                    COUNT(*)::int AS count
             FROM payments
             WHERE status = 'captured'
             GROUP BY plan`
        );

        // 7. Refund count
        const refundsRes = await client.query(
            "SELECT COUNT(*)::int AS count FROM payments WHERE status = 'refunded'"
        );

        // 8. Returning users
        const returningRes = await client.query(
            `SELECT COUNT(*)::int AS count FROM (
                 SELECT user_id 
                 FROM usage_events 
                 WHERE success = true 
                 GROUP BY user_id 
                 HAVING COUNT(DISTINCT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'IYYY-IW')) >= 2
             ) t`
        );

        // 9. Fills
        const fillsPerDayRes = await client.query(
            `SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date, 
                    COUNT(*)::int AS count
             FROM usage_events
             WHERE success = true
             GROUP BY date
             ORDER BY date DESC
             LIMIT 30`
        );
        const totalFillsRes = await client.query(
            `SELECT COUNT(*)::int AS total_fills, 
                    COUNT(DISTINCT user_id)::int AS active_users
             FROM usage_events
             WHERE success = true`
        );
        const totalSuccessfulFills = totalFillsRes.rows[0]?.total_fills || 0;
        const activeUsersCount = totalFillsRes.rows[0]?.active_users || 0;
        const avgFillsPerUser = activeUsersCount > 0 ? +(totalSuccessfulFills / activeUsersCount).toFixed(2) : 0;

        // 10. Category breakdown
        const catRes = await client.query(
            `SELECT COALESCE(form_type_category, 'generic') AS category, 
                    COUNT(*)::int AS count
             FROM usage_events
             WHERE success = true
             GROUP BY category
             ORDER BY count DESC`
        );

        // 11. Instant fill totals
        const instantRes = await client.query(
            'SELECT COALESCE(SUM(count), 0)::int AS total_count FROM instant_fill_summaries'
        );

        return {
            dailyActiveUsers: dauRes.rows[0]?.count || 0,
            signupsPerDay: signupsRes.rows,
            usersWithSuccessfulFill: successUsersRes.rows[0]?.count || 0,
            usersBlockedByFreeLimit: {
                today: limitHitTodayRes.rows[0]?.count || 0,
                total: limitHitTotalRes.rows[0]?.count || 0
            },
            paidUsers: paidUsersRes.rows[0]?.count || 0,
            revenue: {
                totalPaise: revTotalRes.rows[0]?.total_paise || 0,
                totalInr: revTotalRes.rows[0]?.total_inr || 0,
                revenuePerDay: revPerDayRes.rows,
                revenueByPassType: revByPassRes.rows
            },
            refundCount: refundsRes.rows[0]?.count || 0,
            returningUsers: returningRes.rows[0]?.count || 0,
            fills: {
                totalSuccessfulFills,
                avgFillsPerUser,
                fillsPerDay: fillsPerDayRes.rows
            },
            formCategoryBreakdown: catRes.rows,
            instantFillTotals: instantRes.rows[0]?.total_count || 0
        };
    } finally {
        client.release();
    }
}

/**
 * Resets the test database (in-memory or real PostgreSQL).
 */
async function resetTestDb() {
    if (isInMemory) {
        resetInMemoryDb();
        return;
    }
    if (pool) {
        await pool.query('TRUNCATE users, entitlements, payments, usage_events, daily_solve_counts, instant_fill_summaries, limit_hit_events, legacy_ip_solve_counts, guest_trial_forms CASCADE');
    }
}

/**
 * Resets the in-memory database store (used for unit tests).
 */
function resetInMemoryDb() {
    memoryStore.users.clear();
    memoryStore.usersBySub.clear();
    memoryStore.entitlements.clear();
    memoryStore.payments.clear();
    memoryStore.paymentsByOrder.clear();
    memoryStore.usage_events.clear();
    memoryStore.daily_solves.clear();
    memoryStore.instant_fill_summaries.clear();
    memoryStore.limit_hit_events.clear();
    memoryStore.legacy_ip_solve_counts.clear();
    memoryStore.guest_trial_forms.clear();
    inMemoryUserLocks.clear();
}

/**
 * Gracefully close pool on shutdown.
 */
async function closeDb() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    initDb,
    closeDb,
    resetTestDb,
    resetInMemoryDb,
    isInMemory: () => isInMemory,
    getStartOfCurrentMonthIST,
    getNextMonthResetDateIST,
    getTodayDateKeyIST,
    getIstDateString,
    findUserByGoogleSub,
    findUserById,
    createUser,
    deleteUser,
    getActiveEntitlement,
    grantEntitlement,
    findPaymentByRazorpayId,
    findPaymentByOrderId,
    createPaymentOrder,
    executeIdempotentGrant,
    revokeEntitlementByPaymentId,
    recordPayment,
    createUsageEvent,
    markUsageEventSuccess,
    deleteUsageEvent,
    reserveFormSessionSlot,
    getDailySolveCount,
    incrementDailySolveCount,
    getMonthlySuccessfulFormsCount,
    recordInstantFillSummary,
    recordLimitHitEvent,
    getLegacyIpDailySolveCount,
    incrementLegacyIpDailySolveCount,
    hashIp,
    reserveGuestTrialForm,
    validateGuestTrialForm,
    markGuestTrialFormUsed,
    releaseGuestTrialForm,
    beginGuestTrialSolve,
    cleanupGuestTrialForms,
    cleanupOldLegacyIpCounts,
    getAdminStats
};
