import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared hook that resolves the full chapter text from the database.
 * Both the left sidebar AI and the right AI panel consume this
 * so they always operate on the same context.
 */
export function useChapterContext({
  bookId,
  epubCurrentHref,
  tocLabel,
  chapterTitle,
  visibleText,
}: {
  bookId: string | undefined;
  epubCurrentHref: string;
  tocLabel: string;
  chapterTitle: string;
  visibleText: string;
}) {
  const [resolvedContent, setResolvedContent] = useState('');
  const [resolvedTitle, setResolvedTitle] = useState('');
  const lastKey = useRef('');
  const resolvedContentRef = useRef('');
  const isFetching = useRef(false);

  // Build a stable cache key from the chapter-identifying inputs (NOT visibleText)
  const cacheKey = `${bookId || ''}|${epubCurrentHref}|${tocLabel}|${chapterTitle}`;

  useEffect(() => {
    // Skip if already resolved for this chapter
    if (cacheKey === lastKey.current && resolvedContentRef.current.length > 200) return;
    if (isFetching.current) return;

    let cancelled = false;
    isFetching.current = true;

    (async () => {
      if (!bookId) {
        if (!cancelled) {
          resolvedContentRef.current = visibleText;
          setResolvedContent(visibleText);
          setResolvedTitle(tocLabel || chapterTitle);
          lastKey.current = cacheKey;
        }
        isFetching.current = false;
        return;
      }

      let fetchedContent = '';
      let fetchedTitle = tocLabel || chapterTitle;

      try {
        // Strategy 1: Match by chapter_key (EPUB href)
        if (epubCurrentHref) {
          const normalizedKey = epubCurrentHref.replace(/^(OEBPS\/|OPS\/|Text\/)/, '');
          const basePath = normalizedKey.split('#')[0];
          const hrefPath = epubCurrentHref.split('#')[0];

          const candidates = Array.from(new Set([epubCurrentHref, normalizedKey, basePath, hrefPath].filter(Boolean)));

          for (const candidate of candidates) {
            if (cancelled) break;
            const { data } = await supabase
              .from('book_chapters')
              .select('content, title')
              .eq('book_id', bookId)
              .eq('chapter_key', candidate)
              .limit(1);
            if (data?.[0]?.content && data[0].content.length > 100) {
              fetchedContent = data[0].content;
              fetchedTitle = data[0].title || fetchedTitle;
              break;
            }
          }

          // Try ilike as last resort for chapter_key
          if (!fetchedContent && basePath && !cancelled) {
            const { data } = await supabase
              .from('book_chapters')
              .select('content, title')
              .eq('book_id', bookId)
              .ilike('chapter_key', `%${basePath}%`)
              .limit(1);
            if (data?.[0]?.content && data[0].content.length > 100) {
              fetchedContent = data[0].content;
              fetchedTitle = data[0].title || fetchedTitle;
            }
          }
        }

        // Strategy 2: Match by title
        if (!fetchedContent && !cancelled) {
          const titleCandidates = Array.from(new Set(
            [tocLabel, chapterTitle]
              .map(t => t?.replace(/\s+/g, ' ').trim())
              .filter((t): t is string => !!t && t !== 'Chapter' && t.length > 2)
          ));

          for (const title of titleCandidates) {
            if (cancelled) break;
            const { data } = await supabase
              .from('book_chapters')
              .select('content, title')
              .eq('book_id', bookId)
              .ilike('title', `%${title.slice(0, 60)}%`)
              .order('sort_order', { ascending: true })
              .limit(1);
            if (data?.[0]?.content && data[0].content.length > 100) {
              fetchedContent = data[0].content;
              fetchedTitle = data[0].title || fetchedTitle;
              break;
            }
          }
        }

        // Strategy 3: Fetch first chapters as broad fallback
        if (!fetchedContent && !cancelled) {
          const { data } = await supabase
            .from('book_chapters')
            .select('content, title')
            .eq('book_id', bookId)
            .order('sort_order', { ascending: true })
            .limit(5);
          if (data && data.length > 0) {
            fetchedContent = data.map(r => r.content || '').join('\n\n');
            fetchedTitle = fetchedTitle || data[0].title || 'Chapter';
          }
        }
      } catch {
        // Fall back to visible text
      }

      if (cancelled) {
        isFetching.current = false;
        return;
      }

      // Use DB content if it's substantial, otherwise fall back to visible text
      const best = (fetchedContent && fetchedContent.length > 100) ? fetchedContent : visibleText;

      resolvedContentRef.current = best;
      setResolvedContent(best);
      setResolvedTitle(fetchedTitle);
      lastKey.current = cacheKey;
      isFetching.current = false;
    })();

    return () => { cancelled = true; isFetching.current = false; };
  }, [cacheKey, bookId, epubCurrentHref, tocLabel, chapterTitle, visibleText]);

  return { resolvedContent, resolvedTitle };
}
