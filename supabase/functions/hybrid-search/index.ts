import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MergedResult {
  bookId: string;
  title: string;
  specialty: string;
  description: string;
  authors: string[];
  publisher: string;
  rank: number;
  headline: string;
  chapters: Array<{ id: string; title: string; headline: string; rank: number }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, filters, userId, enterpriseId } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const startTime = Date.now();
    const searchQuery = query.trim();

    // ─── Full-Text Search ───
    const bookFilters: string[] = [];
    if (filters?.specialty && filters.specialty !== "all") {
      bookFilters.push(`specialty = '${filters.specialty.replace(/'/g, "''")}'`);
    }
    if (filters?.year && filters.year !== "all") {
      bookFilters.push(`published_year = ${parseInt(filters.year)}`);
    }
    const bookFilterClause = bookFilters.length > 0 ? `AND ${bookFilters.join(" AND ")}` : "";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    const [bookRes, chapterRes] = await Promise.all([
      supabase.rpc("search_books_fts", { search_query: searchQuery, filter_clause: bookFilterClause, max_results: 15 }),
      supabase.rpc("search_chapters_fts", { search_query: searchQuery, max_results: 20 }),
    ]);

    const bookHits = bookRes.data || [];
    const chapterHits = chapterRes.data || [];

    if (bookRes.error) console.error("Book FTS error:", bookRes.error);
    if (chapterRes.error) console.error("Chapter FTS error:", chapterRes.error);

    // ─── Merge FTS results ───
    const mergedMap = new Map<string, MergedResult>();

    for (const bh of bookHits) {
      mergedMap.set(bh.id, {
        bookId: bh.id,
        title: bh.title,
        specialty: bh.specialty || "",
        description: bh.description || "",
        authors: bh.authors || [],
        publisher: bh.publisher || "",
        rank: bh.rank,
        headline: bh.headline || "",
        chapters: [],
      });
    }

    for (const ch of chapterHits) {
      const existing = mergedMap.get(ch.book_id);
      if (existing) {
        existing.chapters.push({ id: ch.chapter_key, title: ch.title, headline: ch.headline || "", rank: ch.rank });
        existing.rank = Math.max(existing.rank, ch.rank * 0.8);
      } else {
        mergedMap.set(ch.book_id, {
          bookId: ch.book_id,
          title: ch.book_title || "Unknown",
          specialty: ch.book_specialty || "",
          description: "",
          authors: ch.book_authors || [],
          publisher: "",
          rank: ch.rank * 0.7,
          headline: "",
          chapters: [{ id: ch.chapter_key, title: ch.title, headline: ch.headline || "", rank: ch.rank }],
        });
      }
    }

    const ftsResults = Array.from(mergedMap.values())
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 20);

    const ftsTimeMs = Date.now() - startTime;

    if (ftsResults.length === 0) {
      try {
        await supabase.from("ai_query_logs").insert({
          book_id: "hybrid-search", book_title: "Hybrid Search",
          chapter_id: "fts", chapter_title: "No Results",
          query_type: "hybrid_search", user_prompt: searchQuery,
          ai_response: "No results found", response_time_ms: ftsTimeMs,
          model_used: "postgres-fts",
          user_id: userId || null, enterprise_id: enterpriseId || null,
        });
      } catch { /* ignore */ }

      return new Response(JSON.stringify({ results: [], ftsTimeMs, totalTimeMs: ftsTimeMs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Gemini Semantic Reranking ───
    if (!LOVABLE_API_KEY && !GEMINI_API_KEY) {
      const results = ftsResults.map((r, i) => ({
        bookId: r.bookId, title: r.title, specialty: r.specialty, collection: null,
        relevanceScore: Math.round(Math.max(95 - i * 8, 20)),
        reason: r.headline || r.description?.slice(0, 200) || "Matched by keyword search",
        chapters: r.chapters.slice(0, 3).map(ch => ({ id: ch.id, title: ch.title, reason: ch.headline || "Chapter content matches your query" })),
      }));
      return new Response(JSON.stringify({ results, ftsTimeMs, totalTimeMs: Date.now() - startTime }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const catalogForAI = ftsResults.map((r, i) => ({
      index: i, bookId: r.bookId, title: r.title, specialty: r.specialty,
      headline: r.headline?.replace(/<[^>]*>/g, "").slice(0, 200),
      description: r.description?.slice(0, 150), ftsRank: r.rank,
      chapters: r.chapters.slice(0, 3).map(ch => ({
        id: ch.id, title: ch.title, snippet: ch.headline?.replace(/<[^>]*>/g, "").slice(0, 150),
      })),
    }));

    const rerankPrompt = `You are a medical compliance search assistant. The user searched: "${searchQuery}"

Below are the top results from a full-text search. Rerank them by SEMANTIC RELEVANCE to the user's intent.

RESPOND WITH ONLY a JSON array. Each item must have:
- "bookId": exact bookId from input
- "title": exact title from input
- "specialty": specialty
- "collection": null
- "relevanceScore": 0-100
- "reason": 2-3 sentences explaining relevance
- "chapters": array of {id, title, reason}

Results:\n${JSON.stringify(catalogForAI, null, 1)}

IMPORTANT: Return ONLY a JSON array starting with [ and ending with ]. No markdown.`;

    let apiUrl: string;
    let aiHeaders: Record<string, string>;
    let model: string;

    if (LOVABLE_API_KEY) {
      apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
      aiHeaders = { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" };
      model = "google/gemini-2.5-flash";
    } else {
      apiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      aiHeaders = { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" };
      model = "gemini-2.5-flash";
    }

    const aiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a search reranking assistant. Return only valid JSON arrays." },
          { role: "user", content: rerankPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    const totalTimeMs = Date.now() - startTime;

    if (!aiResponse.ok) {
      console.error("AI reranking failed:", aiResponse.status);
      const results = ftsResults.map((r, i) => ({
        bookId: r.bookId, title: r.title, specialty: r.specialty, collection: null,
        relevanceScore: Math.round(Math.max(90 - i * 7, 15)),
        reason: r.headline?.replace(/<[^>]*>/g, "") || r.description?.slice(0, 200) || "Matched by keyword search",
        chapters: r.chapters.slice(0, 3).map(ch => ({ id: ch.id, title: ch.title, reason: ch.headline?.replace(/<[^>]*>/g, "") || "Chapter matches your query" })),
      }));
      return new Response(JSON.stringify({ results, ftsTimeMs, totalTimeMs, aiReranked: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData?.choices?.[0]?.message?.content || "";

    let rerankedResults: any[] = [];
    try {
      const parsed = JSON.parse(aiContent);
      rerankedResults = Array.isArray(parsed) ? parsed : (parsed.results || []);
    } catch {
      const arrayMatch = aiContent.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try { rerankedResults = JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
      }
    }

    if (rerankedResults.length === 0) {
      rerankedResults = ftsResults.map((r, i) => ({
        bookId: r.bookId, title: r.title, specialty: r.specialty, collection: null,
        relevanceScore: Math.round(Math.max(90 - i * 7, 15)),
        reason: r.headline?.replace(/<[^>]*>/g, "") || r.description?.slice(0, 200) || "Matched by keyword search",
        chapters: r.chapters.slice(0, 3).map(ch => ({ id: ch.id, title: ch.title, reason: ch.headline?.replace(/<[^>]*>/g, "") || "Chapter matches your query" })),
      }));
    }

    const finalResults = rerankedResults
      .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, 8);

    try {
      await supabase.from("ai_query_logs").insert({
        book_id: "hybrid-search", book_title: "Hybrid Search",
        chapter_id: "hybrid", chapter_title: `${finalResults.length} results`,
        query_type: "hybrid_search", user_prompt: searchQuery,
        ai_response: JSON.stringify(finalResults).slice(0, 10000),
        response_time_ms: totalTimeMs,
        model_used: `${LOVABLE_API_KEY ? "lovable/" : ""}gemini-2.5-flash`,
        tokens_used: aiData?.usage?.total_tokens || null,
        user_id: userId || null, enterprise_id: enterpriseId || null,
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ results: finalResults, ftsTimeMs, totalTimeMs, aiReranked: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("hybrid-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
