-- SAAS EXCHANGE — schema, RLS, and the atomic trade ledger function.
-- Run via `supabase db push` or paste into the Supabase SQL editor.
--
-- RLS posture:
--   * tickers, mrr_updates, price_snapshots: public READ, no client writes
--     (admin writes go through the service role after an env allowlist check).
--   * profiles, holdings, trades: each user reads only their own rows; all
--     mutations go through execute_trade() called with the service role.
--   * claims, delist_requests: users insert/read their own; admin resolves.

-- ───────────────────────────── profiles ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  cash numeric not null default 10000 check (cash >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

-- Auto-provision a profile (with the $10,000 starting stake) on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'trader'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── tickers ──────────────────────────────
create table public.tickers (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique check (symbol ~ '^[A-Z]{2,6}$'),
  name text not null,
  pitch text not null,
  logo_url text,
  founder_handle text,
  claimed boolean not null default false,
  claimed_by uuid references auth.users (id) on delete set null,
  sentiment numeric not null default 0 check (sentiment between -0.4 and 0.4),
  listed_at timestamptz not null default now()
);

alter table public.tickers enable row level security;

create policy "tickers: public read" on public.tickers
  for select using (true);

-- ─────────────────────────── mrr_updates ────────────────────────────
create table public.mrr_updates (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  mrr numeric not null check (mrr >= 0),
  source text not null check (source in ('self-reported', 'curated')),
  created_at timestamptz not null default now(),
  unique (ticker_id, month)
);

alter table public.mrr_updates enable row level security;

create policy "mrr_updates: public read" on public.mrr_updates
  for select using (true);

-- ────────────────────────── price_snapshots ─────────────────────────
create table public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  day date not null,
  price numeric not null,
  fair_price numeric not null,
  sentiment numeric not null,
  mrr numeric not null,
  unique (ticker_id, day)
);

create index price_snapshots_ticker_day on public.price_snapshots (ticker_id, day);

alter table public.price_snapshots enable row level security;

create policy "price_snapshots: public read" on public.price_snapshots
  for select using (true);

-- ───────────────────────────── holdings ─────────────────────────────
create table public.holdings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  shares numeric not null check (shares >= 0),
  avg_cost numeric not null default 0,
  primary key (user_id, ticker_id)
);

alter table public.holdings enable row level security;

create policy "holdings: read own" on public.holdings
  for select using (auth.uid() = user_id);

-- ────────────────────────────── trades ──────────────────────────────
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  side text not null check (side in ('buy', 'sell')),
  shares numeric not null check (shares > 0),
  price numeric not null check (price >= 0),
  total numeric not null,
  created_at timestamptz not null default now()
);

alter table public.trades enable row level security;

create policy "trades: read own" on public.trades
  for select using (auth.uid() = user_id);

-- ────────────────────────────── claims ──────────────────────────────
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  handle text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.claims enable row level security;

create policy "claims: read own" on public.claims
  for select using (auth.uid() = user_id);

create policy "claims: submit own" on public.claims
  for insert with check (auth.uid() = user_id and status = 'pending');

-- ────────────────────────── delist_requests ─────────────────────────
create table public.delist_requests (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ticker_id, user_id)
);

alter table public.delist_requests enable row level security;

create policy "delist_requests: read own" on public.delist_requests
  for select using (auth.uid() = user_id);

-- Only the founder who claimed a ticker can request its delisting.
create policy "delist_requests: founder submits" on public.delist_requests
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.tickers t
      where t.id = ticker_id and t.claimed_by = auth.uid()
    )
  );

-- ─────────────────────────── execute_trade ──────────────────────────
-- Atomic ledger update for one trade. The PRICE IS NOT COMPUTED HERE:
-- the server computes price + new sentiment in lib/pricing.ts (the single
-- source of truth for the formula) and passes them in. This function only
-- moves play money around consistently. EXECUTE is revoked from client
-- roles — only the service role may call it, after authenticating the user.
create or replace function public.execute_trade(
  p_user_id uuid,
  p_ticker_id uuid,
  p_side text,
  p_shares numeric,
  p_price numeric,
  p_new_sentiment numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric := round(p_shares * p_price, 2);
  v_cash numeric;
  v_shares numeric;
  v_avg numeric;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'invalid side';
  end if;
  if p_shares is null or p_shares <= 0 or p_shares != floor(p_shares) then
    raise exception 'shares must be a positive whole number';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid price';
  end if;

  select cash into v_cash from public.profiles
    where id = p_user_id for update;
  if v_cash is null then
    raise exception 'profile not found';
  end if;

  select shares, avg_cost into v_shares, v_avg from public.holdings
    where user_id = p_user_id and ticker_id = p_ticker_id for update;
  v_shares := coalesce(v_shares, 0);
  v_avg := coalesce(v_avg, 0);

  if p_side = 'buy' then
    if v_cash < v_total then
      raise exception 'insufficient cash';
    end if;
    update public.profiles set cash = cash - v_total where id = p_user_id;
    insert into public.holdings (user_id, ticker_id, shares, avg_cost)
    values (
      p_user_id, p_ticker_id, p_shares,
      p_price
    )
    on conflict (user_id, ticker_id) do update set
      avg_cost = (public.holdings.shares * public.holdings.avg_cost + excluded.shares * p_price)
                 / (public.holdings.shares + excluded.shares),
      shares = public.holdings.shares + excluded.shares;
  else
    if v_shares < p_shares then
      raise exception 'insufficient shares';
    end if;
    update public.profiles set cash = cash + v_total where id = p_user_id;
    update public.holdings
      set shares = shares - p_shares
      where user_id = p_user_id and ticker_id = p_ticker_id;
    delete from public.holdings
      where user_id = p_user_id and ticker_id = p_ticker_id and shares = 0;
  end if;

  insert into public.trades (user_id, ticker_id, side, shares, price, total)
  values (p_user_id, p_ticker_id, p_side, p_shares, p_price, v_total);

  update public.tickers
    set sentiment = greatest(-0.4, least(0.4, p_new_sentiment))
    where id = p_ticker_id;

  select cash into v_cash from public.profiles where id = p_user_id;
  return jsonb_build_object('cash', v_cash);
end;
$$;

revoke execute on function public.execute_trade from public, anon, authenticated;
grant execute on function public.execute_trade to service_role;
