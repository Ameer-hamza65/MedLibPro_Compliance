
CREATE TABLE public.cart_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  book_id text NOT NULL,
  price numeric NOT NULL,
  book_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cart" ON public.cart_items
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can add to own cart" ON public.cart_items
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove from own cart" ON public.cart_items
  FOR DELETE USING (user_id = auth.uid());
