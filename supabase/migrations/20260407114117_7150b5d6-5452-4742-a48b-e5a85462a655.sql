CREATE OR REPLACE FUNCTION public.match_chapter_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5,
  p_book_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, book_id uuid, chapter_key text, title text, content text, similarity double precision)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.book_id,
    bc.chapter_key,
    bc.title,
    bc.content,
    1 - (bc.embedding <=> query_embedding) AS similarity
  FROM public.book_chapters bc
  WHERE bc.embedding IS NOT NULL
    AND (p_book_id IS NULL OR bc.book_id = p_book_id)
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;