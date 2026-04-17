# 🚀 R2 Intelligent Library — Local Setup & Self-Hosted Supabase Guide
# Updated: 2026-04-17

## Prerequisites

- **Node.js 20 LTS** (18 still works but 20 is recommended for Vite 5)
- Supabase CLI (`npm install -g supabase`)
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

You have **two SQL files** to run, in order:

### 3a. Base schema (fresh installs only)
1. In Supabase Dashboard → **SQL Editor** → **New Query**
2. Open `public/exports/SUPABASE-FULL-EXPORT.sql`
3. Copy-paste the entire contents → **Run** ✅

### 3b. Patch v2 (everyone runs this)
1. New query → open `public/exports/SUPABASE-PATCH-V2.sql`
2. Copy-paste → **Run** ✅

> Patch v2 is **idempotent** — safe to run on a fresh install (after 3a) AND on an existing database that's already running an older snapshot. It only adds new objects.

**What patch v2 adds:**
- `books.price` column (NUMERIC, default $49)
- `compliance_collections.annual_price_range` column
- `search_queries` table (logs Discovery/In-book/Homepage searches)
- `feature_flags` table (runtime kill-switches)
- 3 analytics RPCs: `analytics_activity_trend`, `analytics_top_search_terms`, `analytics_title_usage`
- Performance indexes on `usage_events` and `search_queries`

---

## Step 4: Verify Triggers & New Objects

```sql
-- Auth + search-vector triggers (from base schema)
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public' OR event_object_schema = 'auth';
```

Expected:
- `on_auth_user_created` (on `auth.users`)
- `on_auth_user_created_role` (on `auth.users`)
- `books_search_vector_trigger` (on `books`)
- `book_chapters_search_vector_trigger` (on `book_chapters`)
- `update_enterprises_updated_at` (on `enterprises`)
- `update_profiles_updated_at` (on `profiles`)

```sql
-- Patch v2 verification
SELECT to_regclass('public.search_queries') AS search_queries,
       to_regclass('public.feature_flags')  AS feature_flags;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'books' AND column_name = 'price';

SELECT proname FROM pg_proc
WHERE proname IN ('analytics_activity_trend','analytics_top_search_terms','analytics_title_usage');
```

If auth triggers are missing:
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

1. Supabase Dashboard → **Authentication** → **Providers**
2. Enable **Email**
3. Demo/testing: toggle **"Confirm email"** OFF · Production: keep ON
4. Set **Site URL** → `http://localhost:8080`
5. Add redirect URLs: `http://localhost:8080`, `http://localhost:8080/reset-password`

---

## Step 6: Get Your Supabase Credentials

Supabase Dashboard → **Settings** → **API**, copy:
- **Project URL** (e.g. `https://abcdefg.supabase.co`)
- **anon public key** (starts with `eyJ...`)
- **Project ID** (the `abcdefg` part)

---

## Step 7: Update Your `.env` File

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-public-key
VITE_SUPABASE_PROJECT_ID=YOUR-PROJECT-ID
```

---

## Step 8: Update Supabase Client

Edit `src/integrations/supabase/client.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "your-anon-public-key";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
```

---

## Step 9: Create Storage Buckets

In Supabase Dashboard → **Storage**:

1. `book-files` (Private)
2. `book-images` (Public)

---

## Step 10: Deploy Edge Functions

### Link
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-ID
```

### Deploy
```bash
supabase functions deploy gemini-ai --no-verify-jwt
supabase functions deploy parse-pdf --no-verify-jwt
supabase functions deploy extract-pdf-text --no-verify-jwt
supabase functions deploy extract-epub-chapters --no-verify-jwt
supabase functions deploy enrich-book-metadata --no-verify-jwt
supabase functions deploy process-imported-book --no-verify-jwt
supabase functions deploy import-s3-books --no-verify-jwt
supabase functions deploy hybrid-search --no-verify-jwt
```

### Set API Keys
```bash
supabase secrets set GEMINI_API_KEY=your-gemini-api-key
supabase secrets set GROQ_API_KEY=your-groq-api-key
```

| Edge Function | API Key | Purpose |
|---|---|---|
| `gemini-ai` | `GEMINI_API_KEY` | Chapter Q&A, AI assistant (RAG-grounded against chapter chunks) |
| `hybrid-search` | `GROQ_API_KEY` | AI-powered catalog discovery |
| `parse-pdf` | `GEMINI_API_KEY` | PDF chapter extraction |
| `extract-pdf-text` | `GEMINI_API_KEY` | PDF text extraction |
| `extract-epub-chapters` | — | EPUB chapter parsing |
| `enrich-book-metadata` | — | EPUB metadata extraction |
| `process-imported-book` | `GEMINI_API_KEY` | Post-import processing + embedding generation |
| `import-s3-books` | AWS credentials | S3 bulk import |

> **AI architecture note**: Reader Q&A uses a **RAG pipeline** — Gemini generates embeddings on import, chunks are stored in `book_chapters`, retrieved at query time, then sent to Gemini Flash with the user's question. Embeddings/RAG are required for accurate grounded answers.

---

## Step 11: Connect S3 (Bulk Book Import)

```bash
supabase secrets set AWS_ACCESS_KEY_ID=AKIA...your-access-key
supabase secrets set AWS_SECRET_ACCESS_KEY=wJal...your-secret-key
supabase secrets set AWS_S3_BUCKET=your-bucket-name
supabase secrets set AWS_S3_REGION=eu-north-1
```

### Create AWS IAM User
1. AWS Console → **IAM** → **Users** → **Create User**
2. Name: `medcompli-s3-reader`
3. Attach policy: `AmazonS3ReadOnlyAccess`
4. **Security credentials** → **Create access key** → **Application running outside AWS**

### Trigger Import
**Dry run:**
```bash
curl -X POST "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "dryRun": true}'
```

**Actual import:**
```bash
curl -X POST "https://YOUR-PROJECT-ID.supabase.co/functions/v1/import-s3-books" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "limit": 50}'
```

### Bucket Structure
```
your-bucket/
├── 978-0-1234-5678-9.epub    ← ISBN as filename
├── 978-0-1234-5678-9.pdf
├── 978-0-1234-5678-9.jpg     ← Cover (auto-matched by ISBN)
└── subfolder/
```

---

## Step 12: Bootstrap First Admin

1. Insert an `enterprises` row with `domain` (e.g. `hospital.org`) and `contact_email`
2. Sign up with the `contact_email` → auto-assigned **admin** role
3. Sign up with any email matching `domain` → auto-assigned **staff**

> ⚠️ **Seat enforcement**: If `used_seats >= license_seats`, new signups are created with `is_active = false` and `pending_reason = 'seat_limit_exceeded'`. The enterprise admin must approve them via the Enterprise Dashboard or call `approve_pending_users(enterprise_id)`. If you later **decrease** `license_seats` below `used_seats`, the newest staff are flagged `pending_reason = 'over_limit'` automatically.

Make someone a **platform admin**:
```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('YOUR-USER-UUID', 'platform_admin');
```

---

## Step 13: Run the App 🎉

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

---

## Step 14: Deploy to Vercel

1. Push to GitHub → import on [vercel.com](https://vercel.com)
2. Set env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
3. Deploy
4. Update Supabase Auth: **Site URL** + **Redirect URLs** → your Vercel domain

---

## ✅ Quick Checklist

| Step | Done? |
|------|-------|
| Cloned repo & ran `npm install` (Node 20) | ☐ |
| Created Supabase project | ☐ |
| Ran `SUPABASE-FULL-EXPORT.sql` (base) | ☐ |
| Ran `SUPABASE-PATCH-V2.sql` (latest additions) | ☐ |
| Verified triggers + new tables (`search_queries`, `feature_flags`) | ☐ |
| Verified analytics RPCs (`analytics_*`) | ☐ |
| Verified `books.price` & `compliance_collections.annual_price_range` columns | ☐ |
| Enabled Email auth + set Site URL / redirects | ☐ |
| Updated `.env` and `client.ts` | ☐ |
| Created `book-files` + `book-images` buckets | ☐ |
| Deployed all 8 edge functions | ☐ |
| Set `GEMINI_API_KEY` + `GROQ_API_KEY` secrets | ☐ |
| Set AWS S3 credentials (optional) | ☐ |
| Bootstrapped enterprise + platform_admin | ☐ |
| Ran `npm run dev` | ☐ |
| Deployed to Vercel | ☐ |

---

## 🆘 Troubleshooting

**"Invalid API key" in browser console**
→ Check `.env` and `client.ts` match Dashboard → Settings → API.

**Sign-up not working**
→ Email provider enabled? Site URL set?

**User signs up but can't access anything**
→ Domain mismatch (no enterprise binding) OR they're `pending_seat`/`over_limit`. Check `profiles.is_active` and `pending_reason`. Approve via Enterprise Dashboard.

**AI assistant returns empty / generic answers**
→ Verify `gemini-ai` is deployed and `GEMINI_API_KEY` is set. Check that book chunks have embeddings — re-run `process-imported-book` for that book if missing.

**AI search not working**
→ Verify `hybrid-search` deployed and `GROQ_API_KEY` set.

**Full-text search returns no results**
→ Search vectors empty for legacy rows:
```sql
UPDATE public.books          SET title = title;
UPDATE public.book_chapters  SET title = title;
```

**Analytics dashboard shows "No data yet"**
→ Expected on a fresh install. Use the app (browse, open reader, search) and refresh — data appears within ~10 seconds. Or seed demo data.

**Storage upload fails** → Verify `book-files` and `book-images` buckets exist.

**S3 import "Missing AWS credentials"** → `supabase secrets list` should show 4 AWS secrets.

**S3 import "Missing x-amz-content-sha256"** → Re-deploy `import-s3-books` (latest version includes this header).

**Port 8080 already in use** → Change in `vite.config.ts`.

**`seat_limit_exceeded` on signup** → Enterprise full. Increase `license_seats` (calls `update_subscription` RPC) or approve from Enterprise Dashboard.

**PowerShell `curl` errors** → Use `curl.exe` or `Invoke-RestMethod` syntax.

**Docker needed?** → No. Hosted Supabase covers everything; `supabase start` is only for local-only dev.

---

## 📌 Updating an Existing Database

If you already deployed the platform with the older `SUPABASE-FULL-EXPORT.sql`:

1. Open Supabase Dashboard → **SQL Editor** → **New Query**
2. Paste the entire contents of `public/exports/SUPABASE-PATCH-V2.sql`
3. **Run** — you'll see "Success" with no errors
4. (Optional) Run the verification block at the bottom of the patch file
5. Pull the latest code from git and redeploy your frontend

The patch is idempotent: re-running it does nothing harmful.
