-- 0005 — the revenue pulse.
--
-- Stripe is read every five minutes, but earnings are still only REPORTED
-- once a month. The difference between those two numbers is what the market
-- trades on: a customer signs up at 14:32 and the price steps up at 14:32,
-- a customer churns and it steps down, and the monthly report just moves the
-- number from "unreported" to "reported" without a gap (fair value is linear
-- in MRR, so the handover is continuous by construction).
--
-- Every row here is a real thing that happened in a real Stripe account.
-- Nothing writes to this table but the poller.

create table if not exists public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  at timestamptz not null default now(),
  prev_mrr numeric not null check (prev_mrr >= 0),
  mrr numeric not null check (mrr >= 0),
  -- what Stripe's subscription count says the change was
  kind text not null check (kind in ('new', 'churn', 'expansion', 'contraction')),
  subscriptions integer,
  prev_subscriptions integer
);

create index if not exists revenue_events_ticker_at_idx
  on public.revenue_events (ticker_id, at desc);

alter table public.revenue_events enable row level security;

drop policy if exists "revenue events are public" on public.revenue_events;
create policy "revenue events are public"
  on public.revenue_events for select
  using (true);
-- no insert/update/delete policy: only the service role (the poller) writes.

-- What Stripe says right now, as opposed to what was last reported.
alter table public.stripe_connections
  add column if not exists live_mrr numeric;
alter table public.stripe_connections
  add column if not exists live_subscriptions integer;
alter table public.stripe_connections
  add column if not exists live_synced_at timestamptz;

comment on column public.stripe_connections.live_mrr is
  'MRR as of the last five-minute poll. The price trades on this; mrr_updates still holds the monthly reported number.';
