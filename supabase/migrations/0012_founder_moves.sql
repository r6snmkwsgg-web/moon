-- 0012_founder_moves — what a founder can do to their own ticker, and what
-- holding a real growing business pays.
--
--   · earnings calls: a founder posts an update with guidance for next
--     month's MRR; the market trades it, the next real print settles it.
--   · dividends: when a listing's monthly MRR grows, holders are paid a
--     share of the growth, in play money, per share held.
--   · buybacks: a founder buys shares off the float with their own play
--     money and retires them — the float shrinks, every remaining share is
--     a bigger slice.

-- ── earnings calls ──────────────────────────────────────────────────────────
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  -- guidance: expected change in next month's MRR, as a fraction (+0.15 = up 15%)
  guidance numeric not null check (guidance between -0.9 and 3),
  -- settled by the next monthly report: the change it actually printed
  actual numeric,
  outcome text check (outcome in ('beat', 'met', 'missed')),
  settled_month date,
  created_at timestamptz not null default now()
);
create index if not exists calls_ticker_created on public.calls (ticker_id, created_at desc);
alter table public.calls enable row level security;
create policy "calls: public read" on public.calls for select using (true);

-- ── dividends ───────────────────────────────────────────────────────────────
create table if not exists public.dividends (
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  month date not null,
  prev_mrr numeric not null,
  mrr numeric not null,
  pool numeric not null,
  per_share numeric not null,
  holders integer not null,
  paid_at timestamptz not null default now(),
  primary key (ticker_id, month)
);
alter table public.dividends enable row level security;
create policy "dividends: public read" on public.dividends for select using (true);

create table if not exists public.dividend_payments (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  shares numeric not null,
  amount numeric not null,
  paid_at timestamptz not null default now(),
  unique (ticker_id, user_id, month)
);
create index if not exists dividend_payments_user on public.dividend_payments (user_id, paid_at desc);
alter table public.dividend_payments enable row level security;
create policy "dividend_payments: public read" on public.dividend_payments for select using (true);

-- pays one dividend to every holder in one transaction; idempotent per month
create or replace function public.pay_dividend(
  p_ticker_id uuid,
  p_month date,
  p_prev_mrr numeric,
  p_mrr numeric,
  p_pool numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_float numeric;
  v_per_share numeric;
  v_holders integer;
begin
  if exists (select 1 from public.dividends where ticker_id = p_ticker_id and month = p_month) then
    return 0;
  end if;
  select coalesce(shares_outstanding, 10000) into v_float from public.tickers where id = p_ticker_id for update;
  v_per_share := p_pool / v_float;
  insert into public.dividend_payments (ticker_id, user_id, month, shares, amount)
    select p_ticker_id, h.user_id, p_month, h.shares, round(h.shares * v_per_share, 2)
    from public.holdings h
    where h.ticker_id = p_ticker_id and h.shares > 0;
  get diagnostics v_holders = row_count;
  update public.profiles p
    set cash = p.cash + d.amount
    from public.dividend_payments d
    where d.ticker_id = p_ticker_id and d.month = p_month and d.user_id = p.id;
  insert into public.dividends (ticker_id, month, prev_mrr, mrr, pool, per_share, holders)
    values (p_ticker_id, p_month, p_prev_mrr, p_mrr, p_pool, v_per_share, v_holders);
  return v_per_share;
end;
$$;
revoke all on function public.pay_dividend(uuid, date, numeric, numeric, numeric) from public;
grant execute on function public.pay_dividend(uuid, date, numeric, numeric, numeric) to service_role;

-- ── buybacks ────────────────────────────────────────────────────────────────
alter table public.trades add column if not exists is_buyback boolean not null default false;

create table if not exists public.buybacks (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  shares numeric not null check (shares > 0),
  total numeric not null,
  price numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists buybacks_ticker_created on public.buybacks (ticker_id, created_at desc);
alter table public.buybacks enable row level security;
create policy "buybacks: public read" on public.buybacks for select using (true);

-- retires shares the founder just bought: off their holding, off the float
create or replace function public.retire_shares(
  p_ticker_id uuid,
  p_user_id uuid,
  p_shares numeric,
  p_trade_id uuid
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held numeric;
  v_float numeric;
  v_total numeric;
  v_price numeric;
begin
  select shares into v_held from public.holdings where ticker_id = p_ticker_id and user_id = p_user_id for update;
  if v_held is null or v_held < p_shares then
    raise exception 'not enough shares to retire';
  end if;
  select shares_outstanding into v_float from public.tickers where id = p_ticker_id for update;
  if v_float is null then v_float := 10000; end if;
  if v_float - p_shares < 100 then
    raise exception 'a float cannot be retired below a hundred shares';
  end if;
  select total, price into v_total, v_price from public.trades where id = p_trade_id;

  update public.holdings set shares = shares - p_shares where ticker_id = p_ticker_id and user_id = p_user_id;
  delete from public.holdings where ticker_id = p_ticker_id and user_id = p_user_id and shares <= 0;
  update public.tickers set shares_outstanding = v_float - p_shares where id = p_ticker_id;
  update public.trades set is_buyback = true where id = p_trade_id;
  insert into public.buybacks (ticker_id, user_id, shares, total, price)
    values (p_ticker_id, p_user_id, p_shares, coalesce(v_total, 0), coalesce(v_price, 0));
  return v_float - p_shares;
end;
$$;
revoke all on function public.retire_shares(uuid, uuid, numeric, uuid) from public;
grant execute on function public.retire_shares(uuid, uuid, numeric, uuid) to service_role;
