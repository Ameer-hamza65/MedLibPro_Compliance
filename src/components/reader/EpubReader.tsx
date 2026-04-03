import { useEffect, useRef, useState, useCallback } from 'react';
import { useEpubReader, EpubTocItem } from '@/hooks/useEpubReader';
import { Loader2, BookOpen, AlertCircle, Highlighter, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface EpubReaderProps {
  filePath: string;
  bookId: string;
  fontSize?: number;
  lineHeight?: number;
  theme?: string;
  focusMode?: boolean;
  navigateToHref?: string;
  onTocLoaded?: (toc: EpubTocItem[]) => void;
  onChapterChange?: (href: string) => void;
  onVisibleTextChange?: (text: string) => void;
  onHighlight?: (text: string, cfi: string) => void;
  onAnnotate?: (text: string, note: string, cfi: string) => void;
  highlightColor?: string;
  className?: string;
}

export function EpubReader({
  filePath,
  bookId,
  fontSize = 18,
  lineHeight = 1.8,
  theme = 'light',
  focusMode = false,
  navigateToHref,
  onTocLoaded,
  onChapterChange,
  onVisibleTextChange,
  onHighlight,
  onAnnotate,
  highlightColor = 'hsl(48 96% 70%)',
  className,
}: EpubReaderProps) {
  const containerId = `epub-container-${bookId}`;
  const [annotationNote, setAnnotationNote] = useState('');
  const [showAnnotatePopover, setShowAnnotatePopover] = useState(false);
  const popoverAnchorRef = useRef<HTMLDivElement>(null);

  const {
    toc,
    isReady,
    isLoading,
    error,
    currentHref,
    selectedText,
    visibleText,
    goToChapter,
    clearSelection,
    addHighlightToRendition,
  } = useEpubReader({
    filePath,
    containerId,
    fontSize,
    lineHeight,
    theme,
    focusMode,
  });

  // Navigate to a specific href when parent requests it
  useEffect(() => {
    if (navigateToHref && isReady) {
      goToChapter(navigateToHref);
    }
  }, [navigateToHref, isReady, goToChapter]);

  // Notify parent of TOC
  useEffect(() => {
    if (toc.length > 0 && onTocLoaded) {
      onTocLoaded(toc);
    }
  }, [toc, onTocLoaded]);

  // Notify parent of chapter changes
  useEffect(() => {
    if (currentHref && onChapterChange) {
      onChapterChange(currentHref);
    }
  }, [currentHref, onChapterChange]);

  // Notify parent of visible text
  useEffect(() => {
    if (visibleText && onVisibleTextChange) {
      onVisibleTextChange(visibleText);
    }
  }, [visibleText, onVisibleTextChange]);

  const handleHighlight = useCallback(() => {
    if (!selectedText || !onHighlight) return;
    onHighlight(selectedText.text, selectedText.cfi);
    addHighlightToRendition(selectedText.cfi, highlightColor);
    clearSelection();
  }, [selectedText, onHighlight, addHighlightToRendition, highlightColor, clearSelection]);

  const handleAnnotateSubmit = useCallback(() => {
    if (!selectedText || !onAnnotate || !annotationNote.trim()) return;
    onAnnotate(selectedText.text, annotationNote, selectedText.cfi);
    addHighlightToRendition(selectedText.cfi, 'hsl(199 89% 70%)');
    setAnnotationNote('');
    setShowAnnotatePopover(false);
    clearSelection();
  }, [selectedText, onAnnotate, annotationNote, addHighlightToRendition, clearSelection]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center space-y-3 p-8">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold">Failed to Load Book</h3>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full w-full', className)}>
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Loading book...</p>
          </div>
        </div>
      )}

      {/* Selection toolbar */}
      {selectedText && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg p-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            onClick={handleHighlight}
          >
            <Highlighter className="h-3.5 w-3.5" />
            Highlight
          </Button>
          <Popover open={showAnnotatePopover} onOpenChange={setShowAnnotatePopover}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs"
              >
                <StickyNote className="h-3.5 w-3.5" />
                Note
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="end">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground truncate">"{selectedText.text.slice(0, 60)}..."</p>
                <Textarea
                  placeholder="Add a note..."
                  value={annotationNote}
                  onChange={e => setAnnotationNote(e.target.value)}
                  className="text-xs min-h-[60px]"
                />
                <Button size="sm" className="w-full text-xs" onClick={handleAnnotateSubmit} disabled={!annotationNote.trim()}>
                  Save Note
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground"
            onClick={clearSelection}
          >
            ✕
          </Button>
        </div>
      )}

      {/* EPUB.js render target */}
      <div
        id={containerId}
        ref={popoverAnchorRef}
        className={cn(
          'h-full w-full overflow-auto scroll-smooth',
          theme === 'dark' ? 'bg-slate-900' : theme === 'sepia' ? 'bg-amber-50' : 'bg-white',
        )}
        style={{
          minHeight: '100%',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
      />
    </div>
  );
}
