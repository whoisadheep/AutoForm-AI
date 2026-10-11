#!/usr/bin/env node
/**
 * @file server/scripts/grant-pro.js
 * @description Admin CLI script to grant an AutoForm Pro subscription directly to any user.
 * 
 * Usage:
 *   node scripts/grant-pro.js <email-or-userId> [durationDays]
 * 
 * Examples:
 *   node scripts/grant-pro.js user@gmail.com 365
 *   node scripts/grant-pro.js user@gmail.com 3650   (10 years)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function main() {
    const target = process.argv[2];
    const durationDays = parseInt(process.argv[3] || '365', 10);

    if (!target) {
        console.log(`
AutoForm AI — Admin Pro Grant Tool
----------------------------------
Usage:
  node scripts/grant-pro.js <email-or-userId> [durationDays]

Examples:
  node scripts/grant-pro.js user@gmail.com 30
  node scripts/grant-pro.js user@gmail.com 365
  node scripts/grant-pro.js user@gmail.com 3650
`);
        process.exit(1);
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('Error: DATABASE_URL is not set in server/.env or environment.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    try {
        console.log(`[AutoForm Admin] Connecting to database...`);
        const client = await pool.connect();

        try {
            // Find user by email or by ID
            let userRes;
            if (target.includes('@')) {
                userRes = await client.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [target]);
            } else {
                userRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [target]);
            }

            if (userRes.rows.length === 0) {
                console.error(`✕ User '${target}' not found in the users table.`);
                console.log(`  Make sure you have signed in with Google once in the extension first.`);
                
                // Show existing users
                const allUsers = await client.query('SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 5');
                if (allUsers.rows.length > 0) {
                    console.log('\nRecent users in database:');
                    allUsers.rows.forEach(u => console.log(`  - ${u.email}`));
                }
                process.exit(1);
            }

            const user = userRes.rows[0];
            console.log(`✓ Found user: ${user.email} (ID: ${user.id})`);

            // Check active entitlement
            const now = new Date();
            const activeRes = await client.query(
                'SELECT * FROM entitlements WHERE user_id = $1 AND expires_at > $2 ORDER BY expires_at DESC LIMIT 1',
                [user.id, now]
            );

            let expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
            let result;

            if (activeRes.rows.length > 0) {
                const current = activeRes.rows[0];
                const baseTime = new Date(current.expires_at) > now ? new Date(current.expires_at) : now;
                expiresAt = new Date(baseTime.getTime() + durationDays * 24 * 60 * 60 * 1000);

                const updateRes = await client.query(
                    'UPDATE entitlements SET plan = $1, expires_at = $2, payment_id = COALESCE(payment_id, $3) WHERE id = $4 RETURNING *',
                    ['pro', expiresAt, 'admin_manual_grant', current.id]
                );
                result = updateRes.rows[0];
                console.log(`✓ Extended existing AutoForm Pro subscription!`);
            } else {
                const crypto = require('crypto');
                const id = crypto.randomUUID();
                const insertRes = await client.query(
                    'INSERT INTO entitlements (id, user_id, plan, starts_at, expires_at, payment_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                    [id, user.id, 'pro', now, expiresAt, 'admin_manual_grant']
                );
                result = insertRes.rows[0];
                console.log(`✓ Created new AutoForm Pro entitlement!`);
            }

            console.log(`
===================================================
🎉 AutoForm Pro Successfully Granted!
===================================================
  User Email   : ${user.email}
  Plan         : PRO
  Valid Until  : ${new Date(result.expires_at).toUTCString()}
  Duration     : +${durationDays} days
===================================================
`);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Database query error:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
