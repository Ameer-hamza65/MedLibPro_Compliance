
-- Drop the match_chapter_chunks function
DROP FUNCTION IF EXISTS public.match_chapter_chunks(extensions.vector, double precision, integer, uuid);

-- Drop the embedding column from book_chapters
ALTER TABLE public.book_chapters DROP COLUMN IF EXISTS embedding;
