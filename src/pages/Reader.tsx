import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, X, BookOpen, Bookmark, BookmarkCheck, Share2, MessageSquare, BarChart3, Highlighter, ZoomIn, ZoomOut, PanelRightOpen, PanelRightClose, ChevronLeft, ChevronRight, PanelLeftOpen, PanelLeftClose, Eye, EyeOff, ArrowUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ContentRenderer } from '@/components/reader/ContentRenderer';
import { EpubReader } from '@/components/reader/EpubReader';
import { PdfReader } from '@/components/reader/PdfReader';
import type { PdfTocItem } from '@/hooks/usePdfReader';
import { BookInfoPage } from '@/components/reader/BookInfoPage';
import { AIPanel } from '@/components/reader/AIPanel';
import { AnalyticsPanel } from '@/components/reader/AnalyticsPanel';
import { OutlineSidebar } from '@/components/reader/OutlineSidebar';
import { HighlightsPanel } from '@/components/reader/HighlightsPanel';
import { SplitSearchPanel } from '@/components/reader/SplitSearchPanel';
import { RelatedChapters } from '@/components/reader/RelatedChapters';
import { ReadingPreferences, useReadingPrefs, getContentStyles } from '@/components/reader/ReadingPreferences';
import { ReadingProgressBar, ChapterProgressDots } from '@/components/reader/ReadingProgress';
import { chunkChapterContent } from '@/lib/chunkContent';
import { useReadingSession } from '@/hooks/useReadingSession';
import { useAnnotations } from '@/hooks/useAnnotations';
import { useUser } from '@/context/UserContext';
import { useBooks } from '@/context/BookContext';
import type { Chapter } from '@/data/mockEpubData';
import type { EpubTocItem } from '@/hooks/useEpubReader';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

function flattenEpubToc(items: EpubTocItem[]): EpubTocItem[] {
  return items.flatMap((item) => [item, ...flattenEpubToc(item.subitems || [])]);
}

function getPreferredEpubHref(items: EpubTocItem[]): string {
  const flattened = flattenEpubToc(items).filter((item) => item.href);
  const preferred = flattened.find((item) => !/cover|title page|copyright|contents|table of contents|front matter/i.test(item.label));
  return preferred?.href || flattened[0]?.href || '';
}

function safeDecodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function normalizeEpubHref(href: string) {
  const decoded = safeDecodeHref(href || '').replace(/^\/+/, '').replace(/^\.\//, '').trim();
  const [path = '', fragment = ''] = decoded.split('#');
  return {
    path: path.toLowerCase(),
    fragment: fragment.toLowerCase(),
    full: `${path.toLowerCase()}#${fragment.toLowerCase()}`,
  };
}

function findMatchingEpubTocItem(items: EpubTocItem[], targetHref: string): EpubTocItem | undefined {
  const flattened = flattenEpubToc(items);
  const target = normalizeEpubHref(targetHref);
  const exact = flattened.find((item) => normalizeEpubHref(item.href).full === target.full);
  if (exact) return exact;

  const samePathItems = flattened.filter((item) => normalizeEpubHref(item.href).path === target.path);
  return samePathItems
    .filter((item) => {
      const fragment = normalizeEpubHref(item.href).fragment;
      return !fragment || fragment === target.fragment || target.fragment.startsWith(fragment);
    })
    .sort((a, b) => normalizeEpubHref(b.href).fragment.length - normalizeEpubHref(a.href).fragment.length)[0] || samePathItems[0];
}

function flattenPdfToc(items: PdfTocItem[]): PdfTocItem[] {
  return items.flatMap((item) => [item, ...flattenPdfToc(item.subitems)]);
}

function findMatchingPdfTocItem(items: PdfTocItem[], currentPage: number): PdfTocItem | undefined {
  const flattened = flattenPdfToc(items).sort((a, b) => a.pageNumber - b.pageNumber);
  let active = flattened[0];
  for (const item of flattened) {
    if (item.pageNumber <= currentPage) active = item;
    else break;
  }
  return active;
}

function clampOutlinePanelSize(size: number) {
  if (!Number.isFinite(size)) return 20;
  return Math.max(12, Math.min(35, size));
}

export default function Reader() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, hasFullAccess } = useUser();
  const { books } = useBooks();

  const bookId = searchParams.get('book') || '';
  const chapterId = searchParams.get('chapter') || '';
  const chapterTitleParam = searchParams.get('chapterTitle') || '';
  const isBookInfoPage = chapterId === '__book-info__';
  const isAutoOpenFirstChapter = chapterId === '__first__';
  const isFindByTitle = chapterId === '__find__';
  const epubChapterHref = useMemo(() => {
    if (!chapterId || isBookInfoPage || isAutoOpenFirstChapter || isFindByTitle) return '';
    if (chapterId.startsWith('epub:')) {
      return decodeURIComponent(chapterId.slice(5));
    }
    return decodeURIComponent(chapterId);
  }, [chapterId, isBookInfoPage, isAutoOpenFirstChapter, isFindByTitle]);
  const pdfTargetPage = useMemo(() => {
    if (!chapterId || isBookInfoPage || isAutoOpenFirstChapter || isFindByTitle) return undefined;
    if (!chapterId.startsWith('pdf:')) return undefined;
    const decodedValue = decodeURIComponent(chapterId.slice(4));
    const [pagePart, offsetPart] = decodedValue.split('@');
    const parsedPage = Number.parseInt(pagePart, 10);
    const parsedOffset = offsetPart ? Number.parseFloat(offsetPart) : undefined;
    if (!Number.isFinite(parsedPage) || parsedPage <= 0) return undefined;
    return {
      pageNumber: parsedPage,
      topOffset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    };
  }, [chapterId, isBookInfoPage, isAutoOpenFirstChapter, isFindByTitle]);

  const book = useMemo(
    () => books.find((b) => b.id === bookId),
    [books, bookId],
  );

  // Determine if this book should use EPUB.js or PDF.js (has a file in storage)
  const useEpubJs = !!(book?.filePath && book.fileType === 'epub');
  const usePdfJs = !!(book?.filePath && book.fileType === 'pdf');
  const useNativeRenderer = useEpubJs || usePdfJs;

  const chapter = useMemo(() => {
    if (!book || !book.tableOfContents || book.tableOfContents.length === 0) {
      if (useNativeRenderer && !isBookInfoPage) {
        return {
          id: chapterId || 'epub-chapter',
          title: chapterTitleParam || 'Chapter',
          content: '',
          pageNumber: 0,
          tags: [],
        } as Chapter;
      }
      return undefined;
    }
    if (isBookInfoPage) {
      return { id: '__book-info__', title: 'Book Information', content: '', pageNumber: 0, tags: [] } as Chapter;
    }
    if (isFindByTitle) {
      // For EPUB find-by-title, return a stub chapter — EPUB.js renders content
      return {
        id: 'epub-find',
        title: chapterTitleParam || 'Chapter',
        content: '',
        pageNumber: 0,
        tags: [],
      } as Chapter;
    }
    if (chapterId) return book.tableOfContents.find(c => c.id === chapterId);
    return { id: '__book-info__', title: 'Book Information', content: '', pageNumber: 0, tags: [] } as Chapter;
  }, [book, chapterId, isBookInfoPage, useNativeRenderer, isFindByTitle, chapterTitleParam]);

  useEffect(() => {
    if (book && !useNativeRenderer && book.tableOfContents && book.tableOfContents.length > 0 && !chapterId && chapter) {
      navigate(`/reader?book=${bookId}&chapter=__book-info__`, { replace: true });
    }
    // For native renderer books without a chapter param, go to book info
    if (book && useNativeRenderer && !chapterId) {
      navigate(`/reader?book=${bookId}&chapter=__book-info__`, { replace: true });
    }
  }, [book, bookId, chapterId, chapter, navigate, useNativeRenderer]);

  useEffect(() => {
    if (useNativeRenderer) return;

    const viewport = document.querySelector('[data-reader-content-scroll] [data-radix-scroll-area-viewport]');
    if (viewport instanceof HTMLElement) {
      viewport.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [bookId, chapterId, useNativeRenderer]);

  // Reading preferences (font, theme, focus mode)
  const { prefs, updatePrefs } = useReadingPrefs();

  const [rightPanel, setRightPanel] = useState<string | null>(null);
  const [showOutline, setShowOutline] = useState(true);
  const outlineWidthRef = useRef(
    clampOutlinePanelSize(
      typeof window !== 'undefined'
        ? Number(sessionStorage.getItem('reader-outline-width') ?? 20)
        : 20,
    ),
  );
  const [isOutlineDragging, setIsOutlineDragging] = useState(false);
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number | null>(null);
  const [viewedChunks, setViewedChunks] = useState<Set<number>>(new Set([0]));
  const [scrollProgress, setScrollProgress] = useState(0);

  // Sidebar AI state
  const [sidebarAILoading, setSidebarAILoading] = useState(false);
  const [sidebarAIAnswer, setSidebarAIAnswer] = useState<string | undefined>(undefined);

  // EPUB.js specific state
  const [epubToc, setEpubToc] = useState<EpubTocItem[]>([]);
  const [epubVisibleText, setEpubVisibleText] = useState<string>('');
  const [epubCurrentHref, setEpubCurrentHref] = useState<string>('');
  const epubNavigationNonceRef = useRef(0);
  const [epubNavigationRequest, setEpubNavigationRequest] = useState<{ bookId: string; href: string; nonce: number } | null>(null);

  // PDF.js specific state
  const [pdfToc, setPdfToc] = useState<PdfTocItem[]>([]);
  const [pdfVisibleText, setPdfVisibleText] = useState<string>('');
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number>(1);
  const [pdfNavigationNonce, setPdfNavigationNonce] = useState(0);

  const requestEpubNavigation = useCallback((href: string) => {
    if (!href || !book) return;
    epubNavigationNonceRef.current += 1;
    setEpubNavigationRequest({ bookId: book.id, href, nonce: epubNavigationNonceRef.current });
  }, [book]);

  useEffect(() => {
    epubNavigationNonceRef.current = 0;
    setEpubNavigationRequest(null);
    setEpubCurrentHref('');
    hasInitializedEpubNavRef.current = false;
  }, [bookId]);

  // URL-sync effect — only for initial load / deep-link, not for TOC clicks
  const hasInitializedEpubNavRef = useRef(false);
  useEffect(() => {
    if (!useEpubJs || !book || !epubChapterHref) return;
    if (hasInitializedEpubNavRef.current) return;
    hasInitializedEpubNavRef.current = true;
    requestEpubNavigation(epubChapterHref);
    setEpubCurrentHref(epubChapterHref);
  }, [useEpubJs, book, epubChapterHref, requestEpubNavigation]);

  const activeEpubTocItem = useMemo(
    () => (useEpubJs ? findMatchingEpubTocItem(epubToc, epubCurrentHref || epubChapterHref) : undefined),
    [useEpubJs, epubToc, epubCurrentHref, epubChapterHref],
  );

  const activePdfTocItem = useMemo(
    () => (usePdfJs ? findMatchingPdfTocItem(pdfToc, pdfCurrentPage) : undefined),
    [usePdfJs, pdfToc, pdfCurrentPage],
  );

  // When navigating from search results by chapter title, find matching TOC entry
  const findByTitleDone = useRef(false);
  useEffect(() => {
    if (!isFindByTitle || !chapterTitleParam || epubToc.length === 0 || findByTitleDone.current) return;
    const normalizedTarget = chapterTitleParam.toLowerCase().trim().replace(/\s+/g, ' ');
    // Try exact match first, then substring, then word overlap
    const match = epubToc.find(t => t.label.toLowerCase().trim() === normalizedTarget)
      || epubToc.find(t => t.label.toLowerCase().trim().includes(normalizedTarget))
      || epubToc.find(t => normalizedTarget.includes(t.label.toLowerCase().trim()))
      || epubToc.find(t => {
        const words = normalizedTarget.split(/\s+/).filter(w => w.length > 2);
        const label = t.label.toLowerCase();
        return words.filter(w => label.includes(w)).length >= Math.ceil(words.length * 0.5);
      });
    if (match) {
      findByTitleDone.current = true;
      setEpubCurrentHref(match.href);
      // Also update URL so the chapter persists on refresh
      if (book) {
        navigate(`/reader?book=${bookId}&chapter=epub:${encodeURIComponent(match.href)}`, { replace: true });
      }
    }
  }, [isFindByTitle, chapterTitleParam, epubToc, book, bookId, navigate]);

  const { stats, trackEvent, formatTime } = useReadingSession(bookId, chapterId);
  const {
    highlights, annotations, bookmarks,
    activeHighlightColor, highlightColors,
    setActiveHighlightColor,
    addHighlight, removeHighlight,
    addAnnotation, removeAnnotation,
    toggleBookmark, isBookmarked,
  } = useAnnotations(bookId, chapterId);

  const chunks = useMemo(() => {
    if (useNativeRenderer) return []; // Not needed for native renderer mode
    if (!chapter) return [];
    if (!chapter.content || chapter.content.trim().length === 0) return [];
    return chunkChapterContent(chapter.id, chapter.content, chapter.title, chapter.category);
  }, [chapter, useNativeRenderer]);

  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    if (!book) { redirected.current = true; navigate('/library'); return; }
    if (!useNativeRenderer && !chapter) {
      if (book.tableOfContents.length === 0) return;
      redirected.current = true;
      navigate('/library');
      return;
    }
  }, [book, chapter, bookId, navigate, useNativeRenderer]);

  // Track scroll progress
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight > el.clientHeight) {
      const pct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
      setScrollProgress(Math.min(100, pct));
    }
  }, []);

  const handleChunkClick = useCallback((index: number) => {
    setActiveChunkIndex(index);
    setViewedChunks(prev => new Set(prev).add(index));
    trackEvent('page_view', { chunkIndex: index });
  }, [trackEvent]);

  const handleHighlight = useCallback((text: string, chunkIndex: number) => {
    addHighlight(text, chunkIndex);
    trackEvent('highlight', { text: text.slice(0, 50), chunkIndex });
  }, [addHighlight, trackEvent]);

  // EPUB.js highlight handler (uses CFI instead of chunk index)
  const handleEpubHighlight = useCallback((text: string, cfi: string) => {
    addHighlight(text, 0); // chunk_index = 0 as fallback, CFI stored separately
    trackEvent('highlight', { text: text.slice(0, 50), cfi });
  }, [addHighlight, trackEvent]);

  const handleAnnotate = useCallback((text: string, note: string, chunkIndex: number) => {
    addAnnotation(text, note, chunkIndex);
    trackEvent('annotation', { text: text.slice(0, 50), chunkIndex });
  }, [addAnnotation, trackEvent]);

  // EPUB.js annotate handler
  const handleEpubAnnotate = useCallback((text: string, note: string, cfi: string) => {
    addAnnotation(text, note, 0);
    trackEvent('annotation', { text: text.slice(0, 50), cfi });
  }, [addAnnotation, trackEvent]);

  // PDF.js highlight handler
  const handlePdfHighlight = useCallback((text: string, page: number) => {
    addHighlight(text, 0);
    trackEvent('highlight', { text: text.slice(0, 50), page });
  }, [addHighlight, trackEvent]);

  // PDF.js annotate handler
  const handlePdfAnnotate = useCallback((text: string, note: string, page: number) => {
    addAnnotation(text, note, 0);
    trackEvent('annotation', { text: text.slice(0, 50), page });
  }, [addAnnotation, trackEvent]);

  const handleToggleBookmark = useCallback(() => {
    if (!book || !chapter) return;
    toggleBookmark(book.id, chapter.id, chapter.title, book.title);
    trackEvent('bookmark', { chapterId: chapter.id });
  }, [book, chapter, toggleBookmark, trackEvent]);

  const handleNavigateChapter = useCallback((ch: Chapter) => {
    if (!book) return;
    navigate(`/reader?book=${book.id}&chapter=${ch.id}`);
    setActiveChunkIndex(null);
    setViewedChunks(new Set([0]));
    setScrollProgress(0);
  }, [book, navigate]);

  const handleToggleRightPanel = useCallback((panel: string) => {
    setRightPanel(prev => prev === panel ? null : panel);
  }, []);

  const handleToggleSplitScreen = useCallback(() => {
    setIsSplitScreen(prev => !prev);
  }, []);

  const handleOutlineResize = useCallback((size: number) => {
    const nextSize = clampOutlinePanelSize(size);
    outlineWidthRef.current = nextSize;
    sessionStorage.setItem('reader-outline-width', String(nextSize));
  }, []);

  useEffect(() => {
    document.body.classList.toggle('resize-dragging', isOutlineDragging);
    document.body.style.userSelect = isOutlineDragging ? 'none' : '';
    document.body.style.cursor = isOutlineDragging ? 'col-resize' : '';

    return () => {
      document.body.classList.remove('resize-dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isOutlineDragging]);

  const handleSplitNavigate = useCallback((bookId: string, chapterId: string) => {
    navigate(`/reader?book=${bookId}&chapter=${chapterId}`);
    setActiveChunkIndex(null);
    setViewedChunks(new Set([0]));
  }, [navigate]);

  const handleJumpToChunk = useCallback((chunkIndex: number) => {
    setActiveChunkIndex(chunkIndex);
    const el = document.getElementById(`chunk-${chunkIndex}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleScrollToHeading = useCallback((headingId: string) => {
    let el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const idx = headingId.match(/heading-(\d+)/)?.[1];
    if (idx !== undefined) {
      const allHeadings = document.querySelectorAll('.prose h2, .prose h3, .prose h4');
      const target = allHeadings[parseInt(idx)];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }, []);

  const handleAIQuery = useCallback(() => {
    trackEvent('ai_query');
  }, [trackEvent]);

  // Sidebar quick AI ask — with DB fallback when visible text is too short
  const handleSidebarAIAsk = useCallback(async (question: string) => {
    setSidebarAILoading(true);
    setSidebarAIAnswer(undefined);
    try {
      let contextText = useEpubJs ? epubVisibleText : usePdfJs ? pdfVisibleText : (chapter?.content || '');

      // DB fallback: if visible text is too short, fetch from book_chapters
      if (contextText.length < 200 && book?.id) {
        try {
          const { data: chapterRows } = await supabase
            .from('book_chapters')
            .select('content')
            .eq('book_id', book.id)
            .order('sort_order', { ascending: true })
            .limit(3);
          if (chapterRows && chapterRows.length > 0) {
            contextText = chapterRows.map(r => r.content || '').join('\n\n').slice(0, 15000);
          }
        } catch { /* use whatever we have */ }
      }

      if (contextText.length < 50) {
        setSidebarAIAnswer('Failed to load chapter content. Please wait for the chapter to fully load, then try again.');
        return;
      }

      const chTitle = useEpubJs
        ? (activeEpubTocItem?.label || 'Chapter')
        : usePdfJs
        ? (activePdfTocItem?.label || `Page ${pdfCurrentPage}`)
        : (chapter?.title || '');

      const { data, error } = await supabase.functions.invoke('gemini-ai', {
        body: {
          prompt: question,
          chapterContent: contextText.slice(0, 15000),
          chapterTitle: chTitle,
          bookTitle: book?.title || '',
          type: 'qa',
          bookId: book?.id || '',
          chapterId: chapter?.id || '',
        },
      });
      if (error) throw error;
      setSidebarAIAnswer(data?.content || data?.answer || 'No response received.');
    } catch (err: any) {
      const msg = err?.message?.includes('429')
        ? 'Rate limit exceeded. Please wait a moment and try again.'
        : 'Failed to get AI response. Please try again.';
      setSidebarAIAnswer(msg);
    } finally {
      setSidebarAILoading(false);
      trackEvent('ai_query');
    }
  }, [useEpubJs, usePdfJs, epubVisibleText, pdfVisibleText, pdfCurrentPage, activeEpubTocItem, activePdfTocItem, chapter, book, trackEvent]);

  // Scroll to top of reader content
  const handleScrollToTop = useCallback(() => {
    const epubContainer = document.getElementById(`epub-container-${bookId}`);
    if (epubContainer) {
      epubContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const viewport = document.querySelector('[data-reader-content-scroll] [data-radix-scroll-area-viewport]');
    if (viewport instanceof HTMLElement) {
      viewport.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [bookId]);

  useEffect(() => {
    if (!book || !useEpubJs || !isAutoOpenFirstChapter || epubToc.length === 0) return;
    const firstHref = getPreferredEpubHref(epubToc);
    if (!firstHref) return;
    const encodedHref = encodeURIComponent(firstHref);
    setEpubCurrentHref(firstHref);
    navigate(`/reader?book=${book.id}&chapter=epub:${encodedHref}`, { replace: true });
  }, [book, useEpubJs, isAutoOpenFirstChapter, epubToc, navigate]);

  const handleEpubTocNavigate = useCallback((href: string) => {
    if (!book || !href) return;
    requestEpubNavigation(href);
    setEpubCurrentHref(href);
    // Use navigate with replace — the hasInitializedEpubNavRef guard prevents double-fire
    navigate(`/reader?book=${book.id}&chapter=epub:${encodeURIComponent(href)}`, { replace: true });
  }, [book, requestEpubNavigation, navigate]);

  const handlePdfTocNavigate = useCallback((item: PdfTocItem) => {
    if (!book) return;
    const chapterValue = item.topOffset != null
      ? `pdf:${item.pageNumber}@${item.topOffset}`
      : `pdf:${item.pageNumber}`;
    navigate(`/reader?book=${book.id}&chapter=${encodeURIComponent(chapterValue)}`);
    setPdfCurrentPage(item.pageNumber);
    setPdfNavigationNonce(n => n + 1);
  }, [book, navigate]);

  if (!chapter && !useNativeRenderer) {
    return (
      <div className="h-[calc(100vh-64px)] flex items-center justify-center bg-background">
        <div className="text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Book is being processed</h2>
          <p className="text-muted-foreground text-sm mb-4">Chapters are still being extracted. Please check back shortly.</p>
          <Button onClick={() => navigate('/library')}>Back to Library</Button>
        </div>
      </div>
    );
  }

  const currentIndex = isBookInfoPage ? -1 : book.tableOfContents.findIndex(c => c.id === chapter?.id);
  const prevChapter = isBookInfoPage ? null : (currentIndex > 0 ? book.tableOfContents[currentIndex - 1] : null);
  const nextChapter = isBookInfoPage ? book.tableOfContents[0] : (currentIndex < book.tableOfContents.length - 1 ? book.tableOfContents[currentIndex + 1] : null);

  const contentStyles = getContentStyles(prefs);

  // Get the chapter content for AI — either from native renderer visible text or DB content
  const aiChapterContent = useEpubJs ? epubVisibleText : usePdfJs ? pdfVisibleText : (chapter?.content || '');
  const aiChapterTitle = useEpubJs
    ? (activeEpubTocItem?.label || chapter?.title || 'Chapter')
    : usePdfJs
    ? (activePdfTocItem?.label || `Page ${pdfCurrentPage}`)
    : (chapter?.title || '');

  // EPUB.js content area — always mount when useEpubJs so TOC loads
  // Use opacity+pointer-events instead of display:none so container has dimensions
  const epubContentAreaJsx = useEpubJs ? (
    <div
      className={cn("h-full", isBookInfoPage && "absolute inset-0 opacity-0 pointer-events-none -z-10")}
      style={isBookInfoPage ? { position: 'absolute', width: '100%', height: '100%' } : undefined}
    >
      <EpubReader
        filePath={book.filePath!}
        bookId={book.id}
        fontSize={prefs.fontSize}
        lineHeight={prefs.lineHeight}
        fontFamily={prefs.fontFamily}
        theme={prefs.theme}
        focusMode={prefs.focusMode}
        navigateToHref={epubNavigationRequest?.bookId === book.id ? epubNavigationRequest.href : epubChapterHref}
        navigateRequestKey={epubNavigationRequest?.bookId === book.id ? epubNavigationRequest.nonce : undefined}
        onTocLoaded={setEpubToc}
        onChapterChange={setEpubCurrentHref}
        onVisibleTextChange={setEpubVisibleText}
        onHighlight={handleEpubHighlight}
        onAnnotate={handleEpubAnnotate}
        highlightColor={activeHighlightColor}
      />
    </div>
  ) : null;

  // PDF.js content area
  const pdfContentAreaJsx = usePdfJs ? (
    <div
      className={cn("h-full", isBookInfoPage && "absolute inset-0 opacity-0 pointer-events-none -z-10")}
      style={isBookInfoPage ? { position: 'absolute', width: '100%', height: '100%' } : undefined}
    >
      <PdfReader
        filePath={book.filePath!}
        bookId={book.id}
        fontSize={prefs.fontSize}
        theme={prefs.theme}
        navigateToPage={pdfTargetPage}
        navigationNonce={pdfNavigationNonce}
        onTocLoaded={setPdfToc}
        onPageChange={setPdfCurrentPage}
        onVisibleTextChange={setPdfVisibleText}
        onHighlight={handlePdfHighlight}
        onAnnotate={handlePdfAnnotate}
        highlightColor={activeHighlightColor}
      />
    </div>
  ) : null;

  // Legacy content area (server-parsed HTML)
  const legacyContentAreaJsx = (
    <ScrollArea data-reader-content-scroll className={cn('h-full', contentStyles.className)} onScrollCapture={handleScroll as any}>
      <div className="p-8 max-w-4xl mx-auto" style={contentStyles.style}>
        {/* Chapter title header */}
        {!isBookInfoPage && (
          <div className="mb-6 pb-4 border-b border-border/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {book.title}
            </p>
            <h1 className="text-2xl font-bold text-foreground">{chapter?.title}</h1>
            {/* Chapter progress dots */}
            <ChapterProgressDots
              chapters={book.tableOfContents}
              currentChapterId={chapter?.id || ''}
              className="mt-3"
            />
          </div>
        )}

        {isBookInfoPage ? (
          <BookInfoPage book={book} epubTocCount={useNativeRenderer ? (useEpubJs ? epubToc.length : pdfToc.length || undefined) : undefined} />
        ) : (
          <>
            {chapter?.tags && chapter.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {chapter.tags.map(tagId => (
                  <span key={tagId} className="medical-tag">{tagId}</span>
                ))}
              </div>
            )}
            <div className={cn(prefs.focusMode && 'focus-mode')}>
              <ContentRenderer
                chunks={chunks}
                fontSize={prefs.fontSize}
                lineHeight={prefs.lineHeight}
                highlights={highlights}
                annotations={annotations}
                activeChunkIndex={activeChunkIndex}
                onChunkClick={handleChunkClick}
                onHighlight={handleHighlight}
                onAnnotate={handleAnnotate}
                highlightColor={activeHighlightColor}
                focusMode={prefs.focusMode}
              />
            </div>
          </>
        )}

        {/* Prev/Next nav */}
        <div className="flex items-center justify-between mt-12 pt-6 border-t border-border/50">
          {prevChapter ? (
            <Button variant="ghost" onClick={() => handleNavigateChapter(prevChapter)} className="text-left">
              <ChevronLeft className="h-4 w-4 mr-2" />
              <div>
                <p className="text-xs text-muted-foreground">Previous</p>
                <p className="text-sm font-medium truncate max-w-48">{prevChapter.title}</p>
              </div>
            </Button>
          ) : <div />}
          {nextChapter ? (
            <Button variant="ghost" onClick={() => handleNavigateChapter(nextChapter)} className="text-right">
              <div>
                <p className="text-xs text-muted-foreground">Next</p>
                <p className="text-sm font-medium truncate max-w-48">{nextChapter.title}</p>
              </div>
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : <div />}
        </div>

        {/* Related Chapters */}
        {!isBookInfoPage && chapter && (
          <RelatedChapters
            chapters={book.tableOfContents}
            currentChapterId={chapter.id}
            currentTags={chapter.tags || []}
            onNavigate={handleNavigateChapter}
          />
        )}
      </div>
    </ScrollArea>
  );

  // Choose which content area to show
  const contentAreaJsx = useEpubJs
    ? (
      <div className="relative h-full">
        {isBookInfoPage && legacyContentAreaJsx}
        {epubContentAreaJsx}
      </div>
    )
    : usePdfJs
    ? (
      <div className="relative h-full">
        {isBookInfoPage && legacyContentAreaJsx}
        {pdfContentAreaJsx}
      </div>
    )
    : legacyContentAreaJsx;

  const centerPanelJsx = (
    <div className={cn('flex h-full min-w-0 flex-1', isOutlineDragging && 'pointer-events-none select-none')}>
      <div className="flex-1 min-w-0">
        {isSplitScreen ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={60} minSize={35}>
              {contentAreaJsx}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40} minSize={25}>
              <SplitSearchPanel
                currentBookId={book.id}
                currentChapterId={chapter?.id || ''}
                onNavigateChapter={handleSplitNavigate}
                onClose={handleToggleSplitScreen}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          contentAreaJsx
        )}
      </div>

      {rightPanel && !isSplitScreen && (
        <div className="w-80 border-l border-border/50 bg-card/50 flex flex-col flex-shrink-0">
          <div className="flex items-center justify-end p-1 border-b border-border/50">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setRightPanel(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            {rightPanel === 'ai' && (
              <AIPanel
                chapterTitle={aiChapterTitle}
                chapterContent={aiChapterContent}
                bookTitle={book.title}
                bookId={book.id}
                chapterId={chapter?.id || ''}
                onAIQuery={handleAIQuery}
              />
            )}
            {rightPanel === 'analytics' && (
              <AnalyticsPanel
                stats={stats}
                formattedTime={formatTime(stats.totalTimeSeconds)}
                totalChunks={useNativeRenderer ? 1 : chunks.length}
                viewedChunks={useNativeRenderer ? 1 : viewedChunks.size}
                bookTitle={book.title}
                chapterTitle={chapter?.title || ''}
              />
            )}
            {rightPanel === 'highlights' && (
              <HighlightsPanel
                highlights={highlights}
                annotations={annotations}
                bookmarks={bookmarks}
                highlightColors={highlightColors}
                activeColor={activeHighlightColor}
                onColorChange={setActiveHighlightColor}
                onRemoveHighlight={removeHighlight}
                onRemoveAnnotation={removeAnnotation}
                onJumpToChunk={handleJumpToChunk}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-background">
      {/* Reading progress bar at very top */}
      <ReadingProgressBar
        totalChapters={useNativeRenderer ? (useEpubJs ? epubToc.length : pdfToc.length || 1) : book.tableOfContents.length}
        currentChapterIndex={currentIndex >= 0 ? currentIndex : 0}
        scrollProgress={scrollProgress}
      />

      {/* Top toolbar */}
      <div className="border-b border-border/50 bg-card/95 backdrop-blur px-3 py-1.5 flex items-center justify-between gap-2 flex-shrink-0">
        {/* Left: Back + outline toggle */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 h-8">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Back</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showOutline ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowOutline(prev => !prev)}
              >
                {showOutline ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showOutline ? 'Hide Outline' : 'Show Outline'}</TooltipContent>
          </Tooltip>
        </div>

        {/* Center: chapter title + page nav */}
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          {!useNativeRenderer && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!prevChapter} onClick={prevChapter ? () => handleNavigateChapter(prevChapter) : undefined}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous Chapter</TooltipContent>
            </Tooltip>
          )}
          <div className="text-center min-w-0">
            <p className="text-sm font-semibold truncate">
              {useEpubJs && !isBookInfoPage
                ? (activeEpubTocItem?.label || book.title)
                : usePdfJs && !isBookInfoPage
                ? (activePdfTocItem?.label || `Page ${pdfCurrentPage}`)
                : chapter?.title}
            </p>
          </div>
          {!useNativeRenderer && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!nextChapter} onClick={nextChapter ? () => handleNavigateChapter(nextChapter) : undefined}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next Chapter</TooltipContent>
            </Tooltip>
          )}
          {!useNativeRenderer && chapter && chapter.pageNumber > 0 && (
            <Badge variant="secondary" className="text-xs flex-shrink-0">p.{chapter.pageNumber}</Badge>
          )}
          {usePdfJs && !isBookInfoPage && (
            <Badge variant="secondary" className="text-xs flex-shrink-0">p.{pdfCurrentPage}</Badge>
          )}
        </div>

          {/* Right: tools */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Reading Preferences popover + quick controls */}
            <div className="hidden md:flex items-center gap-0.5 border-r border-border/50 pr-1 mr-1">
              <ReadingPreferences prefs={prefs} onUpdate={updatePrefs} />

              {/* Font size quick controls */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updatePrefs({ fontSize: Math.max(12, prefs.fontSize - 1) })}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Decrease Font Size ({prefs.fontSize}px)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updatePrefs({ fontSize: Math.min(24, prefs.fontSize + 1) })}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Increase Font Size ({prefs.fontSize}px)</TooltipContent>
              </Tooltip>

              {/* Focus mode quick toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={prefs.focusMode ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => updatePrefs({ focusMode: !prefs.focusMode })}
                  >
                    {prefs.focusMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{prefs.focusMode ? 'Exit Focus Mode' : 'Focus Mode'}</TooltipContent>
              </Tooltip>
            </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={rightPanel === 'highlights' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleToggleRightPanel('highlights')}>
                <Highlighter className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Highlights</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={rightPanel === 'ai' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleToggleRightPanel('ai')}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>AI Assistant</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={rightPanel === 'analytics' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => handleToggleRightPanel('analytics')}>
                <BarChart3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Analytics</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleToggleBookmark}>
                {chapter && isBookmarked(book.id, chapter.id) ? <BookmarkCheck className="h-4 w-4 text-warning" /> : <Bookmark className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bookmark</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                import('@/hooks/use-toast').then(({ toast }) => toast({ title: 'Link copied', description: 'Reading location URL copied to clipboard.' }));
              }}>
                <Share2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Share</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleScrollToTop}>
                <ArrowUp className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Top of Page</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={isSplitScreen ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={handleToggleSplitScreen}>
                {isSplitScreen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isSplitScreen ? 'Close Split View' : 'Split View'}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main area: Outline (left) | Content (center) | Right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Outline sidebar (resizable) */}
        {showOutline ? (
          <ResizablePanelGroup direction="horizontal" className="h-full w-full">
            <ResizablePanel
              defaultSize={outlineWidthRef.current}
              minSize={12}
              maxSize={35}
              onResize={handleOutlineResize}
              className="hidden md:flex"
            >
              <div className={cn('w-full h-full', prefs.focusMode && 'opacity-30 hover:opacity-100 transition-opacity')}>
                <OutlineSidebar
                  book={book}
                  currentChapterId={useNativeRenderer ? (chapterId || '__book-info__') : (chapter?.id || '')}
                  currentChapterContent={chapter?.content}
                  onSelectChapter={handleNavigateChapter}
                  onScrollToHeading={handleScrollToHeading}
                  epubToc={useEpubJs ? epubToc : undefined}
                  epubCurrentHref={useEpubJs ? epubCurrentHref : undefined}
                  onEpubNavigate={useEpubJs ? handleEpubTocNavigate : undefined}
                  pdfToc={usePdfJs ? pdfToc : undefined}
                  pdfCurrentPage={usePdfJs ? pdfCurrentPage : undefined}
                  onPdfNavigate={usePdfJs ? handlePdfTocNavigate : undefined}
                  onAIAsk={handleSidebarAIAsk}
                  aiLoading={sidebarAILoading}
                  aiLastAnswer={sidebarAIAnswer}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle
              withHandle
              hitAreaMargins={{ coarse: 20, fine: 12 }}
              onDragging={setIsOutlineDragging}
              className="hidden w-6 bg-transparent after:w-6 after:bg-transparent hover:bg-accent/10 data-[resize-handle-state=hover]:bg-accent/10 data-[resize-handle-state=drag]:bg-accent/20 md:flex [&>div]:h-8 [&>div]:w-4 [&>div]:rounded-full [&>div]:border-border/70 [&>div]:bg-background/95 [&>div]:shadow-sm [&>div>svg]:h-3.5 [&>div>svg]:w-3.5 [&>div>svg]:text-muted-foreground"
            />

            <ResizablePanel defaultSize={100 - outlineWidthRef.current} minSize={30} className="min-w-0">
              {centerPanelJsx}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : null}

        {!showOutline && centerPanelJsx}
      </div>
    </div>
  );
}
