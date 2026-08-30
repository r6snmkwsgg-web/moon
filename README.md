# SAAS EXCHANGE

A **fantasy stock market for indie SaaS startups**. Founders get a ticker,
their self-reported MRR sets the price anchor, and everyone else trades with
play money. The fun is a founder watching their startup trade like a public
company — and screenshotting the chart.

> ⚠ **This is a toy.** Play money only. Not real securities, not investment
> advice. Nothing here can be bought, sold, or cashed out for real value —
> ever. There are no payments, no prizes, and no hooks for either.

Renaming the app: edit `APP_NAME` in `lib/config.ts` — every page, meta tag,
and OG card reads from there.

## What's in the box

- **Self-serve listing** (`/list`): a founder signs in, picks a symbol, and
  pastes a **read-only Stripe restricted key** — MRR is computed from their
  active subscriptions on the spot, the ticker goes live ⚡ Stripe-verified,
  and the cron re-syncs it monthly (automatic earnings reports). Keys are
  validated (secret keys hard-rejected, write access probe-rejected),
  AES-256-GCM encrypted at rest, and deleted on disconnect/delist.
- **Trust ladder**: curated → self-reported → ✓ handle-verified (founder
  posts on X/Threads, admin approves) → ⚡ Stripe-verified.
- **Market depth**: slippage (orders fill along the hype curve; pumping your
  own ticker round-trips to zero), the tape (`/tape` + per-ticker trades),
  bull/bear votes, watchlists with in-app alerts (±10% day moves, MRR
  reports), portfolio value history + 7d/30d leaderboards.
- **Growth loops**: per-ticker OG cards, public trader profiles (`/u/name`)
  with brag cards, invite bonuses (+$2,500 play money each side), a weekly
  recap (`/recap`) with its own card, IPO banners for new listings.
- **Transparency**: `/how` explains the formula with a live playground.

## How the price works

The **entire formula lives in [`lib/pricing.ts`](lib/pricing.ts)** — nothing
else in the app computes a price. Unit tests in
[`tests/pricing.test.ts`](tests/pricing.test.ts) pin the behavior down.

- Every ticker has **10,000 fake shares**.
- `fair_price = (latest MRR × 3) / 10,000` — a toy "3x revenue" multiple.
- `live price = fair_price × (1 + sentiment)`.
- **Sentiment** rises with net play-money buying and falls with selling
  (trading 10% of the float moves it 20 points), is capped at **±40%**, and
  **decays 10% toward zero daily** via cron. Hype moves price short-term;
  MRR is gravity.
- An MRR update reprices the anchor **immediately** — that's the "earnings
  report" moment.
- A daily cron snapshots every price into `price_snapshots`; all charts read
  from that table.

## Stack

Next.js (App Router) · Supabase (auth + Postgres, RLS everywhere) · Tailwind
· Vercel (hosting + cron) · `next/og` for the share cards. No paid APIs, no
scraping.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in order: paste `supabase/migrations/0001_init.sql`,
   then `0002_market_depth.sql`, then `0003_social.sql` into the SQL editor
   (or `supabase db push` with the CLI). Fresh install shortcut:
   `supabase/setup-all-in-one.sql` bundles 0001+0002 + seed data in one
   paste — run `0003_social.sql` after it.
3. Auth → Providers → **Email**: leave the provider ON but turn **Confirm
   email OFF** — sign-in is email + password with no confirmation links, and
   sign-ups get a live session immediately.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — server only, never exposed |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin` |
| `NEXT_PUBLIC_SITE_URL` | Optional on Vercel (falls back to the Vercel domain); set for custom domains |
| `CRON_SECRET` | Random string; Vercel sends it as a Bearer token to the cron route |
| `STRIPE_KEY_ENCRYPTION_SECRET` | Encrypts founders' read-only Stripe keys at rest. Optional — falls back to a key derived from `CRON_SECRET` |

### 3. Run

```bash
npm install
npm run seed     # loads fixtures/tickers.json — 20 tickers, 6 months of MRR each
npm run dev
```

`npm run seed` is idempotent (existing symbols are skipped) and backfills
~120 days of price snapshots so the exchange looks alive on first paint.
Replace the fixtures with real curated startups before launch.

### 4. Deploy on Vercel

Push, import the repo, set the env vars (including `CRON_SECRET`).
`vercel.json` registers the daily cron:

```
GET /api/cron/daily   (06:00 UTC)
```

which decays every ticker's sentiment 10% toward zero and snapshots the
day's price.

### 5. Tests

```bash
npm test   # vitest — lib/pricing.ts is the product; keep it green
```

## How to add a ticker

**Rule: only list startups whose founders already share MRR publicly.**

1. Sign in with an email on `ADMIN_EMAILS` and open `/admin`.
2. "Add ticker": symbol (2–6 letters, shown as `$PRLA`), name, one-line
   pitch, the founder's X/Threads handle, and the first curated MRR number
   (from their public build-in-public posts).
3. The ticker is live at `/t/SYMBOL` immediately; its OG share card is
   generated automatically at `/t/SYMBOL/opengraph-image`.

Until the founder claims the ticker, MRR entries are labeled
**"curated — founder hasn't claimed this ticker yet"** and only the admin can
update them (monthly, via the ticker's row in `/admin`).

## How claims work

1. A founder visits `/claim/SYMBOL` (linked from every unclaimed ticker
   page), signs in, and submits their X/Threads handle.
2. The claim appears in `/admin` → *Pending claims*. Verify the handle
   matches the person who actually posts that startup's MRR, then approve.
3. Approval marks the ticker claimed (✓ badge), records the handle, and
   unlocks **founder tools** on the ticker page:
   - **Post MRR update** — monthly manual entry, honor system, labeled
     "self-reported". Posting reprices the stock instantly.
   - **Request delisting** — lands in `/admin`, where delisting is one
     click: holders are refunded at the last price, then the ticker and all
     of its data (MRR history, snapshots, trades, claims) are hard-deleted.

## The growth loop

Every ticker page ships a dark-terminal OG card (`next/og`, edge-rendered):
symbol, live price, day change in green/red, a 30-day sparkline, and the
"listed on SAAS EXCHANGE" strap. When a founder shares their ticker link on
X/Threads, **the card is the ad**. The "⇪ Share your chart" button copies the
link.

## Security posture

- **RLS on every table.** Tickers, MRR history, and snapshots are
  public-read / admin-write. Profiles, holdings, and trades are readable
  only by their owner. Claims and delist requests can only be inserted for
  yourself (and delist requests only by the ticker's claimed founder).
- All writes that cross users (trading, curation, claim approval, delisting)
  run server-side with the service role **after** an explicit authorization
  check; `execute_trade` has EXECUTE revoked from client roles, so prices
  can't be forged from the browser.
- `/admin` is gated by the `ADMIN_EMAILS` env allowlist, checked server-side
  on the page and again inside every admin action.
- The cron route requires the `CRON_SECRET` bearer token.

## Project map

```
lib/pricing.ts                     the entire price mechanic (+ tests in tests/)
lib/data.ts                        market/portfolio/leaderboard queries
supabase/migrations/0001_init.sql  schema, RLS, execute_trade
app/page.tsx                       the exchange (table + top movers)
app/t/[symbol]/                    ticker page, founder tools, OG card
app/portfolio, app/leaderboard     play-money PnL
app/claim/[symbol]                 founder claim flow
app/admin                          curation, claims, one-click delist
app/api/trade                      buy/sell (price computed in lib/pricing.ts)
app/api/cron/daily                 sentiment decay + price snapshot
scripts/seed.ts + fixtures/        20 example tickers, 6 months MRR each
```
