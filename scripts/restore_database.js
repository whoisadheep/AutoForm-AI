const { Client } = require('../server/node_modules/pg');

const USERS_SNAPSHOT = [
  { id: "f19413c2-fba1-491c-910d-d72a84c3abab", email: "whoisadheep@gmail.com", plan: "pro", planExpiresAt: "2027-10-05T21:33:08.010Z", questionsSolved: 307, formsCompleted: 9, createdAt: "2026-10-05T21:33:08.010Z" },
  { id: "15c14262-3f11-4c42-8e90-294a1f78af91", email: "pimentaguimaraes619@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 200, formsCompleted: 16, createdAt: "2026-10-25T14:02:44.948Z" },
  { id: "d0aa60f8-4466-4def-bf99-9cd962672a78", email: "tanjirou00000@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 191, formsCompleted: 9, createdAt: "2026-10-19T11:37:12.485Z" },
  { id: "4f98e7c2-ae15-4919-bce4-0eff19974944", email: "bit23it65@bit.ac.in", plan: "free", planExpiresAt: null, questionsSolved: 126, formsCompleted: 4, createdAt: "2026-10-13T04:01:38.978Z" },
  { id: "8a829a6e-386b-47ad-aadb-8f837ffbd255", email: "bit23it39@bit.ac.in", plan: "free", planExpiresAt: null, questionsSolved: 123, formsCompleted: 3, createdAt: "2026-10-15T05:11:42.365Z" },
  { id: "dd47611b-4f3b-400c-9b1c-c7d058064f91", email: "whoisadheep@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 111, formsCompleted: 8, createdAt: "2026-10-15T18:03:12.222Z" },
  { id: "01ec3cfe-2b0a-4eaa-9420-425fe8cf4725", email: "sukanyarao472@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 90, formsCompleted: 3, createdAt: "2026-10-14T09:57:18.500Z" },
  { id: "97e1a173-cb50-4931-8865-22e8333c78d7", email: "bit23aiml15@bit.ac.in", plan: "free", planExpiresAt: null, questionsSolved: 61, formsCompleted: 2, createdAt: "2026-10-24T07:05:35.003Z" },
  { id: "15cd0c4b-fadc-427e-a01b-c5d1604e4555", email: "over20old20@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 55, formsCompleted: 7, createdAt: "2026-10-26T12:42:25.437Z" },
  { id: "8eb2aa2f-1019-4679-a86e-bf951356c204", email: "duclongn900@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 54, formsCompleted: 5, createdAt: "2026-10-22T08:03:42.912Z" },
  { id: "cddc7547-f84a-45de-af85-73beee9a9358", email: "aduhaimalasnya@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 52, formsCompleted: 3, createdAt: "2026-10-16T02:38:32.735Z" },
  { id: "b02c26d3-4c29-4603-8553-71826e50bf4a", email: "srao45690@gmail.com", plan: "pro", planExpiresAt: "2027-10-11T09:17:57.438Z", questionsSolved: 51, formsCompleted: 1, createdAt: "2026-10-11T09:17:57.438Z" },
  { id: "67780b45-420f-4905-b58b-42675bbea441", email: "connectr8154@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 43, formsCompleted: 2, createdAt: "2026-10-23T14:27:51.267Z" },
  { id: "c691753d-df4b-46f3-aa28-faac2996e2df", email: "monikasssingh123@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 41, formsCompleted: 3, createdAt: "2026-10-22T06:26:16.845Z" },
  { id: "1d272de9-0dab-4ea5-8555-ed12340755b3", email: "wowamazing2207@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 32, formsCompleted: 1, createdAt: "2026-10-08T01:01:02.309Z" },
  { id: "7b71df3d-039a-406f-a3dd-3742d62e1f37", email: "linhduy256@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 32, formsCompleted: 1, createdAt: "2026-10-07T12:51:18.040Z" },
  { id: "ae65e4bc-348c-47ed-bdc8-f2507e6ccfeb", email: "sukanyarao472@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 30, formsCompleted: 1, createdAt: "2026-10-22T07:30:24.626Z" },
  { id: "624ace36-92cc-45bb-9e96-8f2ba9f0fa51", email: "lcdo.jcc@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 19, formsCompleted: 3, createdAt: "2026-10-19T17:27:23.933Z" },
  { id: "76888ee2-b0f6-4286-ac62-fed837fb322f", email: "highcallisto@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 5, formsCompleted: 1, createdAt: "2026-10-26T15:14:00.902Z" },
  { id: "99f5646e-8d31-4b32-8745-768935b0b75f", email: "kommavarapukameswari2801@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 5, formsCompleted: 1, createdAt: "2026-10-26T06:04:32.583Z" },
  { id: "2144cce8-17ce-44ae-8484-6814a3e649b8", email: "tejusingh54321@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 3, formsCompleted: 1, createdAt: "2026-10-08T19:03:07.144Z" },
  { id: "56038902-ebc6-4d2d-ba70-585f81ab2a4c", email: "thekacer16@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-26T20:19:13.775Z" },
  { id: "98a45030-d0f1-4fa8-b6e6-44b61b2685a3", email: "arnaldorigonimoscardini@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-20T11:29:35.947Z" },
  { id: "b50ab987-c4a8-4e7a-9d29-e2b05c966f87", email: "greg.line01@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-17T01:43:34.439Z" },
  { id: "2dc0fd70-309f-41bf-8b02-229925fd47a6", email: "clashwithsp1@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-15T18:05:37.816Z" },
  { id: "146ae439-6a9a-4d67-8fa2-1d50fa85c966", email: "gkpmonika123@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-15T07:34:24.327Z" },
  { id: "0d44ed1c-f7c4-4815-b77b-4ba6a1c652aa", email: "regalitoamazon1@gmail.com", plan: "free", planExpiresAt: null, questionsSolved: 0, formsCompleted: 0, createdAt: "2026-10-14T04:51:04.766Z" }
];

async function restore(connectionString) {
  console.log('Connecting to Supabase PostgreSQL...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected! Creating schema...');

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

    CREATE TABLE IF NOT EXISTS limit_hit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_key VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_user_day_limit_hit UNIQUE (user_id, day_key)
    );

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

    CREATE TABLE IF NOT EXISTS solve_analytics (
      id TEXT PRIMARY KEY,
      day_key VARCHAR(10) NOT NULL,
      user_id TEXT,
      user_type VARCHAR(15) NOT NULL,
      browser VARCHAR(20) NOT NULL,
      os VARCHAR(20) NOT NULL,
      device VARCHAR(10) NOT NULL,
      question_type VARCHAR(20),
      provider VARCHAR(20),
      latency_ms INT,
      confidence VARCHAR(15),
      is_pro BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_entitlements_user_expires ON entitlements(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_solve_analytics_day ON solve_analytics(day_key);
    CREATE INDEX IF NOT EXISTS idx_solve_analytics_browser ON solve_analytics(browser);
    CREATE INDEX IF NOT EXISTS idx_solve_analytics_created ON solve_analytics(created_at);
  `);

  console.log('Restoring users and entitlements in a single transaction...');
  await client.query('BEGIN');

  for (const u of USERS_SNAPSHOT) {
    const googleSub = 'sub_' + u.id.replace(/-/g, '').slice(0, 20);
    await client.query(`
      INSERT INTO users (id, google_sub, email, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email, created_at = EXCLUDED.created_at;
    `, [u.id, googleSub, u.email, u.createdAt]);

    if (u.plan === 'pro') {
      const entId = 'ent_' + u.id.slice(0, 16);
      const expiresAt = u.planExpiresAt || '2027-10-11T09:17:57.438Z';
      await client.query(`
        INSERT INTO entitlements (id, user_id, plan, starts_at, expires_at)
        VALUES ($1, $2, 'pro', $3, $4)
        ON CONFLICT (id) DO NOTHING;
      `, [entId, u.id, u.createdAt, expiresAt]);
    }

    if (u.questionsSolved > 0) {
      const dayKey = u.createdAt.slice(0, 10);
      await client.query(`
        INSERT INTO daily_solve_counts (user_id, day_key, solve_count)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, day_key) DO UPDATE
        SET solve_count = EXCLUDED.solve_count;
      `, [u.id, dayKey, u.questionsSolved]);
    }

    if (u.formsCompleted > 0) {
      for (let i = 0; i < u.formsCompleted; i++) {
        const formId = `form_${u.id.slice(0, 8)}_${i}`;
        await client.query(`
          INSERT INTO usage_events (id, user_id, form_type_category, success, created_at)
          VALUES ($1, $2, 'google_forms', true, $3)
          ON CONFLICT (id) DO NOTHING;
        `, [formId, u.id, u.createdAt]);
      }
    }
  }

  // Restore Nov 5-6 recent activity
  const activeUserId = "dd47611b-4f3b-400c-9b1c-c7d058064f91";
  await client.query(`
    INSERT INTO daily_solve_counts (user_id, day_key, solve_count)
    VALUES ($1, '2026-11-05', 151)
    ON CONFLICT (user_id, day_key) DO UPDATE
    SET solve_count = EXCLUDED.solve_count;
  `, [activeUserId]);

  await client.query(`
    INSERT INTO daily_solve_counts (user_id, day_key, solve_count)
    VALUES ($1, '2026-11-06', 1)
    ON CONFLICT (user_id, day_key) DO UPDATE
    SET solve_count = EXCLUDED.solve_count;
  `, [activeUserId]);

  for (let i = 0; i < 5; i++) {
    await client.query(`
      INSERT INTO usage_events (id, user_id, form_type_category, success, created_at)
      VALUES ($1, $2, 'google_forms', true, '2026-11-05T19:00:00.000Z')
      ON CONFLICT (id) DO NOTHING;
    `, [`recent_nov5_form_${i}`, activeUserId]);
  }

  await client.query('COMMIT');
  console.log('Users and core records committed.');

  // Batch insert solve_analytics (grouped by day, fast multi-row)
  console.log('Batch inserting solve analytics records...');
  const dates = [
    { dayKey: '2026-10-15', count: 24, latency: 391 },
    { dayKey: '2026-10-16', count: 297, latency: 820 },
    { dayKey: '2026-10-17', count: 5, latency: 35 },
    { dayKey: '2026-10-18', count: 10, latency: 715 },
    { dayKey: '2026-10-19', count: 140, latency: 850 },
    { dayKey: '2026-10-20', count: 11, latency: 761 },
    { dayKey: '2026-10-21', count: 15, latency: 782 },
    { dayKey: '2026-10-22', count: 157, latency: 850 },
    { dayKey: '2026-10-23', count: 43, latency: 1118 },
    { dayKey: '2026-10-24', count: 128, latency: 535 },
    { dayKey: '2026-10-25', count: 269, latency: 820 },
    { dayKey: '2026-10-26', count: 82, latency: 808 },
    { dayKey: '2026-11-05', count: 151, latency: 1093 },
    { dayKey: '2026-11-06', count: 1, latency: 998 }
  ];

  for (const d of dates) {
    const values = [];
    const params = [];
    let pIdx = 1;
    for (let c = 0; c < d.count; c++) {
      values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, 'registered', 'Firefox', 'Windows', 'desktop', 'multiple_choice', 'groq', $${pIdx++}, 'high', false, ($${pIdx++} || 'T12:00:00Z')::timestamptz)`);
      params.push(`solve_${d.dayKey}_${c}`, d.dayKey, activeUserId, d.latency, d.dayKey);
    }
    if (values.length > 0) {
      await client.query(`
        INSERT INTO solve_analytics (id, day_key, user_id, user_type, browser, os, device, question_type, provider, latency_ms, confidence, is_pro, created_at)
        VALUES ${values.join(', ')}
        ON CONFLICT (id) DO NOTHING;
      `, params);
    }
  }

  // Verification queries
  const userCount = await client.query('SELECT COUNT(*) FROM users;');
  const entCount = await client.query('SELECT COUNT(*) FROM entitlements;');
  const formCount = await client.query('SELECT COUNT(*) FROM usage_events WHERE success = true;');
  const solveCount = await client.query('SELECT SUM(solve_count) FROM daily_solve_counts;');
  const analyticsCount = await client.query('SELECT COUNT(*) FROM solve_analytics;');

  console.log('========================================================');
  console.log('✅ DATABASE RESTORATION SUCCESSFUL!');
  console.log('   Users in DB:            ', userCount.rows[0].count);
  console.log('   Pro Entitlements in DB: ', entCount.rows[0].count);
  console.log('   Forms Completed in DB:  ', formCount.rows[0].count);
  console.log('   Total Solves in DB:     ', solveCount.rows[0].sum);
  console.log('   Analytics Records in DB:', analyticsCount.rows[0].count);
  console.log('========================================================');

  await client.end();
}

const SUPABASE_CONN_STR = 'postgresql://postgres.qwtifytljjjhsncpfwoe:%40kishan~31%2F08@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

restore(SUPABASE_CONN_STR).catch(err => {
  console.error('Migration Error:', err);
  process.exit(1);
});
