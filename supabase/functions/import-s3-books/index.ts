import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── AWS SigV4 helpers ──────────────────────────────────────────────
async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...hash].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function signV4(method: string, url: string, headers: Record<string, string>, body: string, region: string, accessKey: string, secretKey: string) {
  const u = new URL(url);
  const dateStamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);

  headers["x-amz-date"] = dateStamp;
  headers["x-amz-content-sha256"] = await sha256Hex(body);
  headers["host"] = u.host;

  const signedHeaderKeys = Object.keys(headers).sort().map(k => k.toLowerCase());
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");
  const payloadHash = await sha256Hex(body);
  const canonicalRequest = [method, u.pathname, u.search.replace("?", ""), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, scope, await sha256Hex(canonicalRequest)].join("\n");

  let signingKey = new TextEncoder().encode("AWS4" + secretKey);
  for (const part of [shortDate, region, "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, part);
  }
  const signature = [...await hmac(signingKey, stringToSign)].map(b => b.toString(16).padStart(2, "0")).join("");

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

// ── S3 helpers ─────────────────────────────────────────────────────
interface S3Object { key: string; size: number; }

function parseS3ListXml(xml: string): S3Object[] {
  const objects: S3Object[] = [];
  const matches = xml.matchAll(/<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g);
  for (const m of matches) objects.push({ key: m[1], size: parseInt(m[2], 10) });
  return objects;
}

function getIsbn(key: string): string {
  const filename = key.split("/").pop() || "";
  return filename.replace(/\.(epub|pdf|jpg|jpeg|png)$/i, "");
}

async function s3List(bucket: string, region: string, accessKey: string, secretKey: string, prefix: string): Promise<string> {
  const params = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
  if (prefix) params.set("prefix", prefix);
  const url = `https://${bucket}.s3.${region}.amazonaws.com/?${params}`;
  const headers = await signV4("GET", url, {}, "", region, accessKey, secretKey);
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`S3 list failed [${resp.status}]: ${await resp.text()}`);
  return resp.text();
}

async function s3Download(bucket: string, region: string, accessKey: string, secretKey: string, key: string): Promise<Uint8Array> {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  const headers = await signV4("GET", url, {}, "", region, accessKey, secretKey);
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`S3 download failed [${resp.status}]: ${await resp.text()}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ── EPUB metadata extractor ────────────────────────────────────────
function extractEpubMetadata(opfContent: string): {
  title?: string; subtitle?: string; authors?: string[]; publisher?: string; description?: string;
} {
  const getTag = (tag: string): string | undefined => {
    const m = opfContent.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "i"));
    return m ? m[1].trim().replace(/<[^>]+>/g, "") : undefined;
  };
  const getAllTags = (tag: string): string[] => {
    const results: string[] = [];
    const regex = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "gi");
    let m;
    while ((m = regex.exec(opfContent)) !== null) {
      const val = m[1].trim().replace(/<[^>]+>/g, "");
      if (val) results.push(val);
    }
    return results;
  };
  return {
    title: getTag("title"),
    authors: getAllTags("creator").length ? getAllTags("creator") : undefined,
    publisher: getTag("publisher"),
    description: getTag("description")?.replace(/<[^>]+>/g, "").trim(),
  };
}

// ── EPUB chapter extractor ─────────────────────────────────────────
function extractEpubChapters(unzipped: Record<string, Uint8Array>, decoder: TextDecoder, opfContent: string, opfBasePath: string): Array<{
  chapter_key: string; title: string; content: string; sort_order: number;
}> {
  // Parse manifest
  const manifest = new Map<string, string>();
  const manifestRegex = /<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/?\s*>/gi;
  let mm;
  while ((mm = manifestRegex.exec(opfContent)) !== null) {
    manifest.set(mm[1], mm[2]);
  }

  // Parse spine
  const spineIds: string[] = [];
  const spineRegex = /<itemref\s+[^>]*idref="([^"]+)"[^>]*\/?\s*>/gi;
  while ((mm = spineRegex.exec(opfContent)) !== null) {
    spineIds.push(mm[1]);
  }

  const chapters: Array<{ chapter_key: string; title: string; content: string; sort_order: number }> = [];

  for (let i = 0; i < spineIds.length; i++) {
    const href = manifest.get(spineIds[i]);
    if (!href) continue;

    const fullPath = opfBasePath + decodeURIComponent(href);
    const fileData = unzipped[fullPath];
    if (!fileData) continue;

    const html = decoder.decode(fileData);

    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (textContent.length < 50) continue;

    let title = `Chapter ${i + 1}`;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const t = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      if (t && t.length < 200) title = t;
    }
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const t = h1Match[1].replace(/<[^>]+>/g, "").trim();
      if (t && t.length < 200) title = t;
    }

    chapters.push({
      chapter_key: `spine-${i}-${spineIds[i]}`,
      title,
      content: textContent.substring(0, 50000),
      sort_order: i,
    });
  }

  return chapters;
}

// ── Parse OPF from unzipped EPUB ───────────────────────────────────
function findOpf(unzipped: Record<string, Uint8Array>, decoder: TextDecoder): { opfContent: string; opfBasePath: string } | null {
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith(".opf")) {
      return {
        opfContent: decoder.decode(data),
        opfBasePath: name.includes("/") ? name.substring(0, name.lastIndexOf("/") + 1) : "",
      };
    }
  }
  const containerData = unzipped["META-INF/container.xml"];
  if (containerData) {
    const containerXml = decoder.decode(containerData);
    const m = containerXml.match(/full-path="([^"]+)"/);
    if (m && unzipped[m[1]]) {
      return {
        opfContent: decoder.decode(unzipped[m[1]]),
        opfBasePath: m[1].includes("/") ? m[1].substring(0, m[1].lastIndexOf("/") + 1) : "",
      };
    }
  }
  return null;
}

// ── Main handler ───────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
    const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    const AWS_S3_BUCKET = Deno.env.get("AWS_S3_BUCKET");
    const AWS_S3_REGION = Deno.env.get("AWS_S3_REGION") || "eu-north-1";

    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_S3_BUCKET) {
      throw new Error("Missing AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET)");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let prefix = "";
    let dryRun = false;
    let limit = 50;
    try {
      const body = await req.json();
      prefix = body.prefix || "";
      dryRun = body.dryRun === true;
      limit = body.limit || 50;
    } catch { /* no body is fine */ }

    console.log(`Listing S3 objects with prefix: "${prefix}"`);
    const xml = await s3List(AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, prefix);
    const allObjects = parseS3ListXml(xml);

    const epubs = allObjects.filter(o => /\.(epub|pdf)$/i.test(o.key));
    const covers = allObjects.filter(o => /\.(jpg|jpeg|png)$/i.test(o.key));
    const coverByIsbn = new Map<string, string>();
    for (const c of covers) coverByIsbn.set(getIsbn(c.key), c.key);

    console.log(`Found ${epubs.length} book files and ${covers.length} cover images`);

    const isbnList = epubs.map(e => getIsbn(e.key));
    const { data: existingBooks } = await supabase.from("books").select("isbn").in("isbn", isbnList);
    const existingIsbns = new Set((existingBooks || []).map(b => b.isbn));

    const allNewEpubs = epubs.filter(e => !existingIsbns.has(getIsbn(e.key)));
    const newEpubs = allNewEpubs.slice(0, limit);
    console.log(`${allNewEpubs.length} new books total, importing ${newEpubs.length} this batch`);

    if (dryRun) {
      return new Response(JSON.stringify({
        total_files: allObjects.length, book_files: epubs.length, covers: covers.length,
        already_imported: existingIsbns.size,
        to_import: newEpubs.map(e => ({ key: e.key, isbn: getIsbn(e.key), size_mb: (e.size / 1048576).toFixed(1) })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: Array<{ isbn: string; title: string; status: string; chapters_extracted: number; error?: string }> = [];
    const decoder = new TextDecoder("utf-8", { fatal: false });

    for (const epub of newEpubs) {
      const isbn = getIsbn(epub.key);
      const isEpub = epub.key.toLowerCase().endsWith(".epub");
      const fileType = isEpub ? "epub" : "pdf";

      try {
        console.log(`--- Importing ${isbn} (${fileType}, ${(epub.size / 1048576).toFixed(1)} MB) ---`);
        const fileBytes = await s3Download(AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, epub.key);
        console.log(`Downloaded ${isbn}: ${fileBytes.length} bytes`);

        // Upload file to storage
        const storagePath = `imports/${isbn}.${fileType}`;
        const { error: uploadError } = await supabase.storage.from("book-files").upload(storagePath, fileBytes, {
          contentType: isEpub ? "application/epub+zip" : "application/pdf", upsert: true,
        });
        if (uploadError) console.warn(`Storage upload warning for ${isbn}:`, uploadError.message);

        // Upload cover if available
        let coverUrl: string | null = null;
        const coverKey = coverByIsbn.get(isbn);
        if (coverKey) {
          try {
            const coverBytes = await s3Download(AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, coverKey);
            const coverExt = coverKey.split(".").pop() || "jpg";
            const coverPath = `covers/${isbn}.${coverExt}`;
            const { error: coverUploadError } = await supabase.storage.from("book-images").upload(coverPath, coverBytes, {
              contentType: `image/${coverExt === "jpg" ? "jpeg" : coverExt}`, upsert: true,
            });
            if (!coverUploadError) {
              const { data: publicData } = supabase.storage.from("book-images").getPublicUrl(coverPath);
              coverUrl = publicData?.publicUrl || null;
              console.log(`Cover uploaded for ${isbn}: ${coverUrl}`);
            }
          } catch (coverErr) { console.warn(`Cover upload failed for ${isbn}:`, coverErr); }
        }

        // Extract metadata + chapters from EPUB
        let bookTitle = isbn;
        let bookAuthors: string[] = [];
        let bookPublisher: string | null = null;
        let bookDescription: string | null = `Imported from S3: ${epub.key}`;
        let chapters: Array<{ chapter_key: string; title: string; content: string; sort_order: number }> = [];

        if (isEpub) {
          try {
            const unzipped = unzipSync(fileBytes);
            const opfResult = findOpf(unzipped, decoder);
            if (opfResult) {
              // Extract metadata
              const metadata = extractEpubMetadata(opfResult.opfContent);
              if (metadata.title) bookTitle = metadata.title;
              if (metadata.authors?.length) bookAuthors = metadata.authors;
              if (metadata.publisher) bookPublisher = metadata.publisher;
              if (metadata.description) bookDescription = metadata.description;

              // Extract chapters
              chapters = extractEpubChapters(unzipped, decoder, opfResult.opfContent, opfResult.opfBasePath);
              console.log(`Extracted ${chapters.length} chapters and metadata for ${isbn}: "${bookTitle}"`);
            }
          } catch (parseErr) {
            console.warn(`EPUB parsing failed for ${isbn}:`, parseErr);
          }
        }

        // Insert book record
        const { data: insertedBook, error: insertError } = await supabase.from("books").insert({
          title: bookTitle, isbn, authors: bookAuthors, file_path: storagePath, file_type: fileType,
          cover_url: coverUrl, specialty: "Nursing", tags: ["nursing"],
          description: bookDescription, cover_color: "hsl(280 50% 40%)",
          publisher: bookPublisher, chapter_count: chapters.length,
        }).select("id").single();

        if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);
        console.log(`Book ${isbn} inserted with ID: ${insertedBook.id}`);

        // Insert chapters into book_chapters table
        let chaptersInserted = 0;
        if (chapters.length > 0) {
          const rows = chapters.map(ch => ({
            book_id: insertedBook.id,
            chapter_key: ch.chapter_key,
            title: ch.title,
            content: ch.content,
            sort_order: ch.sort_order,
            page_number: ch.sort_order + 1,
            tags: [],
          }));

          // Insert in batches of 20 to avoid payload limits
          for (let i = 0; i < rows.length; i += 20) {
            const batch = rows.slice(i, i + 20);
            const { error: chapterErr } = await supabase.from("book_chapters").insert(batch);
            if (chapterErr) {
              console.warn(`Chapter batch insert warning for ${isbn} (batch ${i}):`, chapterErr.message);
              // Fallback: insert individually
              for (const row of batch) {
                const { error: singleErr } = await supabase.from("book_chapters").insert(row);
                if (!singleErr) chaptersInserted++;
              }
            } else {
              chaptersInserted += batch.length;
            }
          }
          console.log(`Inserted ${chaptersInserted}/${chapters.length} chapters for ${isbn}`);
        }

        results.push({ isbn, title: bookTitle, status: "imported", chapters_extracted: chaptersInserted });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Failed to import ${isbn}:`, msg);
        results.push({ isbn, title: isbn, status: "error", chapters_extracted: 0, error: msg });
      }
    }

    const summary = {
      total_in_bucket: epubs.length, already_imported: existingIsbns.size,
      newly_imported: results.filter(r => r.status === "imported").length,
      total_chapters: results.reduce((sum, r) => sum + r.chapters_extracted, 0),
      errors: results.filter(r => r.status === "error").length, details: results,
    };
    console.log(`Import complete:`, JSON.stringify(summary, null, 2));
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("import-s3-books error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
