-- Allow anyone (including anonymous/not-logged-in users) to view the books catalog
CREATE POLICY "Anyone can view books"
  ON public.books
  FOR SELECT
  TO anon
  USING (true);