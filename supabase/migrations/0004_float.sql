-- 0004 — per-ticker float.
--
-- Until now every listing was cut into the same 10,000 shares, so prices on
-- the board spanned $1.47 to $118.55 for no reason other than company size,
-- and a micro-cap could be bought outright by one $10,000 account. The share
-- count is a unit choice — market cap is ARR x multiple no matter how many
-- slices it is cut into — so listings now size their own float at IPO the way
-- a real company does, and one account may hold only a fraction of it
-- (MAX_POSITION_FRACTION in lib/pricing.ts, enforced in /api/trade).
--
-- Existing rows keep 10,000 until scripts/split-floats.ts assigns them a
-- float and split-adjusts their price history and any open positions.

alter table public.tickers
  add column if not exists shares_outstanding integer not null default 10000;

alter table public.tickers
  drop constraint if exists tickers_shares_outstanding_sane;

alter table public.tickers
  add constraint tickers_shares_outstanding_sane
  check (shares_outstanding between 100 and 100000000);

comment on column public.tickers.shares_outstanding is
  'Shares this listing was cut into at IPO. Market cap is ARR x multiple regardless of this number — it only sets the price per share, and how much of the company one position represents.';
