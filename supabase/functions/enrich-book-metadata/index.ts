import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let limit = 5;
  try {
    const body = await req.json();
    limit = body.limit || 5;
  } catch {}

  // Find books that still have ISBN as title (need metadata)
  const { data: books } = await supabase
    .from("books")
    .select("id, isbn, file_path, file_type")
    .filter("file_type", "eq", "epub")
    .order("created_at", { ascending: true })
    .limit(100);

  const needsMetadata = (books || []).filter(b => b.isbn && b.isbn === b.isbn?.replace(/\D/g, '') && b.file_path);
  const batch = needsMetadata.slice(0, limit);

  console.log(`Found ${needsMetadata.length} books needing metadata, processing ${batch.length}`);

  const results: Array<{ isbn: string; title?: string; status: string; error?: string }> = [];

  for (const book of batch) {
    try {
      // Check if title is still just the ISBN
      const { data: current } = await supabase.from("books").select("title").eq("id", book.id).single();
      if (current && current.title && !/^\d+$/.test(current.title)) {
        results.push({ isbn: book.isbn!, status: "already_enriched" });
        continue;
      }

      const { data: fileData } = await supabase.storage.from("book-files").download(book.file_path!);
      if (!fileData) throw new Error("File not found in storage");

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());
      const metadata = extractEpubMetadata(fileBytes);

      if (metadata?.title) {
        await supabase.from("books").update({
          title: metadata.title,
          subtitle: metadata.subtitle || null,
          authors: metadata.authors?.length ? metadata.authors : [],
          publisher: metadata.publisher || null,
          description: metadata.description || null,
        }).eq("id", book.id);

        console.log(`Enriched ${book.isbn}: "${metadata.title}"`);
        results.push({ isbn: book.isbn!, title: metadata.title, status: "enriched" });
      } else {
        results.push({ isbn: book.isbn!, status: "no_metadata_found" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error(`Failed ${book.isbn}:`, msg);
      results.push({ isbn: book.isbn!, status: "error", error: msg });
    }
  }

  return new Response(JSON.stringify({ total_needing: needsMetadata.length, processed: results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

function extractEpubMetadata(epubBytes: Uint8Array) {
  try {
    const unzipped = unzipSync(epubBytes);
    const decoder = new TextDecoder("utf-8", { fatal: false });

    let opfContent: string | undefined;
    for (const [name, data] of Object.entries(unzipped)) {
      if (name.endsWith(".opf")) {
        opfContent = decoder.decode(data);
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
        }
      }
    }

    if (!opfContent) return null;

    const getTag = (tag: string): string | undefined => {
      const m = opfContent!.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "i"));
      return m ? m[1].trim().replace(/<[^>]+>/g, "") : undefined;
    };

    const getAllTags = (tag: string): string[] => {
      const results: string[] = [];
      const regex = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "gi");
      let m;
      while ((m = regex.exec(opfContent!)) !== null) {
        const val = m[1].trim().replace(/<[^>]+>/g, "");
        if (val) results.push(val);
      }
      return results;
    };

    return {
      title: getTag("title"),
      subtitle: undefined as string | undefined,
      authors: getAllTags("creator"),
      publisher: getTag("publisher"),
      description: getTag("description")?.replace(/<[^>]+>/g, "").trim(),
    };
  } catch (err) {
    console.warn("EPUB metadata extraction error:", err);
    return null;
  }
}
