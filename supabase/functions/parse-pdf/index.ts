import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTRACTION_PROMPT = `You are an expert document analyst. Analyze this PDF and extract structured metadata.

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

    const hasPdfPayload = typeof pdfBase64 === "string" && pdfBase64.length > 0;
    const safePageImages = Array.isArray(pageImages) ? pageImages.filter((img) => typeof img === "string" && img.startsWith("data:image/")) : [];
    const safePageTexts = Array.isArray(pageTexts) ? pageTexts.filter((text) => typeof text === "string" && text.trim().length > 0) : [];

    if (!hasPdfPayload && safePageImages.length === 0 && safePageTexts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No PDF preview data provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try Lovable AI Gateway first, fall back to direct Gemini API
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    
    if (!LOVABLE_API_KEY && !GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "No AI API key configured (LOVABLE_API_KEY or GEMINI_API_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Parsing PDF: ${fileName}, preview images: ${safePageImages.length}, text pages: ${safePageTexts.length}, firstPagesOnly: ${firstPagesOnly}`);

    const promptParts = [
      EXTRACTION_PROMPT,
      `\n\nFilename for reference: "${fileName}"`,
    ];

    if (safePageTexts.length > 0) {
      promptParts.push(
        `\n\nExtracted text from the first pages (use this to improve accuracy, but only trust TOC entries that truly appear in the source):\n${safePageTexts
          .map((text, index) => `--- Page ${index + 1} ---\n${text.slice(0, 5000)}`)
          .join("\n\n")}`
      );
    }

    const contentParts: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: promptParts.join(""),
      },
    ];

    if (safePageImages.length > 0) {
      for (const image of safePageImages) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: image,
          },
        });
      }
    } else if (hasPdfPayload) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:application/pdf;base64,${pdfBase64}`,
        },
      });
    }

    const apiUrl = LOVABLE_API_KEY
      ? "https://ai.gateway.lovable.dev/chat/completions"
      : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    
    const apiKey = LOVABLE_API_KEY || GEMINI_API_KEY;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        temperature: 0.1,
        max_tokens: firstPagesOnly ? 4096 : 8192,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI service error", details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || "";

    console.log("Raw AI response length:", rawContent.length);

    // Parse JSON from the response (handle potential markdown fences)
    let parsed;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in response");
      }
      parsed = JSON.parse(jsonMatch[0]);
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
