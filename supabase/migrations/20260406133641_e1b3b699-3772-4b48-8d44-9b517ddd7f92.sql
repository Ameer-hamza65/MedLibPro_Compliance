
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add embedding column to book_chapters
ALTER TABLE public.book_chapters
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create similarity search function
CREATE OR REPLACE FUNCTION public.match_chapter_chunks(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5,
  p_book_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  book_id uuid,
  chapter_key text,
  title text,
  content text,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Create index for fast vector lookups
CREATE INDEX IF NOT EXISTS idx_book_chapters_embedding
ON public.book_chapters
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
