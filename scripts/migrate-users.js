/**
 * One-time migration: moves existing app_users → Supabase Auth + profiles table.
 *
 * Prerequisites:
 *   1. Run supabase/migrations/001_rls.sql in Supabase Dashboard first.
 *   2. Set the three env vars below (get them from Supabase Dashboard → Project Settings → API).
 *   3. Temporarily disable "No access to app_users" RLS policy in Supabase Dashboard
 *      so this script can read the existing users (re-enable it after).
 *
 * Run:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/migrate-users.js
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: users, error: fetchErr } = await admin
  .from("app_users")
  .select("id, username, password, role")
  .order("id");

if (fetchErr) {
  console.error("Failed to read app_users:", fetchErr.message);
  console.error("Make sure the 'No access to app_users' RLS policy is disabled temporarily.");
  process.exit(1);
}

console.log(`Migrating ${users.length} user(s)…\n`);

for (const u of users) {
  const email = `${u.username.toLowerCase()}@cropcomp.internal`;
  console.log(`  Creating auth user: ${u.username} (${email}, role=${u.role})`);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: u.password,
    email_confirm: true,
    user_metadata: { username: u.username, role: u.role },
  });

  if (createErr) {
    if (createErr.message.includes("already been registered")) {
      console.log(`    ↳ Already exists in auth, skipping auth creation.`);
      const { data: existing } = await admin.auth.admin.listUsers();
      const match = existing?.users?.find(x => x.email === email);
      if (match) {
        await admin.from("profiles").upsert({ id: match.id, username: u.username, role: u.role });
        console.log(`    ↳ Profiles row upserted.`);
      }
    } else {
      console.error(`    ✗ Error creating ${u.username}:`, createErr.message);
    }
    continue;
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: created.user.id, username: u.username, role: u.role });

  if (profileErr) {
    console.error(`    ✗ Error creating profile for ${u.username}:`, profileErr.message);
  } else {
    console.log(`    ✓ Done (auth id: ${created.user.id})`);
  }
}

console.log("\nMigration complete.");
console.log("Re-enable the 'No access to app_users' RLS policy in Supabase Dashboard.");
