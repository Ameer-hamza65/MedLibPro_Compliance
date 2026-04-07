-- ==========================================
-- MIGRATION: April 7 Schema Updates
-- ==========================================

-- 1. ADD NEW COLUMNS TO EXISTING TABLES
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE public.book_chapters ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE public.highlights ADD COLUMN IF NOT EXISTS cfi_range text;
ALTER TABLE public.annotations ADD COLUMN IF NOT EXISTS cfi_range text;


-- 2. ADD NEW FULL-TEXT SEARCH FUNCTIONS
CREATE OR REPLACE FUNCTION public.search_books_fts(search_query text, filter_clause text DEFAULT '', max_results integer DEFAULT 15)
RETURNS TABLE(id uuid, title text, description text, specialty text, authors text[], publisher text, published_year integer, tags text[], file_type text, rank real, headline text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT b.id, b.title, b.description, b.specialty, b.authors, b.publisher,
            b.published_year, b.tags, b.file_type,
            ts_rank_cd(b.search_vector, plainto_tsquery(''english'', $1)) AS rank,
            ts_headline(''english'', coalesce(b.title, '''') || '' '' || coalesce(b.description, ''''),
              plainto_tsquery(''english'', $1),
              ''StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=15''
            ) AS headline
     FROM public.books b
     WHERE b.search_vector @@ plainto_tsquery(''english'', $1) %s
     ORDER BY rank DESC
     LIMIT $2',
    filter_clause
  ) USING search_query, max_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_chapters_fts(search_query text, max_results integer DEFAULT 20)
RETURNS TABLE(id uuid, book_id uuid, chapter_key text, title text, rank real, headline text, book_title text, book_specialty text, book_authors text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.book_id, c.chapter_key, c.title,
           ts_rank_cd(c.search_vector, plainto_tsquery('english', search_query)) AS rank,
           ts_headline('english', coalesce(c.title, '') || ' ' || coalesce(left(c.content, 2000), ''),
             plainto_tsquery('english', search_query),
             'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=10'
           ) AS headline,
           b.title AS book_title,
           b.specialty AS book_specialty,
           b.authors AS book_authors
    FROM public.book_chapters c
    JOIN public.books b ON b.id = c.book_id
    WHERE c.search_vector @@ plainto_tsquery('english', search_query)
    ORDER BY rank DESC
    LIMIT max_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.books_search_vector_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.subtitle, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.specialty, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.publisher, '')), 'D') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.authors, '{}'), ' ')), 'D');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_chapters_search_vector_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(
      left(NEW.content, 500000), ''
    )), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'C');
  RETURN NEW;
END;
$$;


-- 3. ADD NEW TRIGGERS
DROP TRIGGER IF EXISTS books_search_vector_trigger ON public.books;
CREATE TRIGGER books_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.books_search_vector_update();

DROP TRIGGER IF EXISTS book_chapters_search_vector_trigger ON public.book_chapters;
CREATE TRIGGER book_chapters_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.book_chapters
  FOR EACH ROW EXECUTE FUNCTION public.book_chapters_search_vector_update();


-- 4. ADD NEW RLS POLICIES
DROP POLICY IF EXISTS "Anyone can view books" ON public.books;
CREATE POLICY "Anyone can view books" ON public.books FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Platform admins can view all ai logs" ON public.ai_query_logs;
CREATE POLICY "Platform admins can view all ai logs" ON public.ai_query_logs FOR SELECT TO authenticated USING (is_platform_admin(auth.uid()));


-- 5. ADD NEW STORAGE BUCKET & POLICIES
INSERT INTO storage.buckets (id, name, public) 
VALUES ('book-images', 'book-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can read book images" ON storage.objects;
CREATE POLICY "Anyone can read book images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'book-images');

DROP POLICY IF EXISTS "Authenticated users can upload book images" ON storage.objects;
CREATE POLICY "Authenticated users can upload book images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'book-images');