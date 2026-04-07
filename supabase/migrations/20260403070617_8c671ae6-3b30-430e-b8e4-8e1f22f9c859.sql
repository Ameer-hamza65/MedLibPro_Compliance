
-- Function to search books via FTS
CREATE OR REPLACE FUNCTION public.search_books_fts(
  search_query text,
  filter_clause text DEFAULT '',
  max_results integer DEFAULT 15
)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  specialty text,
  authors text[],
  publisher text,
  published_year integer,
  tags text[],
  file_type text,
  rank real,
  headline text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

-- Function to search chapters via FTS
CREATE OR REPLACE FUNCTION public.search_chapters_fts(
  search_query text,
  max_results integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  book_id uuid,
  chapter_key text,
  title text,
  rank real,
  headline text,
  book_title text,
  book_specialty text,
  book_authors text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
