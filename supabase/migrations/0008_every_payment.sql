-- 0008 — every payment counts, not just recurring ones.
--
-- The market priced off MRR, which meant it only worked for subscription
-- businesses, and even for those it missed most of what happened. A live
-- account showed $30.50 collected today across several payments while MRR did
-- not move once — because a renewal on an existing subscription changes no
-- run rate, and a one-time charge is invisible to the subscriptions API
-- altogether. The founder watched their busiest day register as nothing.
--
-- So the anchor becomes money actually received. Every succeeded charge, net
-- of refunds, bucketed by market day. A subscription business's daily
-- revenue still averages out to its MRR, so nothing is lost for them — and a
-- shop selling one-time licences becomes tradeable, which it never was.

create table if not exists public.daily_revenue (
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  -- the MARKET day (America/New_York), so the boundary matches the one every
  -- chart and every day-change already uses
  day date not null,
  -- minor units (cents) as Stripe reports them, to keep this exact
  gross_minor bigint not null default 0 check (gross_minor >= 0),
  net_minor bigint not null default 0,
  payments integer not null default 0 check (payments >= 0),
  -- more than one and the totals are not a real sum; the reader reports it
  currency text,
  synced_at timestamptz not null default now(),
  primary key (ticker_id, day)
);

create index if not exists daily_revenue_ticker_day_idx
  on public.daily_revenue (ticker_id, day desc);

alter table public.daily_revenue enable row level security;

drop policy if exists "daily revenue is public" on public.daily_revenue;
create policy "daily revenue is public"
  on public.daily_revenue for select
  using (true);
-- no insert/update/delete policy: only the service role (the poller) writes.

comment on table public.daily_revenue is
  'Money actually received per market day, from every succeeded charge net of refunds. The price anchors on this, so one-time revenue counts the same as recurring.';

-- How far back the first sync reaches for a newly connected account.
alter table public.stripe_connections
  add column if not exists revenue_synced_at timestamptz;
alter table public.stripe_connections
  add column if not exists revenue_backfilled boolean not null default false;

comment on column public.stripe_connections.revenue_backfilled is
  'Set once the historical charge backfill has run for this connection, so the poller only walks the long window one time.';
