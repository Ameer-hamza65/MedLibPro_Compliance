import { EpubBook } from '@/data/mockEpubData';

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function getBookMetadataRank(book: EpubBook, rawQuery: string) {
  const query = normalize(rawQuery);
  if (!query) return 0;

  let rank = 0;
  const title = normalize(book.title);
  const subtitle = normalize(book.subtitle || '');
  const authors = normalize(book.authors.join(' '));
  const publisher = normalize(book.publisher || '');
  const specialty = normalize(book.specialty || '');
  const tags = normalize((book.tags || []).join(' '));
  const description = normalize(book.description || '');
  const year = String(book.publishedYear || '');

  if (title === query) rank += 140;
  else if (title.startsWith(query)) rank += 120;
  else if (title.includes(query)) rank += 100;

  if (subtitle.includes(query)) rank += 70;
  if (authors.includes(query)) rank += 80;
  if (tags.includes(query)) rank += 75;
  if (publisher.includes(query)) rank += 60;
  if (specialty.includes(query)) rank += 60;
  if (description.includes(query)) rank += 50;
  if (year && rawQuery.trim().includes(year)) rank += 40;

  return rank;
}

export function buildHighlightedSnippet(text: string, rawQuery: string, radius = 110) {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const query = rawQuery.trim();

  if (!cleanText) return '';
  if (!query) return escapeHtml(cleanText.slice(0, radius * 2));

  const lowerText = cleanText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    const preview = cleanText.slice(0, radius * 2);
    return `${escapeHtml(preview)}${cleanText.length > preview.length ? '…' : ''}`;
  }

  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(cleanText.length, matchIndex + query.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < cleanText.length ? '…' : '';

  return `${prefix}${escapeHtml(cleanText.slice(start, matchIndex))}<mark>${escapeHtml(cleanText.slice(matchIndex, matchIndex + query.length))}</mark>${escapeHtml(cleanText.slice(matchIndex + query.length, end))}${suffix}`;
}

export function buildBookMetadataText(book: EpubBook) {
  return [
    book.title,
    book.subtitle,
    book.authors.join(' '),
    book.publisher,
    book.specialty,
    (book.tags || []).join(' '),
    book.description,
    book.publishedYear,
  ].filter(Boolean).join(' ');
}