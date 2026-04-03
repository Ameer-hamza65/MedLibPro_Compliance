import { useEffect, useState, useCallback } from 'react';
import { usePdfReader, PdfTocItem } from '@/hooks/usePdfReader';
import { Loader2, AlertCircle, Highlighter, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface PdfReaderProps {
  filePath: string;
  bookId: string;
  fontSize?: number;
  theme?: string;
  navigateToPage?: {
    pageNumber: number;
    topOffset?: number | null;
  };
  onTocLoaded?: (toc: PdfTocItem[]) => void;
  onPageChange?: (page: number) => void;
  onVisibleTextChange?: (text: string) => void;
  onHighlight?: (text: string, page: number) => void;
  onAnnotate?: (text: string, note: string, page: number) => void;
  highlightColor?: string;
  className?: string;
}

export function PdfReader({
  filePath,
  bookId,
  fontSize = 18,
  theme = 'default',
  navigateToPage,
  onTocLoaded,
  onPageChange,
  onVisibleTextChange,
  onHighlight,
  onAnnotate,
  highlightColor = 'hsl(48 96% 70%)',
  className,
}: PdfReaderProps) {
  const containerId = `pdf-container-${bookId}`;
  const [annotationNote, setAnnotationNote] = useState('');
  const [showAnnotatePopover, setShowAnnotatePopover] = useState(false);

  const {
    toc,
    isReady,
    isLoading,
    error,
    totalPages,
    currentPage,
    selectedText,
    visibleText,
    goToPage,
    clearSelection,
  } = usePdfReader({
    filePath,
    containerId,
    fontSize,
    theme,
  });

  // Navigate to page when parent requests
  useEffect(() => {
    if (navigateToPage?.pageNumber && isReady) {
      goToPage(navigateToPage.pageNumber, navigateToPage.topOffset);
    }
  }, [navigateToPage, isReady, goToPage]);

  // Notify parent of TOC
  useEffect(() => {
    if (toc.length > 0 && onTocLoaded) {
      onTocLoaded(toc);
    }
  }, [toc, onTocLoaded]);

  // Notify parent of page changes
  useEffect(() => {
    if (currentPage && onPageChange) {
      onPageChange(currentPage);
    }
  }, [currentPage, onPageChange]);

  // Notify parent of visible text
  useEffect(() => {
    if (visibleText && onVisibleTextChange) {
      onVisibleTextChange(visibleText);
    }
  }, [visibleText, onVisibleTextChange]);

  const handleHighlight = useCallback(() => {
    if (!selectedText || !onHighlight) return;
    onHighlight(selectedText.text, selectedText.page);
    clearSelection();
  }, [selectedText, onHighlight, clearSelection]);

  const handleAnnotateSubmit = useCallback(() => {
    if (!selectedText || !onAnnotate || !annotationNote.trim()) return;
    onAnnotate(selectedText.text, annotationNote, selectedText.page);
    setAnnotationNote('');
    setShowAnnotatePopover(false);
    clearSelection();
  }, [selectedText, onAnnotate, annotationNote, clearSelection]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center space-y-3 p-8">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h3 className="text-lg font-semibold">Failed to Load PDF</h3>
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
            <p className="text-sm text-muted-foreground">Loading PDF...</p>
          </div>
        </div>
      )}

      {/* Selection toolbar */}
      {selectedText && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg p-1.5">
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={handleHighlight}>
            <Highlighter className="h-3.5 w-3.5" />
            Highlight
          </Button>
          <Popover open={showAnnotatePopover} onOpenChange={setShowAnnotatePopover}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs">
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
          <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={clearSelection}>
            ✕
          </Button>
        </div>
      )}

      {/* Page indicator */}
      {isReady && totalPages > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-card/90 border border-border rounded-full px-3 py-1 text-xs text-muted-foreground shadow">
          Page {currentPage} of {totalPages}
        </div>
      )}

      {/* PDF.js render target */}
      <div
        id={containerId}
        className={cn(
          'h-full w-full overflow-auto scroll-smooth',
          theme === 'default' ? 'bg-slate-900' : theme === 'sepia' ? 'bg-amber-50' : 'bg-white',
        )}
        style={{
          minHeight: '100%',
          padding: '16px',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
      />
    </div>
  );
}
