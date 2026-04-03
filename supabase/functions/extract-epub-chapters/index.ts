import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Check if chapters already cached
    const { data: existing, error: selectErr } = await supabase
      .from("book_chapters")
      .select("chapter_key, title, content")
      .eq("book_id", bookId)
      .order("sort_order", { ascending: true });

    if (!selectErr && existing && existing.length > 0) {
      console.log(`Returning ${existing.length} cached chapters for book ${bookId}`);
      return new Response(JSON.stringify({ chapters: existing, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get book file_path
    const { data: book } = await supabase
      .from("books")
      .select("file_path, file_type")
      .eq("id", bookId)
      .single();

    if (!book?.file_path || book.file_type !== "epub") {
      return new Response(JSON.stringify({ error: "No EPUB file for this book", chapters: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download EPUB from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("book-files")
      .download(book.file_path);

    if (dlErr || !fileData) {
      throw new Error(`Failed to download EPUB: ${dlErr?.message}`);
    }

    const epubBytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`Downloaded EPUB for ${bookId}: ${epubBytes.length} bytes`);

    // Unzip and extract chapters
    const unzipped = unzipSync(epubBytes);
    const decoder = new TextDecoder("utf-8", { fatal: false });

    // Find OPF to get spine order
    let opfContent = "";
    let opfBasePath = "";
    for (const [name, data] of Object.entries(unzipped)) {
      if (name.endsWith(".opf")) {
        opfContent = decoder.decode(data);
        opfBasePath = name.includes("/") ? name.substring(0, name.lastIndexOf("/") + 1) : "";
        break;
      }
    }

    if (!opfContent) {
      const containerData = unzipped["META-INF/container.xml"];
      if (containerData) {
        const containerXml = decoder.decode(containerData);
        const m = containerXml.match(/full-path="([^"]+)"/);
        if (m && unzipped[m[1]]) {
          opfContent = decoder.decode(unzipped[m[1]]);
          opfBasePath = m[1].includes("/") ? m[1].substring(0, m[1].lastIndexOf("/") + 1) : "";
        }
      }
    }

    if (!opfContent) {
      return new Response(JSON.stringify({ error: "Could not find OPF", chapters: [] }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Extract chapter text from spine items
    const chapters: Array<{ chapter_key: string; title: string; content: string; sort_order: number }> = [];

    for (let i = 0; i < spineIds.length; i++) {
      const href = manifest.get(spineIds[i]);
      if (!href) continue;

      const fullPath = opfBasePath + decodeURIComponent(href);
      const fileData = unzipped[fullPath];
      if (!fileData) continue;

      const html = decoder.decode(fileData);

      // Extract text content (strip HTML tags for AI context)
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

      if (textContent.length < 50) continue; // Skip nearly-empty files

      // Try to extract title from <title> or first heading
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
        content: textContent.substring(0, 50000), // Cap at 50K chars per chapter
        sort_order: i,
      });
    }

    console.log(`Extracted ${chapters.length} chapters from EPUB`);

    // Cache into book_chapters table
    if (chapters.length > 0) {
      const rows = chapters.map(ch => ({
        book_id: bookId,
        chapter_key: ch.chapter_key,
        title: ch.title,
        content: ch.content,
        sort_order: ch.sort_order,
        page_number: ch.sort_order + 1,
        tags: [],
      }));

      const { error: insertErr } = await supabase
        .from("book_chapters")
        .upsert(rows, { onConflict: "book_id,chapter_key", ignoreDuplicates: true });

      if (insertErr) {
        console.warn("Chapter cache insert warning:", insertErr.message);
        // Try individual inserts as fallback
        for (const row of rows) {
          await supabase.from("book_chapters").insert(row).select().maybeSingle();
        }
      }
    }

    return new Response(JSON.stringify({
      chapters: chapters.map(ch => ({
        chapter_key: ch.chapter_key,
        title: ch.title,
        content: ch.content,
      })),
      cached: false,
      count: chapters.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-epub-chapters error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", chapters: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
