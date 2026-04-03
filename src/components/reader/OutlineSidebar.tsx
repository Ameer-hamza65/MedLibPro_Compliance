import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { EpubBook, Chapter } from '@/data/mockEpubData';
import { cn } from '@/lib/utils';
import type { EpubTocItem } from '@/hooks/useEpubReader';
import type { PdfTocItem } from '@/hooks/usePdfReader';
import { SidebarAIInput } from './SidebarAIInput';

interface OutlineSidebarProps {
  book: EpubBook;
  currentChapterId: string;
  currentChapterContent?: string;
  onSelectChapter: (chapter: Chapter) => void;
  onScrollToHeading?: (headingId: string) => void;
  epubToc?: EpubTocItem[];
  epubCurrentHref?: string;
  onEpubNavigate?: (href: string) => void;
  pdfToc?: PdfTocItem[];
  pdfCurrentPage?: number;
  onPdfNavigate?: (item: PdfTocItem) => void;
  // AI sidebar
  onAIAsk?: (question: string) => void;
  aiLoading?: boolean;
  aiLastAnswer?: string;
}

function extractHeadings(html: string): { id: string; title: string; level: number }[] {
  if (!html) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const headings: { id: string; title: string; level: number }[] = [];
    doc.querySelectorAll('h2, h3, h4').forEach((el) => {
      const text = el.textContent?.trim();
      if (!text) return;
      headings.push({ id: `heading-${headings.length}`, title: text, level: parseInt(el.tagName[1]) });
    });
    return headings;
  } catch {
    return [];
  }
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

function flattenEpubItems(items: EpubTocItem[]): EpubTocItem[] {
  return items.flatMap((item) => [item, ...flattenEpubItems(item.subitems)]);
}

function flattenPdfItems(items: PdfTocItem[]): PdfTocItem[] {
  return items.flatMap((item) => [item, ...flattenPdfItems(item.subitems)]);
}

function collectExpandableIds<T extends { id: string; subitems: T[] }>(items: T[]): string[] {
  return items.flatMap((item) => (item.subitems.length ? [item.id, ...collectExpandableIds(item.subitems)] : []));
}

function collectAncestorIds<T extends { id: string; subitems: T[] }>(items: T[], targetId: string, trail: string[] = []): string[] {
  for (const item of items) {
    if (item.id === targetId) return trail;
    const nextTrail = collectAncestorIds(item.subitems, targetId, [...trail, item.id]);
    if (nextTrail.length) return nextTrail;
  }
  return [];
}

function hasActiveDescendant<T extends { id: string; subitems: T[] }>(items: T[], activeId?: string | null): boolean {
  if (!activeId) return false;
  return items.some((item) => item.id === activeId || hasActiveDescendant(item.subitems, activeId));
}

function findActiveEpubItem(items: EpubTocItem[], currentHref?: string): EpubTocItem | null {
  if (!currentHref) return null;
  const flattened = flattenEpubItems(items);
  const current = normalizeEpubHref(currentHref);

  const exact = flattened.find((item) => normalizeEpubHref(item.href).full === current.full);
  if (exact) return exact;

  const samePathItems = flattened.filter((item) => normalizeEpubHref(item.href).path === current.path);
  const matchingFragment = samePathItems
    .filter((item) => {
      const fragment = normalizeEpubHref(item.href).fragment;
      return fragment && (fragment === current.fragment || current.fragment.startsWith(fragment));
    })
    .sort((a, b) => normalizeEpubHref(b.href).fragment.length - normalizeEpubHref(a.href).fragment.length)[0];

  return matchingFragment || samePathItems[0] || null;
}

function findActivePdfItem(items: PdfTocItem[], currentPage?: number): PdfTocItem | null {
  if (!currentPage) return null;
  const flattened = flattenPdfItems(items).sort((a, b) => a.pageNumber - b.pageNumber);
  let active: PdfTocItem | null = flattened[0] || null;
  for (const item of flattened) {
    if (item.pageNumber <= currentPage) active = item;
    else break;
  }
  return active;
}

export function OutlineSidebar({
  book,
  currentChapterId,
  currentChapterContent,
  onSelectChapter,
  onScrollToHeading,
  epubToc,
  epubCurrentHref,
  onEpubNavigate,
  pdfToc,
  pdfCurrentPage,
  onPdfNavigate,
  onAIAsk,
  aiLoading,
  aiLastAnswer,
}: OutlineSidebarProps) {
  const isEpubMode = !!(epubToc && epubToc.length > 0);
  const isPdfMode = !!(pdfToc && pdfToc.length > 0);

  const frontMatter = book.tableOfContents.filter(ch => ch.category === 'front-matter');
  const mainChapters = book.tableOfContents.filter(ch => !ch.category || ch.category === 'chapter');
  const appendix = book.tableOfContents.filter(ch => ch.category === 'appendix');

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['contents']));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set([currentChapterId]));
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const outlineScrollRootRef = useRef<HTMLDivElement>(null);

  const activeEpubItem = useMemo(
    () => (isEpubMode ? findActiveEpubItem(epubToc || [], epubCurrentHref) : null),
    [isEpubMode, epubToc, epubCurrentHref]
  );

  const activePdfItem = useMemo(
    () => (isPdfMode ? findActivePdfItem(pdfToc || [], pdfCurrentPage) : null),
    [isPdfMode, pdfToc, pdfCurrentPage]
  );

  const activeOutlineItemId = activeEpubItem?.id || activePdfItem?.id || null;

  const currentHeadings = useMemo(
    () => extractHeadings(currentChapterContent || ''),
    [currentChapterContent]
  );

  useEffect(() => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      next.add(currentChapterId);
      return next;
    });
  }, [currentChapterId]);

  // Collect all section IDs for open/close all
  const allSectionIds = useMemo(() => {
    if (isEpubMode && epubToc) {
      const ids = new Set<string>(['contents', ...collectExpandableIds(epubToc)]);
      return ids;
    }
    if (isPdfMode && pdfToc) {
      const ids = new Set<string>(['contents', ...collectExpandableIds(pdfToc)]);
      return ids;
    }
    const ids = new Set<string>();
    if (frontMatter.length) ids.add('front-matter');
    ids.add('chapters');
    if (appendix.length) ids.add('appendix');
    return ids;
  }, [isEpubMode, isPdfMode, epubToc, pdfToc, frontMatter.length, appendix.length]);

  useEffect(() => {
    const activeId = activeEpubItem?.id || activePdfItem?.id;
    if (!activeId) return;

    const ancestorIds = activeEpubItem
      ? collectAncestorIds(epubToc || [], activeId)
      : activePdfItem
      ? collectAncestorIds(pdfToc || [], activeId)
      : [];

    setExpandedSections((prev) => new Set([...prev, 'contents', ...ancestorIds]));
  }, [activeEpubItem, activePdfItem, epubToc, pdfToc]);

  // Debounced auto-scroll: only scroll sidebar after active item stabilizes for 300ms
  const lastActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeOutlineItemId) return;
    // Skip if same item (no need to re-scroll)
    if (lastActiveIdRef.current === activeOutlineItemId) return;

    // Debounce: wait 300ms for the active item to stabilize before scrolling
    const debounceTimer = window.setTimeout(() => {
      lastActiveIdRef.current = activeOutlineItemId;

      let attempts = 0;
      const tryScroll = () => {
        const root = outlineScrollRootRef.current;
        const viewport = root?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
        const target = root?.querySelector<HTMLElement>(`[data-outline-item-id="${CSS.escape(activeOutlineItemId)}"]`);

        if (!viewport || !target) {
          if (attempts < 4) {
            attempts += 1;
            window.setTimeout(tryScroll, 150);
          }
          return;
        }

        const viewportRect = viewport.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const padding = 24;
        const targetTop = targetRect.top - viewportRect.top + viewport.scrollTop;
        const targetBottom = targetTop + targetRect.height;
        const visibleTop = viewport.scrollTop;
        const visibleBottom = visibleTop + viewport.clientHeight;

        viewport.scrollLeft = 0;

        if (targetTop < visibleTop + padding) {
          viewport.scrollTo({ top: Math.max(targetTop - padding, 0), behavior: 'smooth' });
        } else if (targetBottom > visibleBottom - padding) {
          viewport.scrollTo({
            top: Math.max(targetBottom - viewport.clientHeight + padding, 0),
            behavior: 'smooth',
          });
        }
      };

      tryScroll();
    }, 300);

    return () => window.clearTimeout(debounceTimer);
  }, [activeOutlineItemId]);

  const handleOpenAll = useCallback(() => {
    setExpandedSections(new Set(allSectionIds));
  }, [allSectionIds]);

  const handleCloseAll = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpanded = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const handleHeadingClick = (headingId: string) => {
    setActiveHeadingId(headingId);
    onScrollToHeading?.(headingId);
  };

  const renderChapterItem = (chapter: Chapter) => {
    const isCurrent = chapter.id === currentChapterId;
    const isExpanded = expandedChapters.has(chapter.id);
    const hasSubHeadings = isCurrent && currentHeadings.length > 0;

    return (
      <div key={chapter.id} className="mb-0.5">
        {hasSubHeadings ? (
          <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(chapter.id)}>
            <CollapsibleTrigger className="w-full group">
              <div className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-left rounded-md transition-colors w-full',
                isCurrent ? 'text-primary font-semibold bg-primary/5' : 'text-foreground hover:bg-muted/50'
              )}>
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
                <span className="text-sm truncate">{chapter.title}</span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-4 border-l-2 border-border/60 pl-2 py-0.5 space-y-0.5">
                {currentHeadings.map(h => (
                  <button
                    key={h.id}
                    onClick={() => handleHeadingClick(h.id)}
                    className={cn(
                      'w-full text-left px-2 py-1 rounded-md text-xs transition-colors flex items-center gap-1.5',
                      h.level === 3 && 'pl-5',
                      h.level === 4 && 'pl-8',
                      activeHeadingId === h.id ? 'text-primary font-semibold bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 opacity-60" />
                    <span className="truncate">{h.title}</span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <button
            onClick={() => onSelectChapter(chapter)}
            className={cn(
              'w-full text-left flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm',
              isCurrent ? 'text-primary font-semibold bg-primary/5' : 'text-foreground hover:bg-muted/50'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isCurrent ? 'bg-primary' : 'bg-muted-foreground/40')} />
            <span className="truncate">{chapter.title}</span>
          </button>
        )}
      </div>
    );
  };

  const renderSectionGroup = (id: string, title: string, chapters: Chapter[]) => {
    if (chapters.length === 0) return null;
    const isOpen = expandedSections.has(id);
    return (
      <Collapsible open={isOpen} onOpenChange={() => toggleSection(id)}>
        <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">
          <span>{title}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pb-2">
            {chapters.map(ch => renderChapterItem(ch))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const renderEpubItem = useCallback((item: EpubTocItem, depth = 0) => {
    const isCurrent = activeEpubItem?.id === item.id;
    const descendantActive = hasActiveDescendant(item.subitems, activeEpubItem?.id);
    const isOpen = expandedSections.has(item.id) || descendantActive;
    const hasSubitems = item.subitems.length > 0;

    return (
      <div key={item.id} className="space-y-0.5">
        <div className="flex items-start gap-1">
          {hasSubitems ? (
            <button
              type="button"
              onClick={() => toggleSection(item.id)}
              className="mt-1 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={isOpen ? 'Collapse section' : 'Expand section'}
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !isOpen && '-rotate-90')} />
            </button>
          ) : (
            <div className="w-5 flex-shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onEpubNavigate?.(item.href)}
            data-outline-item-id={item.id}
            className={cn(
              'flex-1 min-w-0 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              isCurrent
                ? 'bg-primary/5 font-semibold text-primary'
                : descendantActive
                ? 'text-primary/80'
                : 'text-foreground hover:bg-muted/50'
            )}
            style={{ marginLeft: `${depth * 12}px` }}
          >
            <span className="block truncate">{item.label}</span>
          </button>
        </div>

        {hasSubitems && isOpen && (
          <div className="ml-3 border-l border-border/60 pl-1">
            {item.subitems.map((subitem) => renderEpubItem(subitem, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [activeEpubItem?.id, expandedSections, onEpubNavigate, toggleSection]);

  const renderPdfItem = useCallback((item: PdfTocItem, depth = 0) => {
    const isCurrent = activePdfItem?.id === item.id;
    const descendantActive = hasActiveDescendant(item.subitems, activePdfItem?.id);
    const isOpen = expandedSections.has(item.id) || descendantActive;
    const hasSubitems = item.subitems.length > 0;

    return (
      <div key={item.id} className="space-y-0.5">
        <div className="flex items-start gap-1">
          {hasSubitems ? (
            <button
              type="button"
              onClick={() => toggleSection(item.id)}
              className="mt-1 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={isOpen ? 'Collapse section' : 'Expand section'}
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', !isOpen && '-rotate-90')} />
            </button>
          ) : (
            <div className="w-5 flex-shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onPdfNavigate?.(item)}
            data-outline-item-id={item.id}
            className={cn(
              'flex-1 min-w-0 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              isCurrent
                ? 'bg-primary/5 font-semibold text-primary'
                : descendantActive
                ? 'text-primary/80'
                : 'text-foreground hover:bg-muted/50'
            )}
            style={{ marginLeft: `${depth * 12}px` }}
          >
            <div className="flex items-center gap-2">
              <span className="truncate flex-1">{item.label}</span>
              <span className="text-[10px] text-muted-foreground">p.{item.pageNumber}</span>
            </div>
          </button>
        </div>

        {hasSubitems && isOpen && (
          <div className="ml-3 border-l border-border/60 pl-1">
            {item.subitems.map((subitem) => renderPdfItem(subitem, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [activePdfItem?.id, expandedSections, onPdfNavigate, toggleSection]);

  return (
    <div ref={outlineScrollRootRef} className="flex flex-col h-full bg-card border-r border-border/50">
      {/* Book header */}
      <div className="px-4 py-3 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: book.coverColor }}
          >
            <BookOpen className="h-4 w-4 text-white/40" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate text-foreground">{book.title}</p>
            <p className="text-[10px] text-muted-foreground">{book.authors?.join(', ')}</p>
          </div>
        </div>
      </div>

      {/* Reading Assistant (AI quick-ask) */}
      {onAIAsk && (
        <SidebarAIInput
          onAsk={onAIAsk}
          isLoading={aiLoading}
          lastAnswer={aiLastAnswer}
        />
      )}

      {/* OUTLINE label + Open all / Close all */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-border/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Outline
        </span>
        <div className="flex items-center gap-2">
          <button onClick={handleOpenAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
            Open all
          </button>
          <button onClick={handleCloseAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
            Close all
          </button>
        </div>
      </div>

      {/* Scrollable outline tree */}
      <ScrollArea className="flex-1 overflow-x-hidden">
        <div className="py-2 px-1 overflow-hidden">
          {/* Book Info link */}
          <button
            onClick={() => onSelectChapter({ id: '__book-info__', title: 'Book Information', content: '', pageNumber: 0, tags: [] } as Chapter)}
            className={cn(
              'w-full text-left flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm mb-1',
              currentChapterId === '__book-info__'
                ? 'text-primary font-semibold bg-primary/5'
                : 'text-foreground hover:bg-muted/50'
            )}
          >
            <BookOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Book Information</span>
          </button>

          {isEpubMode ? (
            <div className="pb-1">
              <Collapsible open={expandedSections.has('contents')} onOpenChange={() => toggleSection('contents')}>
                <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">
                  <span>Contents</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !expandedSections.has('contents') && "-rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pb-2 space-y-0.5">{(epubToc || []).map((tocItem) => renderEpubItem(tocItem))}</div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : isPdfMode ? (
            <div className="pb-1">
              <Collapsible open={expandedSections.has('contents')} onOpenChange={() => toggleSection('contents')}>
                <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">
                  <span>Contents</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !expandedSections.has('contents') && "-rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pb-2 space-y-0.5">{(pdfToc || []).map((tocItem) => renderPdfItem(tocItem))}</div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : (
            <>
              {renderSectionGroup('front-matter', 'Front Matter', frontMatter)}
              {renderSectionGroup('chapters', 'Chapters', mainChapters)}
              {renderSectionGroup('appendix', 'Appendix', appendix)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

