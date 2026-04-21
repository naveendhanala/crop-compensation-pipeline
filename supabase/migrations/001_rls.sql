-- =============================================================
-- Phase 2 Security Migration
-- Run this in Supabase Dashboard → SQL Editor
-- =============================================================

-- 1. Create profiles table (replaces app_users for auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id      UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  role     TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS on every table
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.junctions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users     ENABLE ROW LEVEL SECURITY;

-- 3. Lock down app_users completely (passwords must not leak)
DROP POLICY IF EXISTS "No access to app_users" ON public.app_users;
CREATE POLICY "No access to app_users" ON public.app_users
  USING (false) WITH CHECK (false);

-- 4. Profiles: all authenticated users can read (internal-only app)
DROP POLICY IF EXISTS "Authenticated read profiles" ON public.profiles;
CREATE POLICY "Authenticated read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Super-admin can update profiles (role checked from JWT user_metadata)
DROP POLICY IF EXISTS "Super-admin updates profiles" ON public.profiles;
CREATE POLICY "Super-admin updates profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super-admin');

-- 5. Ledger: authenticated users only
DROP POLICY IF EXISTS "Auth read ledger"   ON public.ledger;
DROP POLICY IF EXISTS "Auth insert ledger" ON public.ledger;
DROP POLICY IF EXISTS "Auth update ledger" ON public.ledger;
DROP POLICY IF EXISTS "Auth delete ledger" ON public.ledger;
CREATE POLICY "Auth read ledger"   ON public.ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert ledger" ON public.ledger FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update ledger" ON public.ledger FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete ledger" ON public.ledger FOR DELETE TO authenticated USING (true);

-- 6. Junctions: authenticated users only
DROP POLICY IF EXISTS "Auth read junctions"   ON public.junctions;
DROP POLICY IF EXISTS "Auth insert junctions" ON public.junctions;
DROP POLICY IF EXISTS "Auth update junctions" ON public.junctions;
DROP POLICY IF EXISTS "Auth delete junctions" ON public.junctions;
CREATE POLICY "Auth read junctions"   ON public.junctions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert junctions" ON public.junctions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update junctions" ON public.junctions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete junctions" ON public.junctions FOR DELETE TO authenticated USING (true);

-- 7. Site entries: authenticated users only
DROP POLICY IF EXISTS "Auth read site_entries"   ON public.site_entries;
DROP POLICY IF EXISTS "Auth insert site_entries" ON public.site_entries;
DROP POLICY IF EXISTS "Auth update site_entries" ON public.site_entries;
CREATE POLICY "Auth read site_entries"   ON public.site_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert site_entries" ON public.site_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update site_entries" ON public.site_entries FOR UPDATE TO authenticated USING (true);
