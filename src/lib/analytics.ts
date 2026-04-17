// Lightweight client-side analytics tracker.
// All inserts are best-effort — failures are swallowed so they never break the UX.
import { supabase } from '@/integrations/supabase/client';

async function getCurrentIds() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    let enterpriseId: string | null = null;
    if (userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('enterprise_id')
        .eq('id', userId)
        .maybeSingle();
      enterpriseId = (profile?.enterprise_id as string | null) ?? null;
    }
    return { userId, enterpriseId };
  } catch {
    return { userId: null, enterpriseId: null };
  }
}

export async function trackBookView(bookId: string, bookTitle: string) {
  const { userId, enterpriseId } = await getCurrentIds();
  supabase.from('usage_events').insert({
    event_type: 'book_view',
    book_id: bookId,
    book_title: bookTitle,
    user_id: userId,
    enterprise_id: enterpriseId,
  }).then(() => {}, () => {});
}

export async function trackReaderOpen(bookId: string, bookTitle: string, source: 'individual' | 'collection' = 'individual') {
  const { userId, enterpriseId } = await getCurrentIds();
  supabase.from('usage_events').insert({
    event_type: 'reader_open',
    book_id: bookId,
    book_title: bookTitle,
    user_id: userId,
    enterprise_id: enterpriseId,
    metadata: { source },
  }).then(() => {}, () => {});
}

export async function trackSearch(
  query: string,
  source: 'discovery' | 'in_book' | 'homepage',
  opts: { resultCount?: number; bookId?: string } = {},
) {
  const term = query.trim();
  if (!term || term.length < 2) return;
  const { userId, enterpriseId } = await getCurrentIds();
  supabase.from('search_queries').insert({
    query: term,
    source,
    result_count: opts.resultCount ?? null,
    book_id: opts.bookId ?? null,
    user_id: userId,
    enterprise_id: enterpriseId,
  }).then(() => {}, () => {});
}
