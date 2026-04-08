import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_PROMPT = `You are an expert document analyst. Analyze this document and extract structured metadata.

CRITICAL INSTRUCTIONS:
1. METADATA: Extract the REAL title, subtitle, authors, publisher, ISBN, edition, and publication year from the title page and copyright page. Do NOT infer from the filename.
2. CHAPTERS: You MUST extract chapters STRICTLY from the Table of Contents (TOC) of the document.
   - Look for a page labeled "Contents", "Table of Contents", or similar.
   - List EVERY entry that appears in the TOC exactly as written — including Preface, Foreword, Acknowledgments, About the Authors, Contributors, Appendix, Appendices, Index, Bibliography, References, Dimensions, and any other sections.
   - Do NOT skip or filter any TOC entry. Include ALL of them.
   - Do NOT invent chapters from section headings in the body text — only use what is listed in the TOC.
   - Each chapter MUST have its page number as listed in the TOC.
3. If no TOC exists, identify chapters from major numbered headings (Chapter 1, Chapter 2, etc.).

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "title": "Full title of the document",
  "subtitle": "Subtitle if present, otherwise empty string",
  "authors": ["Author Name 1", "Author Name 2"],
  "publisher": "Publisher name if identifiable",
  "isbn": "ISBN if found, otherwise empty string",
  "edition": "Edition info if found, otherwise empty string",
  "publishedYear": 2024,
  "description": "A concise 2-4 sentence description of what this document covers, who it is for, and its clinical relevance.",
  "specialty": "Primary medical specialty (e.g. Surgery, Internal Medicine, Emergency Medicine, Cardiology, etc.)",
  "detectedTags": ["tag1", "tag2"],
  "chapters": [
    {
      "title": "Chapter title exactly as it appears in the TOC",
      "pageNumber": 1,
      "contentSummary": "A 1-2 sentence summary"
    }
  ]
}

For detectedTags, use from: pharmacology, surgical_procedures, patient_safety, infection_control, emergency_protocols, diagnostic_imaging, clinical_guidelines, drug_interactions, anesthesia, perioperative, respiratory, cardiovascular, endocrine, renal, neurology, oncology, pediatrics, obstetrics, orthopedics, dermatology, gastroenterology, hematology, immunology, psychiatry, rehabilitation, nutrition, wound_care, pain_management
publishedYear should be a number. If unknown, use 0.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfBase64, pageImages, pageTexts, fileName, firstPagesOnly } = await req.json();

    const safePageImages = Array.isArray(pageImages) ? pageImages.filter((img) => typeof img === "string" && img.startsWith("data:image/")) : [];
    const safePageTexts = Array.isArray(pageTexts) ? pageTexts.filter((text) => typeof text === "string" && text.trim().length > 0) : [];

    // Make sure we actually have images or text to send to OpenAI
    if (safePageImages.length === 0 && safePageTexts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No extracted text or images provided. OpenAI requires pageTexts or pageImages to process the document." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "No OPENAI_API_KEY configured in Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Parsing Document: ${fileName}, preview images: ${safePageImages.length}, text pages: ${safePageTexts.length}, firstPagesOnly: ${firstPagesOnly}`);

    const promptParts = [
      EXTRACTION_PROMPT,
      `\n\nFilename for reference: "${fileName}"`,
    ];

    if (safePageTexts.length > 0) {
      promptParts.push(
        `\n\nExtracted text from the pages (use this to improve accuracy, but only trust TOC entries that truly appear in the source):\n${safePageTexts
          .map((text, index) => `--- Page ${index + 1} ---\n${text.slice(0, 5000)}`)
          .join("\n\n")}`
      );
    }

    // Build the multimodal content array for OpenAI
    const contentParts: Array<any> = [
      {
        type: "text",
        text: promptParts.join(""),
      },
    ];

    // Add images if the frontend successfully generated them
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

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: firstPagesOnly ? 4096 : 8192,
      response_format: { type: "json_object" }, // Forces strict JSON output
    });

    const rawContent = response.choices[0]?.message?.content || "";

    console.log("Raw AI response length:", rawContent.length);

    // Parse JSON from the response
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

    console.log(`Extracted: title="${parsed.title}", ${parsed.chapters?.length || 0} chapters, ${parsed.authors?.length || 0} authors`);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-pdf error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});