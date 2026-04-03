-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Service role can upload book images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete book images" ON storage.objects;

-- Recreate with proper auth check (service role key bypasses RLS anyway,
-- but this prevents anonymous uploads)
CREATE POLICY "Authenticated users can upload book images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'book-images');

CREATE POLICY "Authenticated users can delete book images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'book-images');