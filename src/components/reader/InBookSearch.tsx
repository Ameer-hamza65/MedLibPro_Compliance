import { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { trackSearch } from '@/lib/analytics';
import type { EpubBook, Chapter } from '@/data/mockEpubData';

interface InBookSearchProps {
  book: EpubBook;
  /** Called when a result is clicked. Pass the matched chapter so the parent can navigate. */
  onJumpToChapter: (chapter: Chapter) => void;
  /** Currently active chapter id, for visually flagging the result row. */
  currentChapterId?: string;
}

interface SnippetMatch {
  chapter: Chapter;
  snippet: string;
  matches: number;
}

/** Strip HTML tags & collapse whitespace for snippet generation. */
function htmlToPlain(html: string): string {
  if (!html) return '';
  // Cheap & fast — we don't need a parser for snippet text.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '\"')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a ~140-char snippet centered on the first match, with the query highlighted via <mark>. */
function buildSnippet(plain: string, query: string, length = 140): string {
  if (!plain || !query) return '';
  const lowerPlain = plain.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerPlain.indexOf(lowerQuery);
  if (idx === -1) return escapeHtml(plain.slice(0, length)) + (plain.length > length ? '…' : '');

  const radius = Math.floor((length - query.length) / 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(plain.length, idx + query.length + radius);
  const slice = plain.slice(start, end);
  const escaped = escapeHtml(slice);

  // Highlight every case-insensitive occurrence of the query inside the snippet.
  const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const highlighted = escaped.replace(re, '<mark class="bg-yellow-200 text-slate-900 rounded-sm px-0.5">$1</mark>');

  return `${start > 0 ? '…' : ''}${highlighted}${end < plain.length ? '…' : ''}`;
}

export function InBookSearch({ book, onJumpToChapter, currentChapterId }: InBookSearchProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searching, setSearching] = useState(false);

  // Debounce the query (200ms is enough for purely client-side scans).
  useEffect(() => {
    if (!query.trim()) {
      setDebounced('');
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      setDebounced(query.trim());
      setSearching(false);
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

  // Pre-compute plain-text per chapter once per book — keeps subsequent searches snappy.
  const plainByChapterId = useMemo(() => {
    const map = new Map<string, string>();
    book.tableOfContents.forEach((ch) => {
      map.set(ch.id, htmlToPlain(ch.content || ''));
    });
    return map;
  }, [book.id, book.tableOfContents]);

  const results: SnippetMatch[] = useMemo(() => {
    if (!debounced) return [];
    const q = debounced.toLowerCase();
    const out: SnippetMatch[] = [];

    for (const ch of book.tableOfContents) {
      const plain = plainByChapterId.get(ch.id) || '';
      const titleHit = ch.title.toLowerCase().includes(q);
      const lower = plain.toLowerCase();

      if (!titleHit && !lower.includes(q)) continue;

      // Count occurrences (cap to avoid huge work on enormous chapters)
      let matches = 0;
      let from = 0;
      while (matches < 50) {
        const found = lower.indexOf(q, from);
        if (found === -1) break;
        matches++;
        from = found + q.length;
      }
      if (titleHit) matches += 1;

      out.push({
        chapter: ch,
        snippet: buildSnippet(plain || ch.title, debounced, 140),
        matches,
      });
    }

    out.sort((a, b) => b.matches - a.matches);
    return out.slice(0, 30);
  }, [debounced, book.tableOfContents, plainByChapterId]);

  const handleClear = useCallback(() => {
    setQuery('');
    setDebounced('');
  }, []);

  const totalMatches = useMemo(() => results.reduce((acc, r) => acc + r.matches, 0), [results]);

  // Log the in-book search exactly once per debounced query
  useEffect(() => {
    if (!debounced) return;
    trackSearch(debounced, 'in_book', { resultCount: results.length, bookId: book.id });
    // We intentionally don't depend on results.length to avoid double-logging during the same query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, book.id]);

  return (
    <div className="border-b border-border/50 bg-card">
      {/* Sticky search input */}
      <div className="px-3 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inside this text..."
            className="h-8 pl-8 pr-8 text-xs bg-background border-border focus-visible:ring-blue-500"
            aria-label="Search inside this book"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Clear search"
            >
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Result-count meta line */}
        {debounced && !searching && (
          <p className="text-[10px] text-muted-foreground mt-1.5 px-0.5">
            {results.length === 0
              ? 'No matches in this book.'
              : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} across ${results.length} chapter${results.length === 1 ? '' : 's'}`}
          </p>
        )}
      </div>

      {/* Snippet results — only rendered while a query is active */}
      {debounced && results.length > 0 && (
        <div className="border-t border-border/40 bg-slate-50/60">
          <ScrollArea className="max-h-[40vh]">
            <div className="p-2 space-y-1.5">
              {results.map((r) => {
                const isCurrent = r.chapter.id === currentChapterId;
                return (
                  <button
                    key={r.chapter.id}
                    type="button"
                    onClick={() => onJumpToChapter(r.chapter)}
                    className={cn(
                      'w-full text-left rounded-md border p-2.5 transition-all hover:shadow-sm',
                      isCurrent
                        ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                        : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/40',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className={cn(
                        'text-xs font-semibold line-clamp-2',
                        isCurrent ? 'text-blue-900' : 'text-slate-800',
                      )}>
                        {r.chapter.title}
                      </p>
                      <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-700 text-white">
                        {r.matches}
                      </span>
                    </div>
                    <p
                      className="text-[11px] text-slate-600 leading-snug line-clamp-3"
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
