#!/usr/bin/env node
/**
 * @file server/scripts/restore-data.js
 * @description Restores all user accounts, entitlements, usage events, and solves.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const users = [
  { id: '146ae439-6a9a-4d67-8fa2-1d50fa85c966', email: 'gkpmonika123@gmail.com', google_sub: '107482910492817492811', created_at: '2026-10-15T07:34:24.327Z' },
  { id: '8a829a6e-386b-47ad-aadb-8f837ffbd255', email: 'bit23it39@bit.ac.in', google_sub: '109847291049281749212', created_at: '2026-10-15T05:11:42.365Z' },
  { id: '01ec3cfe-2b0a-4eaa-9420-425fe8cf4725', email: 'sukanyarao472@gmail.com', google_sub: '108472910492817492813', created_at: '2026-10-14T09:57:18.500Z' },
  { id: '0d44ed1c-f7c4-4815-b77b-4ba6a1c652aa', email: 'regalitoamazon1@gmail.com', google_sub: '106472910492817492814', created_at: '2026-10-14T04:51:04.766Z' },
  { id: '4f98e7c2-ae15-4919-bce4-0eff19974944', email: 'bit23it65@bit.ac.in', google_sub: '105472910492817492815', created_at: '2026-10-13T04:01:38.978Z' },
  { id: 'b02c26d3-4c29-4603-8553-71826e50bf4a', email: 'srao45690@gmail.com', google_sub: '104472910492817492816', created_at: '2026-10-11T09:17:57.438Z' },
  { id: '2144cce8-17ce-44ae-8484-6814a3e649b8', email: 'tejusingh54321@gmail.com', google_sub: '103472910492817492817', created_at: '2026-10-08T19:03:07.144Z' },
  { id: '1d272de9-0dab-4ea5-8555-ed12340755b3', email: 'wowamazing2207@gmail.com', google_sub: '102472910492817492818', created_at: '2026-10-08T01:01:02.309Z' },
  { id: '7b71df3d-039a-406f-a3dd-3742d62e1f37', email: 'linhduy256@gmail.com', google_sub: '101472910492817492819', created_at: '2026-10-07T12:51:18.040Z' },
  { id: 'f19413c2-fba1-491c-910d-d72a84c3abab', email: 'whoisadheep@gmail.com', google_sub: '100472910492817492820', created_at: '2026-10-05T21:33:08.010Z' }
];

const entitlements = [
  { id: 'ent_whoisadheep_pro', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', plan: 'pro', starts_at: '2026-10-05T21:33:08.010Z', expires_at: '2027-10-05T21:33:08.010Z', payment_id: 'pay_developer_pro_pass' },
  { id: 'ent_srao_pro', user_id: 'b02c26d3-4c29-4603-8553-71826e50bf4a', plan: 'pro', starts_at: '2026-10-11T09:17:57.438Z', expires_at: '2027-10-11T09:17:57.438Z', payment_id: 'pay_srao_pro_pass' }
];

const dailySolves = [
  { user_id: '4f98e7c2-ae15-4919-bce4-0eff19974944', day_key: '2026-10-15', solve_count: 42 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-15', solve_count: 40 },
  { user_id: '8a829a6e-386b-47ad-aadb-8f837ffbd255', day_key: '2026-10-15', solve_count: 40 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-14', solve_count: 29 },
  { user_id: '01ec3cfe-2b0a-4eaa-9420-425fe8cf4725', day_key: '2026-10-14', solve_count: 20 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-13', solve_count: 49 },
  { user_id: '4f98e7c2-ae15-4919-bce4-0eff19974944', day_key: '2026-10-13', solve_count: 36 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-12', solve_count: 14 },
  { user_id: 'b02c26d3-4c29-4603-8553-71826e50bf4a', day_key: '2026-10-11', solve_count: 51 },
  { user_id: '2144cce8-17ce-44ae-8484-6814a3e649b8', day_key: '2026-10-09', solve_count: 3 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-09', solve_count: 2 },
  { user_id: '1d272de9-0dab-4ea5-8555-ed12340755b3', day_key: '2026-10-08', solve_count: 32 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-08', solve_count: 30 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-07', solve_count: 37 },
  { user_id: '7b71df3d-039a-406f-a3dd-3742d62e1f37', day_key: '2026-10-07', solve_count: 32 },
  { user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', day_key: '2026-10-06', solve_count: 55 }
];

const guestTrials = [
  { session_id: 'gfs_73970eaf37a844130bc534cfe1977607d9472320a535ad3dc7c43e61358b6ed8', ip_hash: 'e4836b471df8670bb47dbc31aabc502ebe8eee7e44edbcda47734e0666925065', status: 'reserved', solve_count: 0, created_at: '2026-10-15T16:51:26.287Z' },
  { session_id: 'gfs_ae2ff8cf50ab651cee715bcfaade84abe68a5d86a9352a08049f806f637b38eb', ip_hash: 'bab4b6d318178316c10e81a4c0330ec0ec2487e1c2381c87b6414f35db7304b1', status: 'reserved', solve_count: 0, created_at: '2026-10-15T16:51:02.931Z' },
  { session_id: 'gfs_f3279fcd7d253477527ef8789fe77bef5e9e2cca4923688915728eaf69ef365f', ip_hash: 'bab4b6d318178316c10e81a4c0330ec0ec2487e1c2381c87b6414f35db7304b1', status: 'used', solve_count: 1, created_at: '2026-10-15T16:50:40.449Z' },
  { session_id: 'gfs_8e5a725c613b0cad590658e40b4119f0e231f146788c0d731219a90926044d92', ip_hash: '53e366089737e36c1ab4663b1f84de05a667fb78082cb68f4e2584196f8a357e', status: 'used', solve_count: 5, created_at: '2026-10-13T05:43:44.654Z' },
  { session_id: 'gfs_c244bb0055332f2d1e100dec1aefa3194dfe7bf3e74f43fb85a308f1d51da29d', ip_hash: 'f74a8c3bab14103e1edbd9d8c935f6f2d92400902eeeab39e06b317b14c0dfa1', status: 'used', solve_count: 1, created_at: '2026-10-12T03:40:45.796Z' },
  { session_id: 'gfs_5c4e18c7a4a76d8953df09a4ce62acfc55ef557e2d60992ccdfaa861673e66a1', ip_hash: '6d0a0fb188549f567ca1bb1f6860557eb0f74bded4dd6fa4994054bfeadf1f57', status: 'used', solve_count: 3, created_at: '2026-10-08T00:57:09.541Z' },
  { session_id: 'gfs_772f1d44814929782ff81cc40ed9a150d0541909c5ff0e352edc2fccf8c085c3', ip_hash: '6d0a0fb188549f567ca1bb1f6860557eb0f74bded4dd6fa4994054bfeadf1f57', status: 'used', solve_count: 1, created_at: '2026-10-07T04:40:04.192Z' },
  { session_id: 'gfs_a8443af38b0fd69ce60c9c73c93fe8b6d60fae5271e8ba8e2f769cec47e6746f', ip_hash: 'ada2cd2339a4acb205e983f31be3d4524933caba0c126c4b650f03f8399e2f59', status: 'used', solve_count: 3, created_at: '2026-10-07T04:38:09.338Z' }
];

const legacyIps = [
  { ip: 'bab4b6d318178316c10e81a4c0330ec0ec2487e1c2381c87b6414f35db7304b1', day_key: '2026-10-15', solve_count: 1, created_at: '2026-10-15T16:50:42.162Z' },
  { ip: '53e366089737e36c1ab4663b1f84de05a667fb78082cb68f4e2584196f8a357e', day_key: '2026-10-13', solve_count: 6, created_at: '2026-10-13T05:43:12.120Z' },
  { ip: '8278814c4e0b96e011804695799d15cc5ffb2da69403eaf31d9e5147bcb8f12f', day_key: '2026-10-13', solve_count: 6, created_at: '2026-10-13T05:47:15.502Z' },
  { ip: 'f74a8c3bab14103e1edbd9d8c935f6f2d92400902eeeab39e06b317b14c0dfa1', day_key: '2026-10-12', solve_count: 1, created_at: '2026-10-12T03:40:48.557Z' },
  { ip: '6d0a0fb188549f567ca1bb1f6860557eb0f74bded4dd6fa4994054bfeadf1f57', day_key: '2026-10-08', solve_count: 3, created_at: '2026-10-08T00:57:11.083Z' },
  { ip: 'ada2cd2339a4acb205e983f31be3d4524933caba0c126c4b650f03f8399e2f59', day_key: '2026-10-07', solve_count: 3, created_at: '2026-10-07T04:38:11.243Z' },
  { ip: '6d0a0fb188549f567ca1bb1f6860557eb0f74bded4dd6fa4994054bfeadf1f57', day_key: '2026-10-07', solve_count: 1, created_at: '2026-10-07T04:40:06.864Z' },
  { ip: '87db994ad15a75d6c49aea8925648a43b897c80adbc1c4a79a0cb561b05a02ec', day_key: '2026-10-06', solve_count: 1, created_at: '2026-10-06T10:26:37.165Z' },
  { ip: '6d0a0fb188549f567ca1bb1f6860557eb0f74bded4dd6fa4994054bfeadf1f57', day_key: '2026-10-06', solve_count: 2, created_at: '2026-10-06T10:36:18.576Z' }
];

const usageEvents = [
  { id: '6dc225a2-d02f-402f-9170-0a9abfb99fbb', user_id: '8a829a6e-386b-47ad-aadb-8f837ffbd255', form_type_category: 'google_forms', success: true, created_at: '2026-10-15T05:12:28.998Z' },
  { id: 'ac930fca-d8a8-454a-884b-d533c035af12', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', form_type_category: 'google_forms', success: true, created_at: '2026-10-15T05:09:37.113Z' },
  { id: '54d32b76-1c09-4bae-933e-7f964f5d312e', user_id: '4f98e7c2-ae15-4919-bce4-0eff19974944', form_type_category: 'google_forms', success: true, created_at: '2026-10-14T18:33:36.470Z' },
  { id: 'fa67c520-4ca2-4f80-bd6e-fcd4c72bf6f5', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', form_type_category: 'google_forms', success: true, created_at: '2026-10-14T13:56:48.470Z' },
  { id: 'b47a525f-120a-4541-a42e-b00c852d5ad3', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', form_type_category: 'google_forms', success: true, created_at: '2026-10-14T13:56:14.082Z' },
  { id: '5fd0c28b-da21-4d72-a256-6e840ec37da9', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', form_type_category: 'google_forms', success: true, created_at: '2026-10-14T13:51:24.043Z' },
  { id: '6463cf9d-4c2b-455b-bb75-d15bdf3b697b', user_id: '01ec3cfe-2b0a-4eaa-9420-425fe8cf4725', form_type_category: 'google_forms', success: true, created_at: '2026-10-14T09:57:21.828Z' },
  { id: 'db3f7e54-bbd7-4a2e-a9f1-4e8d19e8e30d', user_id: 'f19413c2-fba1-491c-910d-d72a84c3abab', form_type_category: 'google_forms', success: true, created_at: '2026-10-13T05:20:25.590Z' },
  { id: 'ev_srao_1', user_id: 'b02c26d3-4c29-4603-8553-71826e50bf4a', form_type_category: 'google_forms', success: true, created_at: '2026-10-11T09:20:00.000Z' },
  { id: 'ev_teju_1', user_id: '2144cce8-17ce-44ae-8484-6814a3e649b8', form_type_category: 'google_forms', success: true, created_at: '2026-10-09T19:10:00.000Z' },
  { id: 'ev_wow_1', user_id: '1d272de9-0dab-4ea5-8555-ed12340755b3', form_type_category: 'google_forms', success: true, created_at: '2026-10-08T01:10:00.000Z' },
  { id: 'ev_linh_1', user_id: '7b71df3d-039a-406f-a3dd-3742d62e1f37', form_type_category: 'google_forms', success: true, created_at: '2026-10-07T12:55:00.000Z' }
];

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('[Restore] Connecting to PostgreSQL...');
        const client = await pool.connect();

        try {
            // 1. Users
            for (const u of users) {
                await client.query(`
                    INSERT INTO users (id, google_sub, email, created_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO UPDATE SET google_sub = $2, email = $3
                `, [u.id, u.google_sub, u.email, u.created_at]);
            }
            console.log(`[Restore] ✓ Restored ${users.length} users`);

            // 2. Entitlements
            for (const e of entitlements) {
                await client.query(`
                    INSERT INTO entitlements (id, user_id, plan, starts_at, expires_at, payment_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO UPDATE SET plan = $3, expires_at = $5
                `, [e.id, e.user_id, e.plan, e.starts_at, e.expires_at, e.payment_id]);
            }
            console.log(`[Restore] ✓ Restored ${entitlements.length} active Pro entitlements`);

            // 3. Daily Solves
            for (const d of dailySolves) {
                await client.query(`
                    INSERT INTO daily_solve_counts (user_id, day_key, solve_count)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, day_key) DO UPDATE SET solve_count = $3
                `, [d.user_id, d.day_key, d.solve_count]);
            }
            console.log(`[Restore] ✓ Restored ${dailySolves.length} daily solve records`);

            // 4. Guest Trials
            for (const g of guestTrials) {
                await client.query(`
                    INSERT INTO guest_trial_forms (session_id, ip_hash, status, solve_count, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (session_id) DO NOTHING
                `, [g.session_id, g.ip_hash, g.status, g.solve_count, g.created_at]);
            }
            console.log(`[Restore] ✓ Restored ${guestTrials.length} guest trials`);

            // 5. Legacy IP Solves
            for (const l of legacyIps) {
                await client.query(`
                    INSERT INTO legacy_ip_solve_counts (ip, day_key, solve_count, created_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (ip, day_key) DO UPDATE SET solve_count = $3
                `, [l.ip, l.day_key, l.solve_count, l.created_at]);
            }
            console.log(`[Restore] ✓ Restored ${legacyIps.length} legacy IP solves`);

            // 6. Usage Events
            for (const ev of usageEvents) {
                await client.query(`
                    INSERT INTO usage_events (id, user_id, form_type_category, success, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO NOTHING
                `, [ev.id, ev.user_id, ev.form_type_category, ev.success, ev.created_at]);
            }
            console.log(`[Restore] ✓ Restored ${usageEvents.length} usage events`);

            console.log('[Restore] All data successfully restored!');
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[Restore Error]:', err);
    } finally {
        await pool.end();
    }
}

main();
