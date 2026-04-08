import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai";

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
    const { pdfBase64, pageImages, pageTexts, chapters } = await req.json();

    const safePageImages = Array.isArray(pageImages) ? pageImages.filter((img) => typeof img === "string" && img.startsWith("data:image/")) : [];
    const safePageTexts = Array.isArray(pageTexts) ? pageTexts.filter((text) => typeof text === "string" && text.trim().length > 0) : [];

    // OpenAI cannot process raw pdfBase64 in Chat Completions, so we must rely on text or image arrays
    if (safePageImages.length === 0 && safePageTexts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No extracted text or images provided. OpenAI requires pageTexts or pageImages to process the document." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not configured in Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build chapter list for context
    const chapterList = (chapters || [])
      .map((ch: { title: string; pageNumber?: number }, i: number) =>
        `${i + 1}. "${ch.title}" (page ${ch.pageNumber || i + 1})`
      )
      .join("\n");

    const prompt = `You are a document text extractor. Extract the FULL TEXT content from this document, organized by chapters/sections.

The document has these chapters:
${chapterList}

For EACH chapter, extract the complete text content (not a summary — the actual text). Return ONLY valid JSON (no markdown fences) with this structure:
{
  "chapters": [
    {
      "chapterIndex": 0,
      "title": "Chapter title",
      "fullText": "The complete extracted text content of this chapter/section..."
    }
  ]
}

Guidelines:
- Extract the ACTUAL text, not summaries
- Use proper HTML formatting to preserve the document structure:
  - Wrap paragraphs in <p> tags
  - Use <h2>, <h3>, <h4> for headings and subheadings
  - Use <ul>/<ol> with <li> for lists
  - Use <table>, <thead>, <tbody>, <tr>, <th>, <td> for tables
  - Use <blockquote> for quoted text or callout boxes
  - Use <strong> for bold text, <em> for italics
- For Table of Contents pages: preserve the chapter titles with their page numbers
- For contributor/author pages: list each name with their credentials and affiliations
- For copyright pages: preserve ISBN, publisher info, and legal notices
- Keep all content — do not skip front matter, appendices, or reference sections
- Skip only headers/footers/page numbers that repeat on every page`;

    console.log(`Extracting text for ${(chapters || []).length} chapters. Text pages: ${safePageTexts.length}, Images: ${safePageImages.length}`);

    // Build the multimodal content array for OpenAI
    const contentParts: Array<any> = [
      {
        type: "text",
        text: prompt,
      },
    ];

    if (safePageTexts.length > 0) {
      contentParts.push({
        type: "text",
        text: `\n\nExtracted document text:\n${safePageTexts
          .map((text, index) => `--- Page ${index + 1} ---\n${text}`)
          .join("\n\n")}`
      });
    }

    if (safePageImages.length > 0) {
      for (const image of safePageImages) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: image,
          },
        });
      }
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 32000,
      response_format: { type: "json_object" }, // Forces strict JSON output
    });

    const rawContent = response.choices[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw:", rawContent.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response as JSON", raw: rawContent.slice(0, 1000) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully extracted text for ${parsed.chapters?.length || 0} chapters`);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("extract-pdf-text error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});