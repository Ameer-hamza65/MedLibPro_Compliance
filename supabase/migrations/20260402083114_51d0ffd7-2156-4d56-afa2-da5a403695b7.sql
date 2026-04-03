-- Remove duplicate books, keeping the oldest entry for each file_path
DELETE FROM books
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY created_at ASC) as rn
    FROM books
  ) ranked
  WHERE rn > 1
);