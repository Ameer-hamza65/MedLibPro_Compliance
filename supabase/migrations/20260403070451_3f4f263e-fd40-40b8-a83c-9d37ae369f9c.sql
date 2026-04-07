
-- Add search_vector to books
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create trigger function for books
CREATE OR REPLACE FUNCTION public.books_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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

-- Trigger on books
DROP TRIGGER IF EXISTS trg_books_search_vector ON public.books;
CREATE TRIGGER trg_books_search_vector
  BEFORE INSERT OR UPDATE OF title, subtitle, description, specialty, tags, publisher, authors
  ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.books_search_vector_update();

-- GIN index on books
CREATE INDEX IF NOT EXISTS idx_books_search_vector ON public.books USING GIN(search_vector);

-- Backfill existing books
UPDATE public.books SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(specialty, '')), 'C') ||
  setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'), ' ')), 'C') ||
  setweight(to_tsvector('english', coalesce(publisher, '')), 'D') ||
  setweight(to_tsvector('english', array_to_string(coalesce(authors, '{}'), ' ')), 'D');

-- Add search_vector to book_chapters
ALTER TABLE public.book_chapters ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create trigger function for book_chapters
CREATE OR REPLACE FUNCTION public.book_chapters_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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

-- Trigger on book_chapters
DROP TRIGGER IF EXISTS trg_book_chapters_search_vector ON public.book_chapters;
CREATE TRIGGER trg_book_chapters_search_vector
  BEFORE INSERT OR UPDATE OF title, content, tags
  ON public.book_chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.book_chapters_search_vector_update();

-- GIN index on book_chapters
CREATE INDEX IF NOT EXISTS idx_book_chapters_search_vector ON public.book_chapters USING GIN(search_vector);

-- Backfill existing book_chapters
UPDATE public.book_chapters SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(left(content, 500000), '')), 'B') ||
  setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'), ' ')), 'C');
