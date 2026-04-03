import { useState, useEffect, useRef, useCallback } from 'react';
import ePub, { Book, Rendition, NavItem } from 'epubjs';
import { supabase } from '@/integrations/supabase/client';

export interface EpubTocItem {
  id: string;
  href: string;
  label: string;
  subitems: EpubTocItem[];
}

export interface EpubLocation {
  start: { cfi: string; href: string; displayed: { page: number; total: number } };
  end: { cfi: string };
  atStart: boolean;
  atEnd: boolean;
}

interface UseEpubReaderOptions {
  filePath: string;
  containerId: string;
  fontSize?: number;
  lineHeight?: number;
  theme?: string;
  focusMode?: boolean;
}

function flattenToc(items: NavItem[]): EpubTocItem[] {
  return items.map(item => ({
    id: item.id || item.href,
    href: item.href,
    label: item.label?.trim() || 'Untitled',
    subitems: item.subitems ? flattenToc(item.subitems) : [],
  }));
}

export function useEpubReader(options: UseEpubReaderOptions) {
  const { filePath, containerId, fontSize = 18, lineHeight = 1.8, theme = 'light', focusMode = false } = options;

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [toc, setToc] = useState<EpubTocItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<EpubLocation | null>(null);
  const [currentHref, setCurrentHref] = useState<string>('');
  const [selectedText, setSelectedText] = useState<{ text: string; cfi: string } | null>(null);
  const [visibleText, setVisibleText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Load the EPUB
  useEffect(() => {
    let destroyed = false;
    setIsLoading(true);
    setError(null);
    setIsReady(false);

    async function loadEpub() {
      try {
        // Get authenticated access to the private bucket
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/book-files/${filePath}`;

        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) throw new Error(`Failed to fetch EPUB: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        if (destroyed) return;

        const book = ePub(arrayBuffer as any);
        bookRef.current = book;

        await book.ready;
        if (destroyed) return;

        // Extract TOC
        const nav = book.navigation;
        setToc(flattenToc(nav.toc));

        // Create rendition
        const container = document.getElementById(containerId);
        if (!container) throw new Error('Container not found');

        // Clear container
        container.innerHTML = '';

        const rendition = book.renderTo(container, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled-doc',
          manager: 'default',
          allowScriptedContent: true,
        });

        renditionRef.current = rendition;

        // Apply initial theme
        rendition.themes.default({
          'body': {
            'font-size': `${fontSize}px !important`,
            'line-height': `${lineHeight} !important`,
            'font-family': '"Georgia", "Times New Roman", serif !important',
            'padding': '20px 40px !important',
            'max-width': '100% !important',
            'color': theme === 'dark' ? '#e2e8f0 !important' : '#1a202c !important',
            'background': 'transparent !important',
          },
          'p': {
            'margin-bottom': '0.75em !important',
            'text-align': 'justify !important',
          },
          'h1, h2, h3, h4, h5, h6': {
            'color': theme === 'dark' ? '#f1f5f9 !important' : '#111827 !important',
            'margin-top': '1.5em !important',
            'margin-bottom': '0.5em !important',
          },
          'img': {
            'max-width': '100% !important',
            'height': 'auto !important',
          },
          'table': {
            'width': '100% !important',
            'border-collapse': 'collapse !important',
          },
          'td, th': {
            'border': '1px solid #d1d5db !important',
            'padding': '8px !important',
          },
        });

        // Listen for location changes (debounced to prevent scroll fighting)
        let relocatedTimer: ReturnType<typeof setTimeout> | null = null;
        rendition.on('relocated', (location: any) => {
          if (destroyed) return;
          setCurrentLocation(location);
          if (location?.start?.href) {
            setCurrentHref(location.start.href);
          }
          // Debounce visible text extraction
          if (relocatedTimer) clearTimeout(relocatedTimer);
          relocatedTimer = setTimeout(() => {
            try {
              const contents = rendition.getContents();
              if (contents && (contents as any).length > 0) {
                const doc = (contents as any)[0]?.document;
                if (doc?.body) {
                  setVisibleText(doc.body.innerText || '');
                }
              }
            } catch {
              // ignore
            }
          }, 300);
        });

        // Listen for text selection
        rendition.on('selected', (cfiRange: string, contents: any) => {
          if (destroyed) return;
          try {
            const range = contents?.range(cfiRange);
            const text = range?.toString() || '';
            if (text.trim()) {
              setSelectedText({ text: text.trim(), cfi: cfiRange });
            }
          } catch {
            // ignore selection errors
          }
        });

        // Display first page
        await rendition.display();
        if (destroyed) return;

        setIsReady(true);
        setIsLoading(false);
      } catch (err: any) {
        if (destroyed) return;
        console.error('EPUB load error:', err);
        setError(err.message || 'Failed to load EPUB');
        setIsLoading(false);
      }
    }

    loadEpub();

    return () => {
      destroyed = true;
      if (renditionRef.current) {
        try { renditionRef.current.destroy(); } catch {}
        renditionRef.current = null;
      }
      if (bookRef.current) {
        try { bookRef.current.destroy(); } catch {}
        bookRef.current = null;
      }
    };
  }, [filePath, containerId]);

  // Update theme/font when prefs change
  useEffect(() => {
    if (!renditionRef.current || !isReady) return;
    renditionRef.current.themes.default({
      'body': {
        'font-size': `${fontSize}px !important`,
        'line-height': `${lineHeight} !important`,
        'color': theme === 'dark' ? '#e2e8f0 !important' : '#1a202c !important',
        'background': 'transparent !important',
      },
    });
    // Force re-render
    try {
      const loc = renditionRef.current.location;
      if (loc?.start?.cfi) {
        renditionRef.current.display(loc.start.cfi);
      }
    } catch {}
  }, [fontSize, lineHeight, theme, isReady]);

  const goToChapter = useCallback((href: string) => {
    if (!renditionRef.current) return;
    renditionRef.current.display(href);
  }, []);

  const goNext = useCallback(() => {
    if (!renditionRef.current) return;
    renditionRef.current.next();
  }, []);

  const goPrev = useCallback(() => {
    if (!renditionRef.current) return;
    renditionRef.current.prev();
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedText(null);
  }, []);

  const addHighlightToRendition = useCallback((cfi: string, color: string) => {
    if (!renditionRef.current) return;
    try {
      renditionRef.current.annotations.highlight(cfi, {}, () => {}, 'hl', {
        fill: color,
        'fill-opacity': '0.3',
        'mix-blend-mode': 'multiply',
      });
    } catch (err) {
      console.warn('Failed to add highlight to rendition:', err);
    }
  }, []);

  const removeHighlightFromRendition = useCallback((cfi: string) => {
    if (!renditionRef.current) return;
    try {
      renditionRef.current.annotations.remove(cfi, 'highlight');
    } catch (err) {
      console.warn('Failed to remove highlight from rendition:', err);
    }
  }, []);

  return {
    book: bookRef.current,
    rendition: renditionRef.current,
    toc,
    isReady,
    isLoading,
    error,
    currentLocation,
    currentHref,
    selectedText,
    visibleText,
    goToChapter,
    goNext,
    goPrev,
    clearSelection,
    addHighlightToRendition,
    removeHighlightFromRendition,
  };
}
