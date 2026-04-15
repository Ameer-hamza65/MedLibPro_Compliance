import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Image file extensions we extract from EPUBs
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tiff", "tif"]);

function getImageMimeType(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
    bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff",
  };
  return map[ext] || "application/octet-stream";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookId } = await req.json();
    if (!bookId) {
      return new Response(JSON.stringify({ error: "bookId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: book, error: bookErr } = await supabase
      .from("books")
      .select("*")
      .eq("id", bookId)
      .single();

    if (bookErr || !book) {
      return new Response(JSON.stringify({ error: `Book not found: ${bookErr?.message}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing book ${book.id}: "${book.title}" (${book.file_type}), file: ${book.file_path}`);

    if (!book.file_path) {
      return new Response(JSON.stringify({ error: "Book has no file_path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from("book-files")
      .download(book.file_path);

    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ error: `File download failed: ${dlErr?.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`Downloaded ${fileBytes.length} bytes`);

    let metadata: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      isbn?: string;
      edition?: string;
      publishedYear?: number;
      description?: string;
      specialty?: string;
      detectedTags?: string[];
      chapters?: Array<{ title: string; pageNumber: number; content?: string; contentSummary?: string; category?: string }>;
      imagesUploaded?: number;
    } = {};

    if (book.file_type === "epub") {
      try {
        metadata = await parseEpubFull(fileBytes, bookId, supabase, SUPABASE_URL);
      } catch (epubErr) {
        console.error("Full EPUB parse failed, trying metadata fallback:", epubErr);
        try {
          metadata = extractMetadataFallback(unzipSync(fileBytes));
        } catch { metadata = {}; }
      }
    } else if (book.file_type === "pdf") {
      metadata = await parsePdfWithAI(fileBytes, book.title, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }

    console.log(`Parsed metadata: title="${metadata.title}", ${metadata.chapters?.length || 0} chapters, ${metadata.authors?.length || 0} authors, ${metadata.imagesUploaded || 0} images`);

    // Update book record
    const updateData: Record<string, unknown> = {};
    if (metadata.title && metadata.title !== book.isbn) updateData.title = metadata.title;
    if (metadata.subtitle) updateData.subtitle = metadata.subtitle;
    if (metadata.authors?.length) updateData.authors = metadata.authors;
    if (metadata.publisher) updateData.publisher = metadata.publisher;
    if (metadata.description) updateData.description = metadata.description;
    if (metadata.edition) updateData.edition = metadata.edition;
    if (metadata.publishedYear && metadata.publishedYear > 0) updateData.published_year = metadata.publishedYear;
    if (metadata.specialty) updateData.specialty = metadata.specialty;
    if (metadata.detectedTags?.length) updateData.tags = metadata.detectedTags;
    if (metadata.chapters?.length) updateData.chapter_count = metadata.chapters.length;

    if (Object.keys(updateData).length > 0) {
      const { error: updateErr } = await supabase
        .from("books")
        .update(updateData)
        .eq("id", bookId);

      if (updateErr) {
        console.error("Book update error:", updateErr);
      } else {
        console.log(`Updated book metadata: ${JSON.stringify(Object.keys(updateData))}`);
      }
    }

    // Insert chapters
    if (metadata.chapters && metadata.chapters.length > 0) {
      await supabase.from("book_chapters").delete().eq("book_id", bookId);

      const chapterInserts = metadata.chapters.map((ch, idx) => ({
        book_id: bookId,
        chapter_key: `ch-${bookId.slice(0, 8)}-${idx + 1}`,
        title: ch.title,
        content: ch.content || "",
        page_number: ch.pageNumber || idx + 1,
        sort_order: idx,
        tags: ch.category ? [ch.category] : ([] as string[]),
      }));

      const { error: chapErr } = await supabase
        .from("book_chapters")
        .insert(chapterInserts);

      if (chapErr) {
        console.error("Chapter insert error:", chapErr);
      } else {
        console.log(`Inserted ${chapterInserts.length} chapters`);
      }
    }

    return new Response(JSON.stringify({
      status: "processed",
      bookId,
      title: metadata.title || book.title,
      chaptersCount: metadata.chapters?.length || 0,
      imagesUploaded: metadata.imagesUploaded || 0,
      fieldsUpdated: Object.keys(updateData),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-imported-book error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Image extraction helpers ──────────────────────────────────────────────────

async function extractAndUploadImages(
  unzipped: Record<string, Uint8Array>,
  opfDir: string,
  bookId: string,
  supabase: any,
  supabaseUrl: string,
): Promise<Map<string, string>> {
  const imageUrlMap = new Map<string, string>();
  const fileNames = Object.keys(unzipped);
  
  // Find all image files in the EPUB
  const imageFiles = fileNames.filter(name => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return IMAGE_EXTENSIONS.has(ext);
  });

  console.log(`Found ${imageFiles.length} image files in EPUB`);
  if (imageFiles.length === 0) return imageUrlMap;

  // Upload each image to the book-images bucket
  let uploaded = 0;
  for (const imgPath of imageFiles) {
    const imgData = unzipped[imgPath];
    if (!imgData || imgData.length === 0) continue;

    const ext = imgPath.split(".").pop()?.toLowerCase() || "png";
    const mimeType = getImageMimeType(ext);
    
    // Storage path: {bookId}/{filename}
    const fileName = imgPath.split("/").pop() || `image-${uploaded}.${ext}`;
    const storagePath = `${bookId}/${fileName}`;

    try {
      const { error: uploadErr } = await supabase.storage
        .from("book-images")
        .upload(storagePath, imgData, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadErr) {
        console.error(`Image upload error for ${imgPath}:`, uploadErr.message);
        continue;
      }

      // Build the public URL
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/book-images/${storagePath}`;

      // Map various possible reference paths to this URL
      // EPUB chapters may reference images with relative paths from their own location
      imageUrlMap.set(imgPath, publicUrl);
      
      // Also map just the filename
      imageUrlMap.set(fileName, publicUrl);
      
      // Map relative from OPF dir
      if (imgPath.startsWith(opfDir)) {
        imageUrlMap.set(imgPath.substring(opfDir.length), publicUrl);
      }
      
      // Map without leading directory components (common in relative refs)
      const parts = imgPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        imageUrlMap.set(parts.slice(i).join("/"), publicUrl);
      }

      uploaded++;
    } catch (err) {
      console.error(`Failed to upload image ${imgPath}:`, err);
    }
  }

  console.log(`Uploaded ${uploaded} images for book ${bookId}`);
  return imageUrlMap;
}

/**
 * Rewrite <img src="..."> attributes in HTML to use public storage URLs.
 */
function rewriteImageSrcs(html: string, imageUrlMap: Map<string, string>, chapterDir: string): string {
  if (imageUrlMap.size === 0) return html;
  
  return html.replace(/<img([^>]*)\ssrc="([^"]*)"([^>]*)\/?>/gi, (match, before, src, after) => {
    // Try exact match first
    let publicUrl = imageUrlMap.get(src);
    
    if (!publicUrl) {
      // Try resolving relative to chapter directory
      const resolved = resolveRelativePath(chapterDir, src);
      publicUrl = imageUrlMap.get(resolved);
    }
    
    if (!publicUrl) {
      // Try just the filename
      const fileName = src.split("/").pop() || "";
      publicUrl = imageUrlMap.get(fileName);
    }
    
    if (!publicUrl) {
      // Try decoded version
      try {
        const decoded = decodeURIComponent(src);
        publicUrl = imageUrlMap.get(decoded);
        if (!publicUrl) {
          const decodedFile = decoded.split("/").pop() || "";
          publicUrl = imageUrlMap.get(decodedFile);
        }
      } catch { /* ignore decode errors */ }
    }
    
    if (publicUrl) {
      return `<img${before} src="${publicUrl}"${after} />`;
    }
    
    // No match found, remove broken image reference
    return "";
  });
}

function resolveRelativePath(base: string, relative: string): string {
  if (relative.startsWith("/") || relative.startsWith("http")) return relative;
  const baseParts = base.split("/").filter(Boolean);
  const relParts = relative.split("/");
  
  for (const part of relParts) {
    if (part === "..") baseParts.pop();
    else if (part !== ".") baseParts.push(part);
  }
  return baseParts.join("/");
}

// ─── Front-matter patterns ────────────────────────────────────────────────────

const FRONT_MATTER_SKIP_PATTERNS = [
  /^cover$/i, /^title\s*page$/i, /^half\s*title/i, /^copyright/i, /^©/,
  /^all\s*rights\s*reserved/i, /^table\s*of\s*contents$/i, /^contents$/i,
  /^toc$/i, /^dedication$/i, /^epigraph$/i, /^frontispiece$/i,
  /^list\s*of\s*(figures|tables|illustrations|contributors|abbreviations)/i,
  /^series\s*page$/i, /^also\s*by/i, /^praise\s*for/i, /^endorsements?$/i,
  /^blank\s*page$/i,
];

const FRONT_MATTER_CATEGORY_PATTERNS = [
  /^preface/i, /^foreword/i, /^acknowledgm/i, /^about\s*the\s*authors?$/i,
  /^contributors?$/i, /^introduction$/i, /^references?$/i, /^bibliography$/i,
  /^glossary$/i, /^index$/i, /^notes?$/i,
];

const APPENDIX_PATTERNS = [/^appendix/i, /^appendices/i];

const FRONT_MATTER_HREF_PATTERNS = [
  /cover\./i, /titlepage\./i, /copyright\./i, /^toc\./i, /nav\.x?html/i,
];

function isFrontMatter(title: string, href: string): boolean {
  const t = title.trim();
  if (FRONT_MATTER_SKIP_PATTERNS.some(p => p.test(t))) return true;
  if (FRONT_MATTER_HREF_PATTERNS.some(p => p.test(href))) return true;
  return false;
}

function categorizeChapter(title: string): "front-matter" | "chapter" | "appendix" {
  const t = title.trim();
  if (FRONT_MATTER_CATEGORY_PATTERNS.some(p => p.test(t))) return "front-matter";
  if (APPENDIX_PATTERNS.some(p => p.test(t))) return "appendix";
  return "chapter";
}

function isContentFrontMatter(content: string): boolean {
  const plain = content.replace(/<[^>]*>/g, "").trim();
  if (plain.length < 500 && /©|\bcopyright\b|all rights reserved|printed in|ISBN|Library of Congress/i.test(plain)) return true;
  if (plain.length < 300) {
    const lines = plain.split(/\n/).filter(l => l.trim()).length;
    if (lines <= 5 && /university press|publisher|press\b/i.test(plain)) return true;
  }
  return false;
}

// ─── Clean HTML ────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  "h1","h2","h3","h4","h5","h6","p","div","span","br",
  "ul","ol","li",
  "table","thead","tbody","tfoot","tr","th","td","caption","colgroup","col",
  "blockquote","pre","code","strong","em","b","i","u","sub","sup","s",
  "figure","figcaption","img","a","abbr","cite","dfn","small",
  "dl","dt","dd","section","article","aside","header","footer","hr",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

const SAFE_ATTR_MAP: Record<string, Set<string>> = {
  img: new Set(["src", "alt"]),
  a: new Set(["href"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
};

function cleanHtml(html: string): string {
  let s = html;

  // 1. Remove unwanted element blocks entirely
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<link[^>]*\/?>/gi, "");
  s = s.replace(/<meta[^>]*\/?>/gi, "");
  s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  s = s.replace(/<object[\s\S]*?<\/object>/gi, "");
  s = s.replace(/<embed[^>]*\/?>/gi, "");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Remove EPUB pagebreak markers
  s = s.replace(/<[^>]*epub:type\s*=\s*["']pagebreak["'][^>]*\/?>/gi, "");
  s = s.replace(/<[^>]*role\s*=\s*["']doc-pagebreak["'][^>]*\/?>/gi, "");

  // 2. Extract body content
  const bodyMatch = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];

  // Normalize &nbsp; to regular space
  s = s.replace(/&nbsp;/g, " ");

  // ── NEW: Remove metadata/copyright/contact blocks ──
  // Remove ChapterContextInformation blocks (copyright, DOI, series info)
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*ChapterContextInformation[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, "");
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*ContextInformation[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*ChapterCopyright[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<span[^>]*class\s*=\s*["'][^"']*ChapterDOI[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
  
  // Remove author contact blocks
  s = s.replace(/<div[^>]*id\s*=\s*["']ContactOfAuthor[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "");
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*Contact[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*AuthorGroup[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  
  // Remove ContextInformation wrapper divs (nested DOI, series, editors)
  s = s.replace(/<span[^>]*class\s*=\s*["'][^"']*ContextInformationAuthorEditorNames[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
  s = s.replace(/<span[^>]*class\s*=\s*["'][^"']*ContextInformationBookTitles[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
  s = s.replace(/<span[^>]*class\s*=\s*["'][^"']*ContextInformationSeries[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");

  // ── NEW: Convert class="Heading" elements to proper heading tags ──
  // <p class="Heading">text</p> → <h2>text</h2>
  s = s.replace(/<p[^>]*class\s*=\s*["'][^"']*Heading[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi, "<h2>$1</h2>");
  // <span class="Heading">text</span> → <h3>text</h3>  
  s = s.replace(/<span[^>]*class\s*=\s*["'][^"']*Heading[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, "<h3>$1</h3>");
  // <div class="Heading">text</div> → <h2>text</h2>
  s = s.replace(/<div[^>]*class\s*=\s*["'][^"']*Heading[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, "<h2>$1</h2>");

  // 3. Strip disallowed tags but KEEP their inner content
  s = s.replace(/<\/(\w+)\s*>/gi, (_match, tag) => {
    const lower = tag.toLowerCase();
    if (ALLOWED_TAGS.has(lower)) return `</${lower}>`;
    return "";
  });

  // Process opening/self-closing tags
  s = s.replace(/<(\w+)((?:\s+[^>]*)?)\s*\/?>/gi, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";

    if (VOID_TAGS.has(lower)) {
      const cleaned = cleanAttributes(lower, attrs || "");
      return `<${lower}${cleaned} />`;
    }

    const cleaned = cleanAttributes(lower, attrs || "");
    return `<${lower}${cleaned}>`;
  });

  // 4. Light formatting cleanup
  s = s.replace(/(<br\s*\/?>[\s]*){3,}/gi, "</p>\n<p>");
  s = s.replace(/<(p|div|span)>\s*<\/\1>/gi, "");

  // Wrap orphan text nodes between block elements into <p> tags
  s = s.replace(/(<\/(h[1-6]|p|div|blockquote|ul|ol|table|figure|section|article)>)\s*\n?\s*([^<\s][^<]+[^<\s])\s*\n?\s*(<(h[1-6]|p|div|blockquote|ul|ol|table|figure|section|article))/gi,
    "$1\n<p>$3</p>\n$4");

  // Ensure block elements have newlines around them
  const blockTags = "h[1-6]|p|div|blockquote|table|thead|tbody|tfoot|ul|ol|figure|section|article|hr|pre|dl";
  s = s.replace(new RegExp(`(<\\/?(${blockTags})[^>]*>)`, "gi"), "\n$1\n");

  // Collapse excessive newlines
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

function cleanAttributes(tag: string, attrStr: string): string {
  const allowed = SAFE_ATTR_MAP[tag];
  if (!allowed) return "";

  const parts: string[] = [];
  const regex = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m;
  while ((m = regex.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    if (allowed.has(name)) {
      parts.push(`${name}="${value}"`);
    }
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── EPUB Parser ───────────────────────────────────────────────────────────────

async function parseEpubFull(
  epubBytes: Uint8Array,
  bookId: string,
  supabase: any,
  supabaseUrl: string,
): Promise<{
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  isbn?: string;
  description?: string;
  publishedYear?: number;
  chapters?: Array<{ title: string; pageNumber: number; content: string; category: string }>;
  imagesUploaded?: number;
}> {
  try {
    const unzipped = unzipSync(epubBytes);
    const fileNames = Object.keys(unzipped);
    console.log(`EPUB contains ${fileNames.length} files`);

    const getFileText = (name: string): string | undefined => {
      const data = unzipped[name];
      return data ? new TextDecoder("utf-8", { fatal: false }).decode(data) : undefined;
    };

    // Find OPF
    const containerXml = getFileText("META-INF/container.xml");
    let opfPath = "";
    if (containerXml) {
      const m = containerXml.match(/full-path="([^"]+)"/);
      if (m) opfPath = m[1];
    }
    if (!opfPath) {
      const f = fileNames.find(n => n.endsWith(".opf"));
      if (f) opfPath = f;
    }
    if (!opfPath) return extractMetadataFallback(unzipped);

    const opfXml = getFileText(opfPath);
    if (!opfXml) return extractMetadataFallback(unzipped);

    const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

    // Metadata
    const getTag = (tag: string) => {
      const m = opfXml.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "i"));
      return m ? m[1].trim().replace(/<[^>]+>/g, "") : undefined;
    };
    const getAllTags = (tag: string) => {
      const results: string[] = [];
      const regex = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "gi");
      let m;
      while ((m = regex.exec(opfXml)) !== null) {
        const v = m[1].trim().replace(/<[^>]+>/g, "");
        if (v) results.push(v);
      }
      return results;
    };

    const title = getTag("title");
    const authors = getAllTags("creator");
    const publisher = getTag("publisher");
    const description = getTag("description")?.replace(/<[^>]+>/g, "").trim();
    const dateStr = getTag("date");
    let publishedYear: number | undefined;
    if (dateStr) {
      const ym = dateStr.match(/(\d{4})/);
      if (ym) publishedYear = parseInt(ym[1], 10);
    }

    // ── Extract and upload images ──
    const imageUrlMap = await extractAndUploadImages(unzipped, opfDir, bookId, supabase, supabaseUrl);

    // Spine
    const spineIds = [...opfXml.matchAll(/<itemref\s+idref="([^"]+)"/gi)].map(m => m[1]);

    // Manifest
    const manifestMap = new Map<string, string>();
    const mRe1 = /<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*/gi;
    let mm;
    while ((mm = mRe1.exec(opfXml)) !== null) manifestMap.set(mm[1], mm[2]);
    const mRe2 = /<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*/gi;
    while ((mm = mRe2.exec(opfXml)) !== null) if (!manifestMap.has(mm[2])) manifestMap.set(mm[2], mm[1]);

    // NCX titles
    const ncxTitles = new Map<string, string>();
    const ncxIdMatch = [...opfXml.matchAll(/<item\s+[^>]*id="([^"]+)"[^>]*media-type="application\/x-dtbncx\+xml"[^>]*/gi)];
    if (ncxIdMatch.length > 0) {
      const ncxHref = manifestMap.get(ncxIdMatch[0][1]);
      if (ncxHref) {
        const ncxXml = getFileText(opfDir + decodeURIComponent(ncxHref));
        if (ncxXml) {
          const navPoints = [...ncxXml.matchAll(/<navPoint[^>]*>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\s+src="([^"]*)"[\s\S]*?<\/navPoint>/gi)];
          for (const np of navPoints) {
            ncxTitles.set(np[2].split("#")[0], np[1].trim());
          }
        }
      }
    }

    // Extract chapters with CLEAN HTML + image URL rewriting
    const chapters: Array<{ title: string; pageNumber: number; content: string; category: string }> = [];
    let pageNum = 1;

    for (const spineId of spineIds) {
      const href = manifestMap.get(spineId);
      if (!href) continue;

      const fullPath = opfDir + decodeURIComponent(href);
      const rawHtml = getFileText(fullPath);
      if (!rawHtml) continue;

      // Get chapter title
      let chapterTitle = ncxTitles.get(href) || ncxTitles.get(decodeURIComponent(href));
      if (!chapterTitle) {
        const h1Match = rawHtml.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
        const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        chapterTitle = (h1Match?.[1] || titleMatch?.[1] || "").replace(/<[^>]+>/g, "").trim();
      }

      // Skip front-matter by title/href
      if (isFrontMatter(chapterTitle || "", href)) continue;

      // Extract CLEAN HTML (preserving headings, tables, lists, images)
      let cleanContent = cleanHtml(rawHtml);
      const plainText = htmlToPlainText(rawHtml);

      // Skip very short content
      if (plainText.length < 50) continue;

      // Skip content-based front-matter
      if (isContentFrontMatter(cleanContent)) continue;

      // Rewrite image src attributes to point to uploaded storage URLs
      const chapterDir = fullPath.includes("/") ? fullPath.substring(0, fullPath.lastIndexOf("/") + 1) : "";
      cleanContent = rewriteImageSrcs(cleanContent, imageUrlMap, chapterDir);

      if (!chapterTitle) chapterTitle = `Chapter ${chapters.length + 1}`;

      const category = categorizeChapter(chapterTitle);

      chapters.push({
        title: chapterTitle,
        pageNumber: pageNum,
        content: cleanContent,
        category,
      });

      pageNum += Math.max(1, Math.ceil(plainText.length / 3000));
    }

    return {
      title,
      authors: authors.length > 0 ? authors : undefined,
      publisher,
      description,
      publishedYear,
      chapters: chapters.length > 0 ? chapters : undefined,
      imagesUploaded: imageUrlMap.size > 0 ? new Set([...imageUrlMap.values()]).size : 0,
    };
  } catch (err) {
    console.error("EPUB full parse error:", err);
    try {
      return extractMetadataFallback(unzipSync(epubBytes));
    } catch {
      return {};
    }
  }
}

function extractMetadataFallback(unzipped: Record<string, Uint8Array>) {
  for (const [name, data] of Object.entries(unzipped)) {
    if (!name.endsWith(".opf")) continue;
    const opf = new TextDecoder("utf-8", { fatal: false }).decode(data);
    const getTag = (tag: string) => {
      const m = opf.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "i"));
      return m ? m[1].trim().replace(/<[^>]+>/g, "") : undefined;
    };
    const getAllTags = (tag: string) => {
      const results: string[] = [];
      const regex = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "gi");
      let m;
      while ((m = regex.exec(opf)) !== null) results.push(m[1].trim().replace(/<[^>]+>/g, ""));
      return results;
    };
    return {
      title: getTag("title"),
      authors: getAllTags("creator"),
      publisher: getTag("publisher"),
      description: getTag("description")?.replace(/<[^>]+>/g, "").trim(),
    };
  }
  return {};
}

// ─── PDF Parser (AI-based) ─────────────────────────────────────────────────────

async function parsePdfWithAI(
  pdfBytes: Uint8Array,
  currentTitle: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{
  title?: string; subtitle?: string; authors?: string[]; publisher?: string;
  isbn?: string; edition?: string; publishedYear?: number; description?: string;
  specialty?: string; detectedTags?: string[];
  chapters?: Array<{ title: string; pageNumber: number; contentSummary?: string }>;
}> {
  try {
    const slice = pdfBytes.slice(0, 5 * 1024 * 1024);
    // Convert in chunks to avoid stack overflow with spread operator
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < slice.length; i += chunkSize) {
      binary += String.fromCharCode(...slice.subarray(i, Math.min(i + chunkSize, slice.length)));
    }
    const base64 = btoa(binary);
    const response = await fetch(`${supabaseUrl}/functions/v1/parse-pdf`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pdfBase64: base64, fileName: currentTitle, firstPagesOnly: false }),
    });
    if (!response.ok) {
      console.error("parse-pdf call failed:", response.status, await response.text());
      return {};
    }
    return await response.json();
  } catch (err) {
    console.error("PDF AI parse error:", err);
    return {};
  }
}
