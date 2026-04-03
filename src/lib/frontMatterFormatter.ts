/**
 * Front matter formatter — wraps EPUB front matter content in typed CSS containers
 * WITHOUT destroying existing HTML structure.
 */

type FMType = 'toc' | 'copyright' | 'dedication' | 'contributors' | 'preface' | 'generic';

function detectType(html: string): FMType {
  const text = html.replace(/<[^>]*>/g, '').toLowerCase();
  const first500 = text.slice(0, 500);

  if (/contents/.test(first500)) {
    const nums = (text.match(/\b\d{1,4}\b/g) || []).length;
    if (nums > 10) return 'toc';
  }
  if ((first500.includes('copyright') || first500.includes('isbn') || first500.includes('all rights reserved')) &&
      (first500.includes('published') || first500.includes('publisher') || first500.includes('springer') || first500.includes('elsevier')))
    return 'copyright';
  if (first500.includes('dedicated to') || first500.includes('dedication')) return 'dedication';
  if (first500.includes('contributors') || first500.includes('about the author') || first500.includes('list of contributors')) return 'contributors';
  if (first500.includes('foreword') || first500.includes('preface')) return 'preface';
  return 'generic';
}

/**
 * Main entry: wraps front matter content in a typed CSS container.
 * Returns null if not front matter (use original content).
 */
export function formatFrontMatterContent(
  content: string,
  chapterTitle: string,
  category?: string
): string | null {
  const isFrontMatter = category === 'front-matter';
  const titleLower = chapterTitle.toLowerCase();
  const looksLikeFrontMatter =
    isFrontMatter ||
    titleLower.includes('front matter') ||
    titleLower.includes('contents') ||
    titleLower.includes('copyright') ||
    titleLower.includes('dedication') ||
    titleLower.includes('acknowledgment') ||
    titleLower.includes('contributor') ||
    titleLower.includes('about the author') ||
    titleLower.includes('preface') ||
    titleLower.includes('foreword');

  if (!looksLikeFrontMatter) return null;
  if (!content || content.trim().length === 0) return null;

  const isHtml = /<[a-z][\s\S]*>/i.test(content);

  if (!isHtml) {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    if (paragraphs.length === 0) return null;
    let html = '<div class="fm-section fm-generic">';
    for (const para of paragraphs) {
      html += `<p>${para.trim().replace(/\n/g, '<br/>')}</p>`;
    }
    html += '</div>';
    return html;
  }

  // Detect if content has both a title/copyright section AND a TOC section
  const contentsIdx = content.search(/Contents<\/(?:div|h[1-6]|span|p)/i);
  
  if (contentsIdx > -1) {
    // Find the start of the opening tag that contains "Contents"
    const beforeContents = content.slice(0, contentsIdx);
    const lastTagOpen = beforeContents.lastIndexOf('<');
    const splitPoint = lastTagOpen > 0 ? lastTagOpen : contentsIdx;
    
    const titlePart = content.slice(0, splitPoint).trim();
    const tocPart = content.slice(splitPoint).trim();
    
    let result = '';
    
    if (titlePart) {
      const titleType = detectType(titlePart);
      result += `<div class="fm-section fm-${titleType}">${titlePart}</div>`;
      result += '<hr class="fm-divider" />';
    }
    
    result += '<div class="fm-section fm-toc">';
    result += '<h2 class="fm-section-title">Table of Contents</h2>';
    result += tocPart;
    result += '</div>';
    
    return result;
  }

  // Single section — wrap with detected type
  const type = detectType(content);
  
  let result = `<div class="fm-section fm-${type}">`;
  
  // Add section title for specific types
  if (type === 'copyright') {
    result += '<h2 class="fm-section-title">Copyright</h2>';
  } else if (type === 'dedication') {
    result += '<h2 class="fm-section-title">Dedication</h2>';
  } else if (type === 'contributors') {
    result += '<h2 class="fm-section-title">Contributors</h2>';
  } else if (type === 'preface') {
    result += '<h2 class="fm-section-title">Preface</h2>';
  } else if (type === 'toc') {
    result += '<h2 class="fm-section-title">Table of Contents</h2>';
  }
  
  result += content;
  result += '</div>';
  
  return result;
}
