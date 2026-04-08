import 'dotenv/config';
import fs from 'fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import pdfParse from "pdf-extraction"; 

// ==========================================
// ⚙️ COMMAND LINE ARGUMENTS
// ==========================================
let targetFilename = "";
let targetPrefix = "";
let importLimit = 1; // Default fallback limit

process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--prefix=')) {
    targetPrefix = arg.split('=')[1];
  } else if (arg.startsWith('--limit=')) {
    importLimit = parseInt(arg.split('=')[1], 10);
  } else if (!arg.startsWith('--')) {
    // If it's just a standard string without dashes, treat it as a specific filename
    targetFilename = arg; 
  }
});

// ==========================================
// 1. Initialize Clients
// ==========================================
const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- Helpers ---
function getFileInfo(key) {
  const parts = key.split("/");
  const filename = parts.pop(); 
  const collection = parts.length > 0 ? parts[parts.length - 1] : "General";

  const extMatch = filename.match(/\.(epub|pdf|jpg|jpeg|png)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : "unknown";
  const isbn = filename.replace(/\.(epub|pdf|jpg|jpeg|png)$/i, "");
  
  return { isbn, ext, collection };
}

function extractEpubMetadata(opfContent) {
  const getTag = (tag) => {
    const m = opfContent.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)<\\/dc:${tag}>`, "i"));
    return m ? m[1].trim().replace(/<[^>]+>/g, "") : undefined;
  };
  const getAllTags = (tag) => {
    const results = [];
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
    authors: getAllTags("creator").length ? getAllTags("creator") : [],
    publisher: getTag("publisher"),
    description: getTag("description")?.replace(/<[^>]+>/g, "").trim(),
  };
}

// --- Main Process ---
async function runImport() {
  try {
    console.log(`Fetching files from S3... (Prefix: "${targetPrefix}", Limit: ${importLimit})`);
    
    const listCommand = new ListObjectsV2Command({ 
      Bucket: process.env.AWS_S3_BUCKET,
      Prefix: targetPrefix || undefined
    });
    
    const s3Data = await s3Client.send(listCommand);
    
    if (!s3Data.Contents || s3Data.Contents.length === 0) {
      console.log(`Bucket or prefix path is empty.`);
      return;
    }

    // Separate books from cover images
    const allValidFiles = s3Data.Contents.filter(o => /\.(epub|pdf)$/i.test(o.Key));
    const allImageFiles = s3Data.Contents.filter(o => /\.(jpg|jpeg|png)$/i.test(o.Key));
    
    console.log(`Found ${allValidFiles.length} books and ${allImageFiles.length} cover images in this path.`);

    // Map images by their clean name (isbn) so we can quickly look them up later
    const coverImageMap = {};
    for (const img of allImageFiles) {
      const { isbn, ext } = getFileInfo(img.Key);
      coverImageMap[isbn] = { key: img.Key, ext: ext };
    }

    let newFilesToProcess = [];

    // --- DECISION BRANCH: SPECIFIC BOOK VS BULK ---
    if (targetFilename) {
      console.log(`\n🔍 SPECIFIC PULL REQUESTED: Searching for "${targetFilename}"...`);
      
      const specificFile = allValidFiles.find(o => o.Key.toLowerCase().includes(targetFilename.toLowerCase()));
      
      if (!specificFile) {
        console.error(`❌ Could not find any book in S3 matching "${targetFilename}".`);
        return;
      }
      
      newFilesToProcess = [specificFile];
      console.log(`✅ Found exact match: ${specificFile.Key}`);

    } else {
      // Normal Bulk Process
      const isbnList = allValidFiles.map(e => getFileInfo(e.Key).isbn);
      
      let existingIsbns = new Set();
      if (isbnList.length > 0) {
        const { data: existingBooks } = await supabase.from("books").select("isbn").in("isbn", isbnList);
        existingIsbns = new Set((existingBooks || []).map(b => b.isbn));
      }

      const allNewFiles = allValidFiles.filter(e => !existingIsbns.has(getFileInfo(e.Key).isbn));
      newFilesToProcess = allNewFiles.slice(0, importLimit);
      
      console.log(`${allNewFiles.length} books are new. Processing ${newFilesToProcess.length} books in this run.`);
    }

    if (newFilesToProcess.length === 0) {
      console.log("No new books to import right now.");
      return;
    }

    for (const fileObj of newFilesToProcess) {
      const { isbn, ext, collection } = getFileInfo(fileObj.Key);
      console.log(`\n--- Processing [${ext.toUpperCase()}]: ${isbn} (Folder/Collection: ${collection}) ---`);

      // 2. Download Book from S3 into memory
      const getCommand = new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: fileObj.Key });
      const response = await s3Client.send(getCommand);
      const fileBytes = await response.Body.transformToByteArray();
      const fileBuffer = Buffer.from(fileBytes);

      if (fileBuffer.length === 0) {
        console.error("Skipping upload: File is 0 bytes (Empty file in S3).");
        continue;
      }

      // 3. Upload raw book file to Supabase Storage ('book-files' bucket)
      const storagePath = `imports/${isbn}.${ext}`;
      const contentType = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
      
      console.log(`Uploading book file to Supabase Storage...`);
      const { error: uploadError } = await supabase.storage.from("book-files").upload(storagePath, fileBuffer, {
        contentType: contentType,
        upsert: true,
      });
      if (uploadError) console.error(`Storage upload warning: ${uploadError.message}`);

      // --- 3a. CHECK FOR AND UPLOAD COVER IMAGE ('book-images' bucket) ---
      let bookCoverUrl = null;
      if (coverImageMap[isbn]) {
        console.log(`🖼️  Matching cover image found! Downloading from S3...`);
        try {
          const coverData = coverImageMap[isbn];
          const getCoverCommand = new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: coverData.key });
          const coverResponse = await s3Client.send(getCoverCommand);
          const coverBytes = await coverResponse.Body.transformToByteArray();
          const coverBuffer = Buffer.from(coverBytes);

          const coverStoragePath = `covers/${isbn}.${coverData.ext}`;
          const coverContentType = coverData.ext === 'png' ? 'image/png' : 'image/jpeg';

          console.log(`Uploading cover to Supabase 'book-images' bucket...`);
          const { error: coverUploadError } = await supabase.storage.from("book-images").upload(coverStoragePath, coverBuffer, {
            contentType: coverContentType,
            upsert: true,
          });

          if (coverUploadError) {
            console.error(`Cover upload warning: ${coverUploadError.message}`);
          } else {
            const { data: publicUrlData } = supabase.storage.from("book-images").getPublicUrl(coverStoragePath);
            bookCoverUrl = publicUrlData.publicUrl;
            console.log(`✅ Cover image linked successfully!`);
          }
        } catch (coverErr) {
          console.error(`Failed to process cover image: ${coverErr.message}`);
        }
      } else {
        console.log(`No matching cover image found in S3 for this book.`);
      }

      // 4. Parse Data based on file type
      console.log("Extracting content...");
      let bookTitle = isbn;
      let bookAuthors = [];
      let bookPublisher = null;
      let bookDescription = `Imported from S3: ${fileObj.Key}`;
      let chapters = [];

      if (ext === 'epub') {
        try {
          const zip = new AdmZip(fileBuffer);
          const containerEntry = zip.getEntry("META-INF/container.xml");
          
          if (containerEntry) {
            const containerXml = containerEntry.getData().toString("utf8");
            const m = containerXml.match(/full-path="([^"]+)"/);
            
            if (m) {
              const opfPath = m[1];
              const opfEntry = zip.getEntry(opfPath);
              const opfContent = opfEntry.getData().toString("utf8");
              const opfBasePath = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

              const metadata = extractEpubMetadata(opfContent);
              if (metadata.title) bookTitle = metadata.title;
              if (metadata.authors?.length) bookAuthors = metadata.authors;
              if (metadata.publisher) bookPublisher = metadata.publisher;
              if (metadata.description) bookDescription = metadata.description;

              const manifestRegex = /<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*\/?\s*>/gi;
              const manifest = new Map();
              let mm;
              while ((mm = manifestRegex.exec(opfContent)) !== null) manifest.set(mm[1], mm[2]);

              const spineRegex = /<itemref\s+[^>]*idref="([^"]+)"[^>]*\/?\s*>/gi;
              const spineIds = [];
              while ((mm = spineRegex.exec(opfContent)) !== null) spineIds.push(mm[1]);

              for (let i = 0; i < spineIds.length; i++) {
                const href = manifest.get(spineIds[i]);
                if (!href) continue;
                
                const fullPath = opfBasePath + decodeURIComponent(href);
                const chapterEntry = zip.getEntry(fullPath);
                if (!chapterEntry) continue;

                const html = chapterEntry.getData().toString("utf8");
                const textContent = html
                  .replace(/<script[\s\S]*?<\/script>/gi, "")
                  .replace(/<style[\s\S]*?<\/style>/gi, "")
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
                  .replace(/\s+/g, " ").trim();

                if (textContent.length < 50) continue;

                let title = `Chapter ${i + 1}`;
                const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                if (h1Match) { 
                  const t = h1Match[1].replace(/<[^>]+>/g, "").trim(); 
                  if (t && t.length < 200) title = t; 
                } else {
                  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                  if (titleMatch) { 
                    const t = titleMatch[1].replace(/<[^>]+>/g, "").trim(); 
                    if (t && t.length < 200) title = t; 
                  }
                }

                chapters.push({
                  chapter_key: `spine-${i}-${spineIds[i]}`,
                  title,
                  content: textContent.substring(0, 50000), 
                  sort_order: i
                });
              }
            }
          }
        } catch (parseErr) {
          console.error(`Error parsing EPUB ${isbn}:`, parseErr.message);
        }
      } 
      else if (ext === 'pdf') {
        try {
          const pdfData = await pdfParse(fileBuffer);
          
          if (pdfData.info) {
            if (pdfData.info.Title) bookTitle = pdfData.info.Title;
            if (pdfData.info.Author) bookAuthors = [pdfData.info.Author];
          }

          const textContent = pdfData.text.replace(/\s+/g, " ").trim();

          if (textContent.length > 50) {
            chapters.push({
              chapter_key: `pdf-full-document`,
              title: "Full Document",
              content: textContent.substring(0, 50000), 
              sort_order: 0
            });
          }
        } catch (pdfErr) {
          console.error(`Error parsing PDF ${isbn}:`, pdfErr.message);
        }
      }

      // 5. Insert Book to DB (Aligned with Edge Function)
      console.log(`Inserting Book into database: "${bookTitle}"`);
      const { data: insertedBook, error: insertError } = await supabase.from("books").insert({
        title: bookTitle, 
        isbn, 
        authors: bookAuthors, 
        file_path: storagePath, 
        file_type: ext,
        collection: collection, 
        cover_url: bookCoverUrl, 
        cover_color: "hsl(280 50% 40%)", // Aligned
        specialty: "Nursing", 
        tags: ["nursing"],
        description: bookDescription, 
        publisher: bookPublisher, 
        chapter_count: chapters.length,
      }).select("id").single();

      if (insertError) {
        console.error(`DB insert failed: ${insertError.message}`);
        continue;
      }

      // 6. Insert Chapters to DB (Aligned with Edge Function)
      if (chapters.length > 0) {
        const rows = chapters.map(ch => ({
          book_id: insertedBook.id, 
          chapter_key: ch.chapter_key, 
          title: ch.title,
          content: ch.content, 
          sort_order: ch.sort_order, 
          page_number: ch.sort_order + 1,
          tags: [] // Aligned
        }));

        let chaptersInserted = 0;
        for (let i = 0; i < rows.length; i += 20) {
          const batch = rows.slice(i, i + 20);
          const { error: chapterErr } = await supabase.from("book_chapters").insert(batch);
          if (chapterErr) {
            console.error(`Chapter batch failed: ${chapterErr.message}`);
          } else {
            chaptersInserted += batch.length;
          }
        }
        console.log(`Inserted ${chaptersInserted}/${chapters.length} chapters.`);
      } else {
        console.log("No chapters/text extracted to insert.");
      }
      
      console.log(`✅ Successfully completed ${isbn}`);
    }

    console.log(`\n🎉 Successfully processed ${newFilesToProcess.length} book(s)!`);

  } catch (error) {
    console.error("Fatal Error:", error);
  }
}

runImport();