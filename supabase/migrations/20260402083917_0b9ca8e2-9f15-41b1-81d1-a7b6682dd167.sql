-- Create a public bucket for book images extracted from EPUBs
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-images', 'book-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to book images
CREATE POLICY "Book images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'book-images');

-- Allow service role (edge functions) to insert images
CREATE POLICY "Service role can upload book images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'book-images');

-- Allow service role to delete book images (for re-processing)
CREATE POLICY "Service role can delete book images"
ON storage.objects
FOR DELETE
USING (bucket_id = 'book-images');