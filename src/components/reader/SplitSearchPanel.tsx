import { useState, useCallback, useMemo, useRef } from 'react';
import { Search, Sparkles, Loader2, BookOpen, FileText, ArrowRight, ArrowLeft, X, PanelRightClose, Globe, Home, BookMarked, Shield, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBar, SearchFilters } from '@/components/SearchBar';
import { ContentRenderer } from '@/components/reader/ContentRenderer';
import { chunkChapterContent } from '@/lib/chunkContent';
import { supabase } from '@/integrations/supabase/client';
import { useBooks } from '@/context/BookContext';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/hooks/use-toast';
import type { Chapter } from '@/data/mockEpubData';

interface SplitSearchPanelProps {
  currentBookId: string;
  currentChapterId: string;
  onNavigateChapter: (bookId: string, chapterId: string) => void;
  onClose: () => void;
}

interface SearchResult {
  bookId: string;
  title: string;
  reason: string;
  specialty: string;
  collection?: string | null;
  relevanceScore?: number;
  chapters?: Array<{ id: string; title: string; reason: string }>;
}

interface PreviewContent {
  bookId: string;
  bookTitle: string;
  chapter: Chapter;
}

const QUICK_LINKS = [
  { label: 'Home', icon: Home, path: '/' },
  { label: 'Library', icon: BookMarked, path: '/library' },
  { label: 'Collections', icon: Shield, path: '/collections' },
];

export function SplitSearchPanel({ currentBookId, currentChapterId, onNavigateChapter, onClose }: SplitSearchPanelProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number | null>(null);
  const [iframeSrc, setIframeSrc] = useState(`${window.location.origin}/?embedded=true`);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { books } = useBooks();
  const { user } = useUser();
  const { toast } = useToast();

  const handleSearch = useCallback(async (query: string, filters?: SearchFilters) => {
    if (!query.trim()) return;
    setHasSearched(true);
    setLoading(true);
    setResults([]);
    setPreview(null);

    try {
      const bookCatalog = books.map(b => ({
        id: b.id, title: b.title, specialty: b.specialty, publisher: b.publisher,
        edition: b.edition, description: b.description?.slice(0, 200) || '',
        tags: b.tags?.slice(0, 8) || [], year: b.publishedYear,
        chapters: b.tableOfContents.slice(0, 15).map(ch => ({ id: ch.id, title: ch.title })),
      }));

      const { data, error } = await supabase.functions.invoke('gemini-ai', {
        body: {
          prompt: query, filters, chapterContent: JSON.stringify(bookCatalog),
          chapterTitle: 'Book Catalog', bookTitle: 'Compliance Collections Library',
          type: 'search', userId: user.id || null, enterpriseId: user.enterpriseId || null,
        },
      });

      if (error) {
        toast({ title: 'Search Error', description: 'Failed to search. Try again.', variant: 'destructive' });
        return;
      }

      if (data?.results && Array.isArray(data.results)) {
        setResults(data.results.slice(0, 8).map((r: any) => ({
          bookId: r.bookId || '', title: r.title || '', reason: r.reason || '',
          specialty: r.specialty || '', collection: r.collection || null,
          relevanceScore: r.relevanceScore || 0, chapters: r.chapters || [],
        })));
      }
    } catch {
      toast({ title: 'Search Error', description: 'Something went wrong.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [books, user.id, user.enterpriseId, toast]);

  const handleOpenPreview = useCallback((bookId: string, chapterId: string) => {
    const book = books.find(b => b.id === bookId);
    if (!book) return;
    const chapter = book.tableOfContents.find(c => c.id === chapterId);
    if (!chapter) return;
    setPreview({ bookId, bookTitle: book.title, chapter });
    setActiveChunkIndex(null);
  }, [books]);

  const handleOpenInReader = useCallback(() => {
    if (!preview) return;
    onNavigateChapter(preview.bookId, preview.chapter.id);
    setPreview(null);
  }, [preview, onNavigateChapter]);

  const previewChunks = useMemo(() => {
    if (!preview?.chapter?.content) return [];
    return chunkChapterContent(preview.chapter.id, preview.chapter.content);
  }, [preview]);

  const navigateIframe = useCallback((path: string) => {
    const url = `${window.location.origin}${path}${path.includes('?') ? '&' : '?'}embedded=true`;
    setIframeSrc(url);
  }, []);

  const currentBook = books.find(b => b.id === currentBookId);

  // ── Preview mode ──
  if (preview) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/30">
          <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setPreview(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /><span className="text-xs">Back</span>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground truncate">{preview.bookTitle}</p>
            <p className="text-xs font-semibold text-foreground truncate">{preview.chapter.title}</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1 h-7 px-2 text-xs" onClick={handleOpenInReader}>
            <PanelRightClose className="h-3.5 w-3.5" />Open in Reader
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-6">
            {preview.chapter.tags && preview.chapter.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {preview.chapter.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            )}
            {previewChunks.length > 0 ? (
              <ContentRenderer chunks={previewChunks} fontSize={14} highlights={[]} annotations={[]}
                activeChunkIndex={activeChunkIndex} onChunkClick={setActiveChunkIndex}
                onHighlight={() => {}} onAnnotate={() => {}} highlightColor="#fde68a" />
            ) : (
              <div className="text-center py-8">
                <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No content available for this chapter.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Default mode ──
  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Search & Resources</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Mini nav bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50 bg-muted/30">
        {QUICK_LINKS.map(({ label, icon: Icon, path }) => (
          <Button key={path} variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
            onClick={() => navigateIframe(path)}>
            <Icon className="h-3 w-3" />{label}
          </Button>
        ))}
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto"
          onClick={() => { if (iframeRef.current) iframeRef.current.src = iframeSrc; }}>
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
      {/* Iframe fills the rest */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full h-full border-0"
          title="Browse site"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
