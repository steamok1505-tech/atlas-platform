# Atlas — GitHub Pages + Supabase

A static worker portal and admin console backed by Supabase Auth, PostgreSQL, private Storage, and an Edge Function API.

- `worker/` — worker portal
- `admin/` — admin console
- `shared/client.js` — API client and private PDF uploads
- `supabase/migrations/` — database schema, private PDF bucket, access policies, withdrawal reservation RPC, payout destinations, and isolated demo data
- `supabase/functions/atlas-api/` — backend API; uses server-only Supabase secret key
- `.github/workflows/pages.yml` — deploys both frontends to GitHub Pages
- `.github/workflows/supabase.yml` — applies the migration and deploys the Edge Function
- `SETUP-BANGLA.md` — beginner-friendly setup guide in Bengali

## Supabase URL already configured

`https://vvozgyaikmeeeqfansrn.supabase.co`

The URL is already updated in `worker/config.js`, `admin/config.js`, `supabase/config.toml`, and the backend deployment workflow. The publishable key is intentionally a placeholder because the complete value was not provided as text. Add it as the GitHub Actions secret `ATLAS_SUPABASE_PUBLISHABLE_KEY`; the Pages workflow injects it during deployment.

## Required GitHub Actions secrets

- `ATLAS_SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_...`; public-safe, but injected at build time for convenience
- `ATLAS_SUPABASE_SECRET_KEY` — freshly rotated `sb_secret_...`; backend only
- `SUPABASE_ACCESS_TOKEN` — Supabase account access token used by deployment workflow
- `SUPABASE_DB_PASSWORD` — database password for the project

**Important:** a Secret API key was visible in a setup screenshot. Rotate/revoke that key before launch and use only the new key as the GitHub secret. Never put secret keys in browser code or commit them to Git.

## Quick setup

Follow `SETUP-BANGLA.md` for the exact steps. In brief: upload the repository to GitHub on the `main` branch, add the four Actions secrets, set GitHub Pages source to **GitHub Actions**, and confirm both workflows succeed.

The default Pages workflow publishes both portals on one site at `/worker/` and `/admin/`. For separate domains, deploy the two frontend folders from separate GitHub repositories/sites while keeping the same Supabase backend.

## First admin account

Register your own account from the worker portal, then in Supabase SQL Editor run this query with your registered email:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR-ADMIN-EMAIL';
```

Then sign in to `/admin/` with that account. Worker accounts are assigned the `worker` role by default; admin permissions are verified server-side.

## Payment and production notes

- Each approved PDF credits $8 once; approval is restricted to pending submissions.
- Withdrawal requests are in $50 increments. The $10 fee per $50 is deducted from payout, not charged upfront.
- Workers can specify a Binance Pay ID or a supported crypto network destination. The administrator must verify the destination/network and complete any transfer manually; `Mark paid` does not itself transfer money.
- Migration `202610230002_demo_profiles_and_payout_destinations.sql` adds 400 explicitly labelled synthetic demo profiles and isolated sample conversations. They are not Auth accounts and do not affect real worker counts, submissions, or earnings.
- This is a deployable starter, not a completed production audit. Test with dummy PDFs and test accounts before inviting real workers. Add rate limiting, abuse protection, operational monitoring, backups, dispute handling, and appropriate legal/payment checks before public launch.


### Demo contact sidebar (latest update)

The worker sidebar can show six synthetic `Demo Contact` entries with randomized illustrative statuses. These are not real people or real online-presence indicators. Selecting one opens a separate support conversation, routes messages into the admin inbox, and keeps replies under the `Atlas Support` identity. Apply all Supabase migrations before using this feature; the latest migration adds `messages.contact_label`.
