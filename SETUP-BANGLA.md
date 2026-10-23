# Atlas + Supabase + GitHub Pages — বাংলা সেটআপ গাইড

তোমার Supabase Project URL ইতিমধ্যে worker ও admin configuration-এ বসানো আছে:

`https://vvozgyaikmeeeqfansrn.supabase.co`

**Publishable key এখনো ইচ্ছাকৃতভাবে placeholder রাখা হয়েছে।** তোমার screenshot থেকে সম্পূর্ণ key পড়া যায়নি, তাই কোনো key অনুমান করে বসানো হয়নি। GitHub Actions secret হিসেবে key যোগ করলে deploy workflow সেটি build-এর সময় দুই frontend-এ বসাবে।

## ১) ZIP Extract করো

ZIP extract করে `atlas-github-supabase` ফোল্ডারের সব ফাইল একটি নতুন GitHub repository-তে upload করো। Repository-র নাম উদাহরণস্বরূপ `atlas-platform` রাখতে পারো। Default branch-এর নাম `main` হওয়া উচিত।

## ২) GitHub repository-তে ৪টি Actions secret যোগ করো

GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**। নিচের প্রতিটি নাম হুবহু লিখবে:

1. `ATLAS_SUPABASE_PUBLISHABLE_KEY` — Supabase → Project Settings → API Keys → Publishable key থেকে পুরো `sb_publishable_...` key কপি করো।
2. `ATLAS_SUPABASE_SECRET_KEY` — **নতুন করে rotate করা** Supabase `sb_secret_...` key। এটি কখনো source code-এ বসাবে না।
3. `SUPABASE_ACCESS_TOKEN` — Supabase Account → Access Tokens থেকে তৈরি করা personal access token।
4. `SUPABASE_DB_PASSWORD` — Supabase project তৈরির সময় নির্ধারণ করা database password। মনে না থাকলে Supabase Dashboard থেকে database password reset করে সেই নতুন password এখানে দাও।

প্রতিটি secret-এর value paste করে **Add secret** চাপো। এই key-গুলো chat, screenshot বা public repository-তে শেয়ার করবে না।

## ৩) প্রকাশের আগে Secret key rotate করো

আগের screenshot-এ Secret API key দৃশ্যমান ছিল। Supabase Dashboard → Project Settings → API Keys-এ গিয়ে ওই পুরোনো secret key revoke/rotate করো। তারপর **নতুন secret key**-টি শুধু `ATLAS_SUPABASE_SECRET_KEY` GitHub secret-এ বসাও। পুরোনো key-টি আর ব্যবহার কোরো না।

## ৪) GitHub Pages চালু করো

GitHub repository → **Settings → Pages** → Build and deployment → Source হিসেবে **GitHub Actions** নির্বাচন করো।

তারপর **Actions** tab খোলো। `Deploy Atlas frontends to GitHub Pages` এবং `Deploy Atlas database and Edge Function` workflow চলবে। দুটো workflow-ই সবুজ (success) হয়েছে কি না যাচাই করো। কোনোটি লাল হলে সেটিতে ক্লিক করে error log দেখো।

## ৫) Admin account তৈরি করো

1. GitHub Pages URL-এ `/worker/` খুলে নিজের email দিয়ে একটি account register করো।
2. Email confirmation চালু থাকলে email confirm করে sign in করো।
3. Supabase Dashboard → SQL Editor-এ নিচের query চালাও। `YOUR-ADMIN-EMAIL`-এর জায়গায় নিজের registration email বসাবে:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR-ADMIN-EMAIL';
```

4. `/admin/` খুলে ওই একই account দিয়ে sign in করো।

## ৬) URLs

GitHub username ও repository name অনুযায়ী URL হবে:

- Worker portal: `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/worker/`
- Admin panel: `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/admin/`

**মনে রাখবে:** এই ZIP-এর default workflow একই GitHub Pages site-এ দুই portal-কে আলাদা path-এ প্রকাশ করে। সম্পূর্ণ আলাদা domain/Pages site চাইলে worker ও admin frontend-কে আলাদা GitHub repository-তে deploy করতে হবে। Supabase backend একই থাকতে পারে।

## ৭) নতুন migration ও demo profile

`supabase/migrations/202610230002_demo_profiles_and_payout_destinations.sql` migration-টি deploy হতে হবে। এটি withdrawal request-এ Binance Pay ID / wallet destination সংরক্ষণ করে এবং ৪০০টি `DEMO ONLY` synthetic profile ও আলাদা sample conversation তৈরি করে। এগুলো login করতে পারে না এবং real worker/earnings-এর সঙ্গে মেশে না।

Withdrawal form-এ Pay ID বা wallet address এবং সঠিক coin/network নির্বাচন করতে হবে। ভুল network/address-এ crypto পাঠালে ফেরত পাওয়া নাও যেতে পারে। Admin transfer নিজে সম্পন্ন করার পরেই `Mark paid` ব্যবহার করবে; সাইট নিজে থেকে Binance-এ টাকা পাঠায় না।

## ৮) প্রথমে test করো

Worker account দিয়ে register/login, task দেখা, submission upload, earnings এবং withdrawal request পরীক্ষা করো। Admin account দিয়ে PDF upload, submission review, approval, worker messages এবং withdrawal review পরীক্ষা করো। বাস্তব worker-দের invite করার আগে test data দিয়ে পুরো workflow যাচাই করো।

## গুরুত্বপূর্ণ সীমাবদ্ধতা

- `ATLAS_SUPABASE_SECRET_KEY`, database password এবং Supabase access token কখনো frontend JavaScript-এ বসানো যাবে না।
- Publishable key browser-এ থাকা স্বাভাবিক; নিরাপত্তা নির্ভর করে backend authorization, Auth এবং RLS/configuration-এর ওপরও।
- Withdrawal `Mark paid` শুধু status বদলায়; এটি নিজে থেকে ব্যাংক/মোবাইল ওয়ালেটে টাকা পাঠায় না।
- এটি deployable starter, production security audit-এর বিকল্প নয়।
