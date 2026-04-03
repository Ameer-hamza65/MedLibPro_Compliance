import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export interface PdfTocItem {
  id: string;
  href: string;
  label: string;
  pageNumber: number;
  topOffset: number | null;
  subitems: PdfTocItem[];
}

interface UsePdfReaderOptions {
  filePath: string;
  containerId: string;
  fontSize?: number;
  theme?: string;
  scale?: number;
}

function flattenOutline(items: any[], pdf: pdfjsLib.PDFDocumentProxy): Promise<PdfTocItem[]> {
  return Promise.all(
    items.map(async (item, idx) => {
      let pageNumber = 1;
      let topOffset: number | null = null;
      try {
        if (item.dest) {
          const dest = typeof item.dest === 'string'
            ? await pdf.getDestination(item.dest)
            : item.dest;
          if (dest && dest[0]) {
            const pageIdx = await pdf.getPageIndex(dest[0]);
            pageNumber = pageIdx + 1;
            const explicitTop = typeof dest[3] === 'number' ? dest[3] : null;
            const fallbackTop = typeof dest[2] === 'number' ? dest[2] : null;
            topOffset = explicitTop ?? fallbackTop;
          }
        }
      } catch {
        // fallback
      }
      const subitems = item.items?.length
        ? await flattenOutline(item.items, pdf)
        : [];
      return {
        id: `pdf-toc-${pageNumber}-${idx}`,
        href: `page-${pageNumber}`,
        label: item.title || `Page ${pageNumber}`,
        pageNumber,
        topOffset,
        subitems,
      };
    })
  );
}

function flattenPdfItems(items: PdfTocItem[]): PdfTocItem[] {
  return items.flatMap((item) => [item, ...flattenPdfItems(item.subitems)]);
}

export function usePdfReader(options: UsePdfReaderOptions) {
  const { filePath, containerId, fontSize = 18, theme = 'default', scale = 1.5 } = options;

  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [toc, setToc] = useState<PdfTocItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedText, setSelectedText] = useState<{ text: string; page: number } | null>(null);
  const [visibleText, setVisibleText] = useState('');
  const tocRef = useRef<PdfTocItem[]>([]);
  const renderedPages = useRef<Set<number>>(new Set());

  useEffect(() => {
    let destroyed = false;
    setIsLoading(true);
    setError(null);
    setIsReady(false);
    renderedPages.current.clear();

    async function loadPdf() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/book-files/${filePath}`;

        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        if (destroyed) return;

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (destroyed) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);

        // Extract outline/TOC
        try {
          const outline = await pdf.getOutline();
          if (outline && outline.length > 0) {
            const tocItems = await flattenOutline(outline, pdf);
            if (!destroyed) {
              tocRef.current = tocItems;
              setToc(tocItems);
            }
          }
        } catch {
          // no outline
        }

        // Render all pages into the container
        const container = document.getElementById(containerId);
        if (!container) throw new Error('Container not found');
        container.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          if (destroyed) break;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page-wrapper';
          pageWrapper.id = `pdf-page-${i}`;
          pageWrapper.setAttribute('data-page', String(i));
          pageWrapper.style.position = 'relative';
          pageWrapper.style.marginBottom = '16px';
          pageWrapper.style.width = `${viewport.width}px`;
          pageWrapper.style.maxWidth = '100%';
          pageWrapper.style.margin = '0 auto 16px auto';

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';

          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
          }

          // Add text layer for selection
          const textContent = await page.getTextContent();
          const textLayer = document.createElement('div');
          textLayer.className = 'pdf-text-layer';
          textLayer.style.position = 'absolute';
          textLayer.style.top = '0';
          textLayer.style.left = '0';
          textLayer.style.width = `${viewport.width}px`;
          textLayer.style.height = `${viewport.height}px`;
          textLayer.style.transform = `scale(${canvas.clientWidth / viewport.width || 1})`;
          textLayer.style.transformOrigin = 'top left';

          for (const item of textContent.items) {
            if (!('str' in item) || !item.str) continue;
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const span = document.createElement('span');
            span.textContent = item.str;
            span.style.position = 'absolute';
            span.style.left = `${tx[4]}px`;
            span.style.top = `${viewport.height - tx[5]}px`;
            span.style.fontSize = `${Math.abs(tx[0])}px`;
            span.style.fontFamily = 'sans-serif';
            span.style.color = 'transparent';
            span.style.whiteSpace = 'pre';
            span.style.cursor = 'text';
            textLayer.appendChild(span);
          }

          pageWrapper.appendChild(canvas);
          pageWrapper.appendChild(textLayer);
          container.appendChild(pageWrapper);
          renderedPages.current.add(i);
        }

        if (!destroyed) {
          setIsReady(true);
          setIsLoading(false);

          // Extract first page text for AI
          try {
            const firstPage = await pdf.getPage(1);
            const tc = await firstPage.getTextContent();
            const text = tc.items.map((i: any) => i.str || '').join(' ');
            setVisibleText(text);
          } catch {}
        }
      } catch (err: any) {
        if (destroyed) return;
        console.error('PDF load error:', err);
        setError(err.message || 'Failed to load PDF');
        setIsLoading(false);
      }
    }

    loadPdf();
    return () => {
      destroyed = true;
      if (pdfRef.current) {
        try { pdfRef.current.destroy(); } catch {}
        pdfRef.current = null;
      }
    };
  }, [filePath, containerId, scale]);

  // Track current page via scroll + extract visible text
  useEffect(() => {
    if (!isReady) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const handleScroll = () => {
      const pages = container.querySelectorAll('.pdf-page-wrapper');
      const containerRect = container.getBoundingClientRect();
      let bestPage = 1;
      let bestOverlap = 0;

      pages.forEach((pageEl) => {
        const rect = pageEl.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top));
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestPage = parseInt(pageEl.getAttribute('data-page') || '1');
        }
      });

      setCurrentPage(bestPage);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isReady, containerId]);

  // Update visible text when current page changes
  useEffect(() => {
    if (!pdfRef.current || !isReady) return;
    const pdf = pdfRef.current;
    pdf.getPage(currentPage).then(page => {
      page.getTextContent().then(tc => {
        const text = tc.items.map((i: any) => i.str || '').join(' ');
        setVisibleText(text);
      }).catch(() => {});
    }).catch(() => {});
  }, [currentPage, isReady]);

  // Text selection listener
  useEffect(() => {
    if (!isReady) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const handleMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text) {
        setSelectedText({ text, page: currentPage });
      }
    };

    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
  }, [isReady, containerId, currentPage]);

  const goToPage = useCallback((pageNum: number, topOffset?: number | null) => {
    const container = document.getElementById(containerId);
    const el = document.getElementById(`pdf-page-${pageNum}`);
    if (container instanceof HTMLElement && el instanceof HTMLElement) {
      let resolvedTopOffset = topOffset;
      if (resolvedTopOffset == null) {
        const firstMatchingItem = flattenPdfItems(tocRef.current).find(
          (item) => item.pageNumber === pageNum && item.topOffset != null,
        );
        resolvedTopOffset = firstMatchingItem?.topOffset ?? null;
      }

      const pageCanvas = el.querySelector('canvas') as HTMLCanvasElement | null;
      const renderedHeight = pageCanvas?.getBoundingClientRect().height || el.getBoundingClientRect().height || 0;
      const sourceHeight = pageCanvas?.height || renderedHeight || 1;
      const scaleRatio = renderedHeight && sourceHeight ? renderedHeight / sourceHeight : 1;
      const offsetWithinPage = resolvedTopOffset != null
        ? Math.max(0, sourceHeight - resolvedTopOffset) * scaleRatio
        : 0;
      const scrollTop = el.offsetTop - container.offsetTop + offsetWithinPage;

      container.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      setCurrentPage(pageNum);
    }
  }, [containerId]);

  const clearSelection = useCallback(() => {
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return {
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
  };
}
