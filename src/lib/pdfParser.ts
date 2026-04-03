/**
 * Client-side PDF parser using pdf.js
 * Extracts text with formatting (headings, paragraphs, lists) and images from PDFs.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { ParsedChapter, autoDetectMedicalTags } from '@/lib/epubParser';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PageContent {
  pageNumber: number;
  html: string;
  images: string[];
  headings: string[];
}

interface TextLine {
  y: number;
  x: number; // leftmost x position
  items: TextItem[];
  text: string;
  fontSize: number;
  isBold: boolean;
}

/**
 * Extract images from a single PDF page by rendering to canvas.
 */
async function extractPageImages(page: pdfjsLib.PDFPageProxy): Promise<string[]> {
  const images: string[] = [];
  try {
    const ops = await page.getOperatorList();
    const hasImages = ops.fnArray.some(
      (fn: number) =>
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintXObject ||
        fn === pdfjsLib.OPS.paintImageXObjectRepeat
    );
    if (!hasImages) return images;

    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return images;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );

    if (blob && blob.size > 5000) {
      images.push(URL.createObjectURL(blob));
    }

    canvas.width = 0;
    canvas.height = 0;
  } catch (e) {
    console.warn(`Image extraction failed for page ${page.pageNumber}:`, e);
  }
  return images;
}

/**
 * Group text items into lines, preserving position and font info.
 */
function buildLines(items: TextItem[]): TextLine[] {
  const Y_TOLERANCE = 3;
  const lineMap: TextLine[] = [];

  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const fontSize = item.height || 12;
    const fontName = (item as any).fontName || '';
    const isBold = /bold/i.test(fontName) || /Black/i.test(fontName);

    const existing = lineMap.find((l) => Math.abs(l.y - y) < Y_TOLERANCE);
    if (existing) {
      existing.items.push(item);
      existing.x = Math.min(existing.x, x);
      // Use max font size for the line
      if (fontSize > existing.fontSize) existing.fontSize = fontSize;
      if (isBold) existing.isBold = true;
    } else {
      lineMap.push({ y, x, items: [item], text: '', fontSize, isBold });
    }
  }

  // Sort lines top-to-bottom (PDF Y is bottom-up)
  lineMap.sort((a, b) => b.y - a.y);

  // Build text for each line (left-to-right)
  for (const line of lineMap) {
    line.items.sort((a, b) => a.transform[4] - b.transform[4]);
    line.text = line.items.map((i) => i.str).join(' ').trim();
  }

  return lineMap.filter((l) => l.text.length > 0);
}

/**
 * Classify a line as heading, subheading, or body based on font metrics.
 */
function classifyLine(
  line: TextLine,
  medianFontSize: number
): 'h2' | 'h3' | 'p' {
  if (line.fontSize >= medianFontSize * 1.5) return 'h2';
  if (line.fontSize >= medianFontSize * 1.25 || (line.isBold && line.fontSize >= medianFontSize * 1.1)) return 'h3';
  return 'p';
}

/**
 * Detect if a line looks like a list item (starts with bullet, dash, number, or letter pattern).
 */
function isListItem(text: string): boolean {
  return /^(\d+[\.\)]\s|[a-z][\.\)]\s|[-•▪▸►◦]\s|–\s)/i.test(text);
}

/**
 * Detect if a page looks like a Table of Contents (many lines ending with page numbers).
 */
function isTOCPage(lines: TextLine[]): boolean {
  if (lines.length < 4) return false;
  // Check if page has a "contents" or "table of contents" heading
  const hasContentsHeading = lines.some(l => /^(table\s+of\s+)?contents$/i.test(l.text.trim()));
  // Check if many lines end with a number (page references)
  const linesEndingWithNumber = lines.filter(l => /\d+\s*$/.test(l.text.trim()) && l.text.trim().length > 3);
  const ratio = linesEndingWithNumber.length / lines.length;
  return hasContentsHeading || ratio > 0.4;
}

/**
 * Render a full page as an image for layout-preserving display (e.g. TOC pages).
 */
async function renderPageAsImage(page: pdfjsLib.PDFPageProxy): Promise<string | null> {
  try {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    canvas.width = 0;
    canvas.height = 0;
    if (blob) return URL.createObjectURL(blob);
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect if a page has complex layout (tables, multi-column, diagrams) that
 * is better rendered as a full-page image.
 */
function hasComplexLayout(lines: TextLine[]): boolean {
  if (lines.length < 3) return false;

  // Detect tables: multiple distinct x-column clusters
  const xPositions = lines.map((l) => Math.round(l.x / 20) * 20); // bucket by 20px
  const uniqueXClusters = new Set(xPositions).size;
  if (uniqueXClusters >= 3 && lines.length > 6) return true;

  // Detect TOC: many lines ending with page numbers
  const hasContentsHeading = lines.some(l => /^(table\s+of\s+)?contents$/i.test(l.text.trim()));
  const linesEndingWithNumber = lines.filter(l => /\d+\s*$/.test(l.text.trim()) && l.text.trim().length > 3);
  if (hasContentsHeading || linesEndingWithNumber.length / lines.length > 0.4) return true;

  return false;
}

/**
 * Extract structured content from a single PDF page.
 * Pages with complex layouts (tables, TOC, multi-column) are rendered as full-page images.
 * Simple text pages use structured HTML extraction with hidden searchable text.
 */
async function extractPageContent(
  page: pdfjsLib.PDFPageProxy,
  extractImgs: boolean
): Promise<PageContent> {
  const textContent = await page.getTextContent();
  const items = textContent.items.filter(
    (item): item is TextItem => 'str' in item
  );

  const lines = buildLines(items);

  // Extract searchable plain text for all pages (used for AI/search)
  const searchableText = lines.map((l) => l.text).join('\n');

  // Render page as high-quality image — this preserves ALL formatting
  const pageImage = await renderPageAsImage(page);

  // Only do separate embedded-image extraction if full-page rendering failed.
  // When pageImage exists, it already preserves all images in original layout.
  const embeddedImages = !pageImage && extractImgs ? await extractPageImages(page) : [];

  // Collect headings from text for chapter detection
  const headings: string[] = [];
  if (lines.length > 0) {
    const fontSizes = lines.map((l) => l.fontSize).sort((a, b) => a - b);
    const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 12;
    for (const line of lines) {
      const cls = classifyLine(line, medianFontSize);
      if (cls === 'h2' || cls === 'h3') headings.push(line.text);
    }
  }

  // Build HTML: page image as primary display + hidden searchable text
  const htmlParts: string[] = [];

  if (pageImage) {
    htmlParts.push(
      `<figure class="pdf-page-render"><img src="${pageImage}" alt="Page ${page.pageNumber}" style="max-width:100%;height:auto;border-radius:4px;" /></figure>`
    );
    // Hidden searchable text layer
    if (searchableText.trim()) {
      htmlParts.push(
        `<div class="sr-only" aria-hidden="true">${searchableText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      );
    }
  } else {
    // Fallback: if image rendering failed, use structured text extraction
    if (items.length === 0) {
      for (const img of embeddedImages) {
        htmlParts.push(`<figure><img src="${img}" alt="Page ${page.pageNumber}" style="max-width:100%;height:auto;" /></figure>`);
      }
    } else {
      // Build structured HTML as fallback
      const fontSizes = lines.map((l) => l.fontSize).sort((a, b) => a - b);
      const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 12;
      const leftPositions = lines.map((l) => l.x).sort((a, b) => a - b);
      const medianLeft = leftPositions[Math.floor(leftPositions.length / 4)] || 0;
      const INDENT_THRESHOLD = 20;
      const gaps: number[] = [];
      for (let i = 1; i < lines.length; i++) {
        gaps.push(lines[i - 1].y - lines[i].y);
      }
      const medianGap = gaps.length > 0 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 14;

      let currentParagraphLines: string[] = [];
      let inList = false;
      let listItemsArr: string[] = [];

      const flushParagraph = () => {
        if (currentParagraphLines.length > 0) {
          htmlParts.push(`<p>${currentParagraphLines.join(' ')}</p>`);
          currentParagraphLines = [];
        }
      };

      const flushList = () => {
        if (listItemsArr.length > 0) {
          htmlParts.push(`<ul>${listItemsArr.map((li) => `<li>${li}</li>`).join('')}</ul>`);
          listItemsArr = [];
          inList = false;
        }
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const classification = classifyLine(line, medianFontSize);
        const gap = i > 0 ? lines[i - 1].y - line.y : medianGap;
        const isLargeGap = gap > medianGap * 1.8;
        const lineIsListItem = isListItem(line.text);

        if (classification === 'h2' || classification === 'h3') {
          flushList();
          flushParagraph();
          htmlParts.push(`<${classification}>${line.text}</${classification}>`);
        } else if (lineIsListItem) {
          flushParagraph();
          if (!inList) inList = true;
          const cleanText = line.text.replace(/^(\d+[\.\)]\s|[a-z][\.\)]\s|[-•▪▸►◦]\s|–\s)/i, '');
          listItemsArr.push(cleanText || line.text);
        } else {
          if (inList) flushList();
          if (isLargeGap) flushParagraph();
          currentParagraphLines.push(line.text);
        }
      }
      flushList();
      flushParagraph();

      for (const img of embeddedImages) {
        htmlParts.push(`<figure><img src="${img}" alt="Page ${page.pageNumber} image" style="max-width:100%;height:auto;" /></figure>`);
      }
    }
  }

  const allImages = pageImage ? [pageImage, ...embeddedImages] : embeddedImages;

  return {
    pageNumber: page.pageNumber,
    html: htmlParts.join('\n'),
    images: allImages,
    headings,
  };
}

/**
 * Group pages into chapters using ONLY AI-detected chapter boundaries from the TOC.
 */
function groupPagesIntoChapters(
  pages: PageContent[],
  aiChapters?: { title: string; pageNumber: number }[]
): ParsedChapter[] {
  if (aiChapters && aiChapters.length > 0) {
    const sortedChapters = [...aiChapters].sort(
      (a, b) => (a.pageNumber || 1) - (b.pageNumber || 1)
    );

    return sortedChapters.map((ch, idx) => {
      const startPage = ch.pageNumber || 1;
      const endPage =
        idx < sortedChapters.length - 1
          ? (sortedChapters[idx + 1].pageNumber || startPage + 1) - 1
          : pages.length;

      const chapterPages = pages.filter(
        (p) => p.pageNumber >= startPage && p.pageNumber <= endPage
      );

      const html = chapterPages.map((p) => p.html).join('\n');

      return {
        id: `ch-pdf-${Date.now()}-${idx + 1}`,
        title: ch.title,
        content: html,
        pageNumber: startPage,
        href: '',
        tags: autoDetectMedicalTags(ch.title + ' ' + html.replace(/<[^>]*>/g, '').slice(0, 500)),
      };
    }).filter((ch) => ch.content.replace(/<[^>]*>/g, '').trim().length > 0);
  }

  // Fallback: single chapter
  if (pages.length > 0) {
    const html = pages.map((p) => p.html).join('\n');
    return [{
      id: `ch-pdf-${Date.now()}-1`,
      title: 'Full Document',
      content: html,
      pageNumber: 1,
      href: '',
      tags: [],
    }];
  }

  return [];
}

/**
 * Extract the full PDF as base64 for AI metadata extraction.
 */
export async function extractFirstPagesBase64(
  file: File,
  _maxPages: number = 3
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface PdfParseResult {
  pages: PageContent[];
  chapters: ParsedChapter[];
  totalPages: number;
}

/**
 * Main entry: parse a PDF file client-side.
 */
export async function parsePdfClientSide(
  file: File,
  onProgress?: (progress: number) => void,
  aiChapters?: { title: string; pageNumber: number }[]
): Promise<PdfParseResult> {
  const arrayBuffer = await file.arrayBuffer();
  onProgress?.(10);

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  onProgress?.(15);

  const pages: PageContent[] = [];

  const BATCH_SIZE = 8;
  for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH_SIZE, totalPages + 1); j++) {
      batch.push(j);
    }

    const batchResults = await Promise.all(
      batch.map(async (pageNum) => {
        const page = await pdf.getPage(pageNum);
        try {
          return await extractPageContent(page, true);
        } finally {
          page.cleanup();
        }
      })
    );

    pages.push(...batchResults);

    const progress = 15 + Math.round((i / totalPages) * 70);
    onProgress?.(Math.min(progress, 85));
  }

  onProgress?.(88);

  const chapters = groupPagesIntoChapters(pages, aiChapters);

  pdf.destroy();
  onProgress?.(95);

  return { pages, chapters, totalPages };
}
