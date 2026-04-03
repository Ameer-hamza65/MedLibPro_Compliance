import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { EpubBook, Chapter } from '@/data/mockEpubData';
import { cn } from '@/lib/utils';
import type { EpubTocItem } from '@/hooks/useEpubReader';
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

export function OutlineSidebar({
  book,
  currentChapterId,
  currentChapterContent,
  onSelectChapter,
  onScrollToHeading,
  epubToc,
  epubCurrentHref,
  onEpubNavigate,
  onAIAsk,
  aiLoading,
  aiLastAnswer,
}: OutlineSidebarProps) {
  const isEpubMode = !!(epubToc && epubToc.length > 0);

  const frontMatter = book.tableOfContents.filter(ch => ch.category === 'front-matter');
  const mainChapters = book.tableOfContents.filter(ch => !ch.category || ch.category === 'chapter');
  const appendix = book.tableOfContents.filter(ch => ch.category === 'appendix');

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['contents']));
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set([currentChapterId]));
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

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
      const ids = new Set<string>(['contents']);
      epubToc.forEach(item => {
        if (item.subitems.length > 0) ids.add(item.id);
      });
      return ids;
    }
    const ids = new Set<string>();
    if (frontMatter.length) ids.add('front-matter');
    ids.add('chapters');
    if (appendix.length) ids.add('appendix');
    return ids;
  }, [isEpubMode, epubToc, frontMatter.length, appendix.length]);

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

  return (
    <div className="flex flex-col h-full bg-card border-r border-border/50">
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
      <ScrollArea className="flex-1">
        <div className="py-2 px-1">
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
            /* EPUB.js TOC */
            <div className="pb-1">
              <Collapsible open={expandedSections.has('contents')} onOpenChange={() => toggleSection('contents')}>
                <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">
                  <span>Contents</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !expandedSections.has('contents') && "-rotate-90")} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pb-2 space-y-0.5">
                    {epubToc!.map(tocItem => {
                      const isCurrent = epubCurrentHref ? epubCurrentHref.includes(tocItem.href) : false;
                      const hasSubitems = tocItem.subitems.length > 0;
                      const isSubOpen = expandedSections.has(tocItem.id);

                      return (
                        <div key={tocItem.id}>
                          {hasSubitems ? (
                            <Collapsible open={isSubOpen} onOpenChange={() => toggleSection(tocItem.id)}>
                              <div className="flex items-center">
                                <CollapsibleTrigger className="p-1">
                                  <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", !isSubOpen && "-rotate-90")} />
                                </CollapsibleTrigger>
                                <button
                                  onClick={() => onEpubNavigate?.(tocItem.href)}
                                  className={cn(
                                    'flex-1 text-left py-1.5 pr-3 rounded-md transition-colors text-sm truncate',
                                    isCurrent ? 'text-primary font-semibold' : 'text-foreground hover:text-primary'
                                  )}
                                >
                                  {tocItem.label}
                                </button>
                              </div>
                              <CollapsibleContent>
                                <div className="ml-4 border-l-2 border-border/60 pl-2 space-y-0.5">
                                  {tocItem.subitems.map(sub => {
                                    const isSubCurrent = epubCurrentHref ? epubCurrentHref.includes(sub.href) : false;
                                    return (
                                      <button
                                        key={sub.id}
                                        onClick={() => onEpubNavigate?.(sub.href)}
                                        className={cn(
                                          'w-full text-left px-2 py-1 rounded-md text-xs transition-colors',
                                          isSubCurrent ? 'text-primary font-semibold bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                                        )}
                                      >
                                        <span className="truncate">{sub.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          ) : (
                            <button
                              onClick={() => onEpubNavigate?.(tocItem.href)}
                              className={cn(
                                'w-full text-left flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm',
                                isCurrent ? 'text-primary font-semibold bg-primary/5' : 'text-foreground hover:bg-muted/50'
                              )}
                            >
                              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isCurrent ? 'bg-primary' : 'bg-muted-foreground/40')} />
                              <span className="truncate">{tocItem.label}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
