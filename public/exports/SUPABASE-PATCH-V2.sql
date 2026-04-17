-- ============================================================
-- R2 Intelligent Library — Patch v2 (Updated 2026-04-17)
-- Safe to run on top of SUPABASE-FULL-EXPORT.sql
-- All statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE)
-- ============================================================
-- This patch adds everything that landed AFTER the original
-- SUPABASE-FULL-EXPORT.sql snapshot:
--   • books.price column
--   • compliance_collections.annual_price_range column
--   • search_queries table + RLS
--   • feature_flags table + RLS
--   • Analytics RPCs (activity_trend, top_search_terms, title_usage)
--   • Helpful indexes for analytics performance
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns on existing tables
-- ------------------------------------------------------------
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS price numeric(10,2) NOT NULL DEFAULT 49.00;

ALTER TABLE public.compliance_collections
  ADD COLUMN IF NOT EXISTS annual_price_range text;


-- ------------------------------------------------------------
-- 2. search_queries — logs every Discovery / In-book / Homepage search
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_queries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enterprise_id uuid REFERENCES public.enterprises(id) ON DELETE SET NULL,
  query         text NOT NULL,
  source        text NOT NULL DEFAULT 'discovery', -- 'discovery' | 'in_book' | 'homepage'
  result_count  integer,
  book_id       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert search queries" ON public.search_queries;
CREATE POLICY "Anyone can insert search queries"
  ON public.search_queries FOR INSERT TO public
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own search queries" ON public.search_queries;
CREATE POLICY "Users view own search queries"
  ON public.search_queries FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_platform_admin(auth.uid())
    OR (enterprise_id IS NOT NULL AND enterprise_id = get_user_enterprise_id(auth.uid()))
  );

CREATE INDEX IF NOT EXISTS idx_search_queries_created ON public.search_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_query   ON public.search_queries(lower(query));


-- ------------------------------------------------------------
-- 3. feature_flags — runtime kill-switches for new features
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feature flags" ON public.feature_flags;
CREATE POLICY "Anyone can read feature flags"
  ON public.feature_flags FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Platform admins can manage feature flags" ON public.feature_flags;
CREATE POLICY "Platform admins can manage feature flags"
  ON public.feature_flags FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));


-- ------------------------------------------------------------
-- 4. Analytics indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
  ON public.usage_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_book_created
  ON public.usage_events(book_id, created_at DESC);


-- ------------------------------------------------------------
-- 5. Analytics RPCs (called by the /analytics dashboard)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_activity_trend(
  p_bucket text DEFAULT 'day',
  p_days   integer DEFAULT 30
)
RETURNS TABLE(label text, sessions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_char(date_trunc(p_bucket, created_at),
           CASE p_bucket WHEN 'day' THEN 'Mon DD'
                         WHEN 'week' THEN '"Wk" IW'
                         ELSE 'Mon YYYY' END) AS label,
         count(*)::bigint AS sessions
  FROM public.usage_events
  WHERE event_type IN ('reader_open','book_view')
    AND created_at >= now() - (p_days || ' days')::interval
  GROUP BY 1, date_trunc(p_bucket, created_at)
  ORDER BY date_trunc(p_bucket, created_at);
$$;

CREATE OR REPLACE FUNCTION public.analytics_top_search_terms(p_limit integer DEFAULT 12)
RETURNS TABLE(term text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(query) AS term, count(*)::bigint
  FROM public.search_queries
  WHERE length(query) > 2
  GROUP BY lower(query)
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.analytics_title_usage(p_limit integer DEFAULT 20)
RETURNS TABLE(book_id text, title text, views bigint, sessions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ue.book_id,
         max(coalesce(ue.book_title, b.title)) AS title,
         count(*) FILTER (WHERE ue.event_type = 'book_view')::bigint AS views,
         count(*) FILTER (WHERE ue.event_type = 'reader_open')::bigint AS sessions
  FROM public.usage_events ue
  LEFT JOIN public.books b ON b.id::text = ue.book_id
  WHERE ue.book_id IS NOT NULL
  GROUP BY ue.book_id
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;


-- ------------------------------------------------------------
-- 6. Verify
-- ------------------------------------------------------------
-- Run these to confirm the patch applied cleanly:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='books' AND column_name='price';
-- SELECT to_regclass('public.search_queries'), to_regclass('public.feature_flags');
-- SELECT proname FROM pg_proc WHERE proname LIKE 'analytics_%';
