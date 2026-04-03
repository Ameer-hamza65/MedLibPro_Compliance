import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfAiPreviewPayload {
  pageImages: string[];
  pageTexts: string[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Failed to convert PDF preview image to data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read PDF preview image'));
    reader.readAsDataURL(blob);
  });
}

function extractPlainText(items: TextItem[]): string {
  return items
    .filter((item) => item.str.trim())
    .map((item) => item.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderPagePreview(page: pdfjsLib.PDFPageProxy): Promise<string | null> {
  const viewport = page.getViewport({ scale: 1.15 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
    return blob ? await blobToDataUrl(blob) : null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function extractPdfAiPreview(
  file: File,
  maxPages: number = 20,
  maxImagePages: number = 8
): Promise<PdfAiPreviewPayload> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  try {
    const pageTexts: string[] = [];
    const pageImages: string[] = [];
    const totalPages = Math.min(pdf.numPages, maxPages);

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);

      // Only render images for the first few pages (title page, copyright, TOC visuals)
      const needsImage = pageNumber <= maxImagePages;

      const [textContent, previewImage] = await Promise.all([
        page.getTextContent(),
        needsImage ? renderPagePreview(page) : Promise.resolve(null),
      ]);

      const items = textContent.items.filter((item): item is TextItem => 'str' in item);
      pageTexts.push(extractPlainText(items));

      if (previewImage) {
        pageImages.push(previewImage);
      }

      page.cleanup();
    }

    return { pageImages, pageTexts };
  } finally {
    pdf.destroy();
  }
}