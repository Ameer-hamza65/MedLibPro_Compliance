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
  fontFamily?: string;
  theme?: string;
  focusMode?: boolean;
}

function flattenToc(items: NavItem[]): EpubTocItem[] {
  return items.map((item) => ({
    id: item.href?.trim() || item.id || item.label?.trim() || 'Untitled',
    href: item.href?.trim() || '',
    label: item.label?.trim() || 'Untitled',
    subitems: item.subitems ? flattenToc(item.subitems) : [],
  }));
}

function flattenEpubTocItems(items: EpubTocItem[]): EpubTocItem[] {
  return items.flatMap((item) => [item, ...flattenEpubTocItems(item.subitems)]);
}

function safeDecodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function splitNormalizedHref(href: string) {
  const normalized = safeDecodeHref(href || '')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .trim();
  const [path = '', fragment = ''] = normalized.split('#');
  return {
    path: path.toLowerCase(),
    fragment: fragment.toLowerCase(),
    full: `${path.toLowerCase()}#${fragment.toLowerCase()}`,
  };
}

function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href.trim());
}

function resolveRelativeHref(baseHref: string, href: string): string {
  const normalizedHref = safeDecodeHref(href || '').trim();
  if (!normalizedHref) return '';
  if (isExternalHref(normalizedHref)) return normalizedHref;

  if (normalizedHref.startsWith('#')) {
    const { path } = splitNormalizedHref(baseHref);
    return `${path}${normalizedHref}`;
  }

  try {
    const { path } = splitNormalizedHref(baseHref);
    const resolved = new URL(normalizedHref, `https://reader.local/${path || 'index.xhtml'}`);
    return `${resolved.pathname.replace(/^\/+/, '')}${resolved.hash || ''}`;
  } catch {
    return normalizedHref.replace(/^\/+/, '').replace(/^\.\//, '');
  }
}

function getDisplayHrefCandidates(href: string): string[] {
  const exactHref = `${href || ''}`.trim();
  if (!exactHref) return [];

  const decodedHref = safeDecodeHref(exactHref);
  const normalizedHref = decodedHref.replace(/^\/+/, '').replace(/^\.\//, '');
  const strippedPrefixHref = normalizedHref.replace(/^(OEBPS|OPS|Text|content|xhtml)\//i, '');

  return Array.from(new Set([
    exactHref,
    decodedHref,
    normalizedHref,
    strippedPrefixHref,
  ].filter(Boolean)));
}

function extractVisibleText(rendition: Rendition): string {
  try {
    const contents = rendition.getContents() as unknown as any[];
    return contents
      .map((content) => content?.document?.body?.innerText || '')
      .join('\n\n')
      .trim();
  } catch {
    return '';
  }
}

function isPrimaryReaderClick(event: MouseEvent): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}

function resolveActiveHref(
  rendition: Rendition,
  tocItems: EpubTocItem[],
  containerId: string,
  fallbackHref: string,
): string {
  const flattened = flattenEpubTocItems(tocItems);
  if (!flattened.length) return fallbackHref;

  const fallbackParts = splitNormalizedHref(fallbackHref);
  const container = document.getElementById(containerId);
  const containerRect = container?.getBoundingClientRect();
  const focusLine = containerRect
    ? containerRect.top + Math.min(containerRect.height * 0.22, 160)
    : 160;

  let bestAbove: { href: string; top: number } | null = null;
  let bestBelow: { href: string; top: number } | null = null;

  try {
    const contents = rendition.getContents() as unknown as any[];
    for (const content of contents) {
      const doc = content?.document as Document | undefined;
      const frame = doc?.defaultView?.frameElement as HTMLElement | null;
      if (!doc || !frame) continue;

      const frameRect = frame.getBoundingClientRect();
      const contentParts = splitNormalizedHref(content?.section?.href || fallbackHref);
      const contentPath = contentParts.path || fallbackParts.path;
      const contentTocItems = flattened.filter((item) => {
        const itemParts = splitNormalizedHref(item.href);
        return itemParts.path === contentPath && itemParts.fragment;
      });

      if (!contentTocItems.length) continue;

      const hrefByFragment = new Map(
        contentTocItems.map((item) => [splitNormalizedHref(item.href).fragment, item.href]),
      );

      const elements = Array.from(doc.querySelectorAll('[id]')) as HTMLElement[];
      for (const element of elements) {
        const fragment = (element.id || '').trim().toLowerCase();
        const href = hrefByFragment.get(fragment);
        if (!fragment || !href) continue;

        const rect = element.getBoundingClientRect();
        const absoluteTop = frameRect.top + rect.top;

        if (absoluteTop <= focusLine + 8) {
          if (!bestAbove || absoluteTop > bestAbove.top) {
            bestAbove = { href, top: absoluteTop };
          }
        } else if (!bestBelow || absoluteTop < bestBelow.top) {
          bestBelow = { href, top: absoluteTop };
        }
      }
    }
  } catch {
    // fall through to path-based matching
  }

  if (bestAbove) return bestAbove.href;
  if (bestBelow) return bestBelow.href;

  const exactMatch = flattened.find((item) => splitNormalizedHref(item.href).full === fallbackParts.full);
  if (exactMatch) return exactMatch.href;

  const samePathItems = flattened.filter((item) => splitNormalizedHref(item.href).path === fallbackParts.path);
  const sameFragmentItem = samePathItems.find((item) => splitNormalizedHref(item.href).fragment === fallbackParts.fragment);

  return sameFragmentItem?.href || samePathItems[0]?.href || flattened[0]?.href || fallbackHref;
}

async function navigateRenditionToHref(
  rendition: Rendition,
  href: string,
  onNavigate?: (targetHref: string) => void,
) {
  const targetHref = `${href || ''}`.trim();
  if (!targetHref) return;

  onNavigate?.(targetHref);

  const hrefCandidates = getDisplayHrefCandidates(targetHref);
  let lastError: unknown = null;

  for (const candidate of hrefCandidates) {
    try {
      await rendition.display(candidate);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
}

export function useEpubReader(options: UseEpubReaderOptions) {
  // Navigation lock: suppress scroll-sync updates for ~1.2s after goToChapter
  const navigationLockRef = useRef(false);
  const navigationLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { filePath, containerId, fontSize = 18, lineHeight = 1.8, fontFamily = 'sans', theme = 'default', focusMode = false } = options;
  const isDark = theme === 'default';

  const fontFamilyCSS =
    fontFamily === 'serif' ? '"Georgia", "Times New Roman", serif' :
    fontFamily === 'mono' ? '"JetBrains Mono", "Courier New", monospace' :
    '"Inter", system-ui, -apple-system, sans-serif';

  // Ref to hold current prefs without triggering re-renders in the load effect
  const prefsRef = useRef({ fontSize, lineHeight, fontFamilyCSS, theme, isDark });
  useEffect(() => {
    prefsRef.current = { fontSize, lineHeight, fontFamilyCSS, theme, isDark };
  }, [fontSize, lineHeight, fontFamilyCSS, theme, isDark]);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const lastLocationHrefRef = useRef('');
  const [toc, setToc] = useState<EpubTocItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<EpubLocation | null>(null);
  const [currentHref, setCurrentHref] = useState<string>('');
  const [selectedText, setSelectedText] = useState<{ text: string; cfi: string } | null>(null);
  const [visibleText, setVisibleText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let destroyed = false;
    let relocatedTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let containerEl: HTMLElement | null = null;
    let handleContainerScroll: (() => void) | null = null;

    setIsLoading(true);
    setError(null);
    setIsReady(false);

    async function loadEpub() {
      try {
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

        const tocItems = flattenToc(book.navigation.toc);
        setToc(tocItems);

        const container = document.getElementById(containerId);
        if (!(container instanceof HTMLElement)) throw new Error('Container not found');
        containerEl = container;
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

        rendition.hooks.content.register((contents: any) => {
          const doc = contents?.document as Document | undefined;
          if (!doc || doc.documentElement.dataset.medlibInternalNavBound === 'true') return;

          doc.documentElement.dataset.medlibInternalNavBound = 'true';

          doc.addEventListener('click', (event) => {
            if (!isPrimaryReaderClick(event)) return;

            const target = event.target;
            if (!(target instanceof Element)) return;

            const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
            const rawHref = anchor?.getAttribute('href')?.trim();
            if (!anchor || !rawHref || isExternalHref(rawHref)) return;

            const resolvedHref = resolveRelativeHref(
              contents?.section?.href || lastLocationHrefRef.current || tocItems[0]?.href || '',
              rawHref,
            );
            if (!resolvedHref) return;

            event.preventDefault();
            event.stopPropagation();
            (event as MouseEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();

            void navigateRenditionToHref(
              rendition,
              resolvedHref,
              (nextHref) => {
                lastLocationHrefRef.current = nextHref;
                setCurrentHref(nextHref);
              },
            ).catch((error) => {
              console.warn('Failed to navigate EPUB internal link:', error);
            });
          }, true);
        });

        const syncViewState = (fallbackHref?: string) => {
          if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
          scrollSyncTimer = setTimeout(() => {
            if (destroyed || !renditionRef.current) return;
            const nextVisibleText = extractVisibleText(renditionRef.current);
            if (nextVisibleText) setVisibleText(nextVisibleText);

            // Skip href updates while navigation lock is active
            if (navigationLockRef.current) return;

            const resolvedHref = resolveActiveHref(
              renditionRef.current,
              tocItems,
              containerId,
              fallbackHref || lastLocationHrefRef.current || tocItems[0]?.href || '',
            );

            if (resolvedHref) {
              lastLocationHrefRef.current = resolvedHref;
              setCurrentHref((prev) => (prev === resolvedHref ? prev : resolvedHref));
            }
          }, 200);
        };

        const prefs = prefsRef.current;
        rendition.themes.default({
          'body': {
            'font-size': `${prefs.fontSize}px !important`,
            'line-height': `${prefs.lineHeight} !important`,
            'font-family': `${prefs.fontFamilyCSS} !important`,
            'padding': '20px 40px !important',
            'max-width': '100% !important',
            'color': prefs.isDark ? '#e2e8f0 !important' : prefs.theme === 'sepia' ? '#3d2e1e !important' : '#1a202c !important',
            'background': 'transparent !important',
          },
          'p': {
            'margin-bottom': '0.75em !important',
            'text-align': 'justify !important',
          },
          'h1, h2, h3, h4, h5, h6': {
            'color': prefs.isDark ? '#f1f5f9 !important' : '#111827 !important',
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

        rendition.on('relocated', (location: any) => {
          if (destroyed) return;
          setCurrentLocation(location);
          if (location?.start?.href && !navigationLockRef.current) {
            lastLocationHrefRef.current = location.start.href;
            setCurrentHref(location.start.href);
          }
          if (relocatedTimer) clearTimeout(relocatedTimer);
          relocatedTimer = setTimeout(() => {
            syncViewState(location?.start?.href);
          }, 150);
        });

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

        handleContainerScroll = () => {
          syncViewState(lastLocationHrefRef.current);
        };
        container.addEventListener('scroll', handleContainerScroll, { passive: true });

        await rendition.display();
        if (destroyed) return;

        syncViewState(lastLocationHrefRef.current || tocItems[0]?.href || '');
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
      if (relocatedTimer) clearTimeout(relocatedTimer);
      if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
      if (containerEl && handleContainerScroll) {
        containerEl.removeEventListener('scroll', handleContainerScroll);
      }
      if (renditionRef.current) {
        try { renditionRef.current.destroy(); } catch {}
        renditionRef.current = null;
      }
      if (bookRef.current) {
        try { bookRef.current.destroy(); } catch {}
        bookRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, containerId]);

  useEffect(() => {
    if (!renditionRef.current || !isReady) return;
    const rendition = renditionRef.current;

    rendition.themes.default({
      'body': {
        'font-size': `${fontSize}px !important`,
        'line-height': `${lineHeight} !important`,
        'font-family': `${fontFamilyCSS} !important`,
        'color': isDark ? '#e2e8f0 !important' : theme === 'sepia' ? '#3d2e1e !important' : '#1a202c !important',
        'background': 'transparent !important',
      },
    });

    // Apply styles to already-rendered iframes without re-displaying (preserves scroll position)
    try {
      const contents = rendition.getContents() as unknown as any[];
      for (const content of contents) {
        const doc = content?.document as Document | undefined;
        if (!doc?.body) continue;
        doc.body.style.fontSize = `${fontSize}px`;
        doc.body.style.lineHeight = `${lineHeight}`;
        doc.body.style.fontFamily = fontFamilyCSS;
        doc.body.style.color = isDark ? '#e2e8f0' : theme === 'sepia' ? '#3d2e1e' : '#1a202c';
      }
    } catch {}
  }, [fontSize, lineHeight, fontFamilyCSS, theme, isDark, isReady]);

  const goToChapter = useCallback((href: string) => {
    if (!renditionRef.current) return;

    // Engage navigation lock to prevent scroll-sync from overriding
    navigationLockRef.current = true;
    if (navigationLockTimerRef.current) clearTimeout(navigationLockTimerRef.current);
    navigationLockTimerRef.current = setTimeout(() => {
      navigationLockRef.current = false;
    }, 1200);

    void navigateRenditionToHref(
      renditionRef.current,
      href,
      (targetHref) => {
        lastLocationHrefRef.current = targetHref;
        setCurrentHref(targetHref);
      },
    ).catch((error) => {
      console.warn('Failed to navigate EPUB ToC target:', error);
    });
  }, [containerId]);

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
