# 🚀 MedCompli — Local Setup & Self-Hosted Supabase Guide
# Updated: 2026-04-02

## Prerequisites

- Node.js 18+ installed
- Supabase CLI installed (`npm install -g supabase`)
- A Supabase account at [supabase.com](https://supabase.com)
- (Optional) AWS S3 bucket with book files for import

---

## Step 1: Clone & Install

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
npm install
```

---

## Step 2: Create Your Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Pick a name, set a database password, choose a region
3. Wait for setup to complete (~2 minutes)

---

## Step 3: Run the Database Schema

1. In Supabase Dashboard → **SQL Editor**
2. Click **New Query**
3. Open `public/exports/SUPABASE-FULL-EXPORT.sql` from your project
4. Copy-paste the **entire contents** into the SQL Editor
5. Click **Run** ✅

This creates all tables, enums, RLS policies, functions, triggers, and storage buckets.

> The SQL export includes `handle_new_user` and `handle_new_user_role` triggers. If the run completes without errors, you do **not** need to create them manually.

---

## Step 4: Verify Auth Triggers

After running the SQL export, verify the triggers exist:

```sql
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public' OR event_object_schema = 'auth';
```

You should see `on_auth_user_created` and `on_auth_user_created_role`. If missing, run:

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();
```

---

## Step 5: Enable Email Auth

1. In Supabase Dashboard → **Authentication** → **Providers**
2. Make sure **Email** is enabled
3. For demo/testing: Toggle **"Confirm email"** OFF
4. For production: Keep it ON
5. Set **Site URL** to your domain (e.g. `http://localhost:8080`)
6. Add redirect URLs: `http://localhost:8080`, `http://localhost:8080/reset-password`

---

## Step 6: Get Your Supabase Credentials

1. In Supabase Dashboard → **Settings** → **API**
2. Copy:
   - **Project URL** (e.g. `https://abcdefg.supabase.co`)
   - **anon public key** (starts with `eyJ...`)
3. Note your **Project ID** from the URL (the `abcdefg` part)

---

## Step 7: Update Your `.env` File

Create or edit `.env` in your project root:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-public-key-here
VITE_SUPABASE_PROJECT_ID=YOUR-PROJECT-ID
```

---

## Step 8: Update Supabase Client

Edit `src/integrations/supabase/client.ts` to point to your project:

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "your-anon-public-key-here";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
```

---

## Step 9: Create Storage Buckets

In Supabase Dashboard → **Storage**:

1. Create bucket: `book-files` (Private)
2. Create bucket: `book-images` (Public)

> The SQL export tries to create these automatically. If they already exist, skip this step.

---

## Step 10: Deploy Edge Functions

### Link Your Project

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-ID
```

### Deploy All Functions

```bash
supabase functions deploy gemini-ai --no-verify-jwt
supabase functions deploy parse-pdf --no-verify-jwt
supabase functions deploy extract-pdf-text --no-verify-jwt
supabase functions deploy extract-epub-chapters --no-verify-jwt
supabase functions deploy enrich-book-metadata --no-verify-jwt
supabase functions deploy process-imported-book --no-verify-jwt
supabase functions deploy import-s3-books --no-verify-jwt
```

### Set API Keys

```bash
# AI Search (Groq — Llama 3.3 70B)
# Get key from: https://console.groq.com/keys
supabase secrets set GROQ_API_KEY=your-groq-api-key

# PDF Parsing (Google Gemini)
# Get key from: https://aistudio.google.com/apikeys
supabase secrets set GEMINI_API_KEY=your-gemini-api-key
```

> **Which function uses what:**
>
> | Edge Function | API Key | Purpose |
> |---|---|---|
> | `gemini-ai` | `GROQ_API_KEY` | AI search, chapter Q&A |
> | `parse-pdf` | `GEMINI_API_KEY` | PDF chapter extraction |
> | `extract-pdf-text` | `GEMINI_API_KEY` | PDF text extraction |
> | `extract-epub-chapters` | — | EPUB chapter parsing |
> | `enrich-book-metadata` | — | EPUB metadata extraction |
> | `process-imported-book` | `GEMINI_API_KEY` | Post-import processing |
> | `import-s3-books` | AWS credentials | S3 bulk import |

---

## Step 11: Connect S3 (Book Import from AWS)

The `import-s3-books` edge function uses **direct AWS credentials** (not the Lovable connector gateway). Set these secrets:

```bash
supabase secrets set AWS_ACCESS_KEY_ID=AKIA...your-access-key
supabase secrets set AWS_SECRET_ACCESS_KEY=wJal...your-secret-key
supabase secrets set AWS_S3_BUCKET=your-bucket-name
supabase secrets set AWS_S3_REGION=eu-north-1
```

### Create AWS IAM User for S3 Access

1. Go to AWS Console → **IAM** → **Users** → **Create User**
2. Name: `medcompli-s3-reader`
3. Attach policy: `AmazonS3ReadOnlyAccess` (or a custom policy scoped to your bucket)
4. Go to **Security credentials** → **Create access key** → Choose **Application running outside AWS**
5. Copy the **Access Key ID** and **Secret Access Key**

### Trigger the Import

**Dry run first** (verifies S3 connectivity without importing):

```bash
# Linux/Mac:
curl -X POST "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "dryRun": true}'

# Windows PowerShell:
Invoke-RestMethod -Uri "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer YOUR_ANON_KEY"; "Content-Type" = "application/json" } `
  -Body '{"prefix":"","dryRun":true}'
```

**Actual import** (imports up to 50 books):

```bash
# Linux/Mac:
curl -X POST "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "limit": 50}'

# Windows PowerShell:
Invoke-RestMethod -Uri "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer YOUR_ANON_KEY"; "Content-Type" = "application/json" } `
  -Body '{"prefix":"","limit":50}'
```

### S3 Bucket Structure

```
your-bucket/
├── 978-0-1234-5678-9.epub    ← Book file (ISBN as filename)
├── 978-0-1234-5678-9.pdf     ← Or PDF format
├── 978-0-1234-5678-9.jpg     ← Cover image (auto-matched by ISBN)
└── subfolder/                 ← Use "prefix" param to target subfolders
```

---

## Step 12: Bootstrap First Admin

1. **Create an enterprise** in the `enterprises` table with a `domain` (e.g. `hospital.org`) and `contact_email`
2. **Sign up with the `contact_email`** → auto-assigned as enterprise **admin**
3. **Sign up with any email matching the `domain`** → auto-assigned as **staff**

To make someone a **platform admin** (super admin):

```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('YOUR-USER-UUID', 'platform_admin');
```

> Find the user UUID in Supabase Dashboard → Authentication → Users

---

## Step 13: Run the App! 🎉

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Step 14: Deploy to Vercel (Production)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → **Import Project** from GitHub
3. Set environment variables in Vercel:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your anon key
   - `VITE_SUPABASE_PROJECT_ID` = your project ID
4. Deploy!
5. After deployment, update Supabase Auth settings:
   - **Site URL** → your Vercel domain (e.g. `https://your-app.vercel.app`)
   - **Redirect URLs** → add `https://your-app.vercel.app`, `https://your-app.vercel.app/reset-password`

---

## ✅ Quick Checklist

| Step | Done? |
|------|-------|
| Cloned repo & ran `npm install` | ☐ |
| Created Supabase project | ☐ |
| Ran SQL schema export | ☐ |
| Verified auth triggers exist | ☐ |
| Enabled Email auth provider | ☐ |
| Set Site URL & redirect URLs | ☐ |
| Updated `.env` with credentials | ☐ |
| Updated `client.ts` with your Supabase URL | ☐ |
| Created storage buckets (`book-files`, `book-images`) | ☐ |
| Deployed all 7 edge functions | ☐ |
| Set `GROQ_API_KEY` secret | ☐ |
| Set `GEMINI_API_KEY` secret | ☐ |
| Set AWS credentials (if using S3 import) | ☐ |
| Ran S3 dry run successfully | ☐ |
| Ran S3 import | ☐ |
| Created first enterprise + admin user | ☐ |
| Inserted platform_admin role | ☐ |
| Ran `npm run dev` | ☐ |
| Deployed to Vercel | ☐ |

---

## 🆘 Troubleshooting

**"Invalid API key" error in browser console**
→ Check `.env` and `client.ts` values match Supabase Dashboard → Settings → API

**Sign-up not working**
→ Make sure Email provider is enabled in Authentication → Providers

**User signs up but can't access anything**
→ Check if the user's email domain matches an enterprise `domain`. If no match, the user gets `enterprise_id = NULL`.

**AI features not working**
→ Verify edge functions are deployed (`supabase functions list`) and `GROQ_API_KEY` / `GEMINI_API_KEY` secrets are set

**Storage upload fails**
→ Verify `book-files` and `book-images` buckets exist in Storage

**S3 import returns "Missing AWS credentials"**
→ Run `supabase secrets list` to verify all 4 AWS secrets are set

**S3 import returns "Missing x-amz-content-sha256"**
→ Make sure you deployed the latest version of `import-s3-books` that includes the `x-amz-content-sha256` header

**Port 8080 already in use**
→ Kill the process or change the port in `vite.config.ts`

**"seat_limit_exceeded" on signup**
→ The enterprise has reached its `license_seats` limit. Increase seats or approve pending users from the Enterprise Dashboard.

**PowerShell curl errors**
→ Use `curl.exe` (not `curl` alias) or use `Invoke-RestMethod` syntax shown above. PowerShell's `curl` is an alias for `Invoke-WebRequest` which has different syntax.

**Docker needed?**
→ No. The frontend runs with `npm run dev` and all backend services (database, auth, storage, edge functions) run on hosted Supabase. Docker is only needed if you want to run Supabase locally via `supabase start`.
