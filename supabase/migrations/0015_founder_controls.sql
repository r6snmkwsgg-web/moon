-- 0015_founder_controls — a company gets a balance sheet, and a founder gets
-- something to do with it.
--
-- Until now the founder tools were narrative (earnings calls) plus one blunt
-- market instrument (a buyback out of their own pocket). Dividends happened
-- TO them, on a formula, out of nothing: the pool was a year of MRR growth
-- conjured from thin air and handed to holders, up to a tenth of it back to
-- the founder themselves. Nothing was ever deducted from anything.
--
-- The missing piece was a treasury. Give each listing a cash balance that
-- its own revenue accrues into, and every founder action becomes a real
-- trade-off against a real budget:
--
--     revenue lands        -> treasury grows
--     issue new shares     -> treasury grows, float grows
--     declare a dividend   -> treasury shrinks
--     buy back and retire  -> treasury shrinks, float shrinks
--
-- Because the treasury counts toward what the company is worth, each of
-- these is value-neutral at the moment it happens and carries only signal —
-- which is the point. A dividend is a choice now, and so is a cut.
--
-- Three things in the plan need no schema and are not here: the founder
-- position cap (10% -> 20%), the quiet period around their own earnings
-- calls, and the FOUNDER chip on the tape. All three are read from rows
-- that already exist.

-- ── the treasury ────────────────────────────────────────────────────────────

alter table public.tickers
  add column if not exists treasury numeric not null default 0;

alter table public.tickers
  drop constraint if exists tickers_treasury_non_negative;
alter table public.tickers
  add constraint tickers_treasury_non_negative check (treasury >= 0);

comment on column public.tickers.treasury is
  'The company''s own cash, in play money. Revenue accrues in; dividends, buybacks and nothing else spend it. Counts toward what the company is worth, so issuance and buybacks are value-neutral at the moment they happen.';

-- Where every dollar of it came from and went. The founder page reads this
-- as a statement; without it a treasury balance is a number with no story.
create table if not exists public.treasury_entries (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  kind text not null check (kind in ('revenue', 'offering', 'dividend', 'buyback', 'seed')),
  -- positive is money in, negative is money out
  amount numeric not null,
  balance_after numeric not null,
  note text,
  -- revenue accrues once per day per listing; this is the day it was for
  for_day date,
  created_at timestamptz not null default now()
);
create index if not exists treasury_entries_ticker_created
  on public.treasury_entries (ticker_id, created_at desc);
-- the idempotency key for the daily accrual: one revenue entry per day
create unique index if not exists treasury_entries_revenue_day
  on public.treasury_entries (ticker_id, for_day) where kind = 'revenue';
alter table public.treasury_entries enable row level security;
drop policy if exists "treasury_entries: public read" on public.treasury_entries;
create policy "treasury_entries: public read" on public.treasury_entries for select using (true);

-- Every listing opens with three months of its own revenue retained. Without
-- this the treasury is empty on the day this runs, and since dividends now
-- spend it rather than conjuring it, every listing would quietly stop paying
-- until the accrual had run for a while. A company that has been trading for
-- months having some cash in the bank is also just true.
insert into public.treasury_entries (ticker_id, kind, amount, balance_after, note)
select t.id, 'seed', round(m.mrr * 3, 2), round(m.mrr * 3, 2), 'three months of retained revenue at listing'
from public.tickers t
join lateral (
  select mrr from public.mrr_updates u
  where u.ticker_id = t.id order by u.month desc limit 1
) m on true
where t.treasury = 0 and m.mrr > 0
  and not exists (select 1 from public.treasury_entries e where e.ticker_id = t.id);

update public.tickers t
  set treasury = e.balance_after
  from public.treasury_entries e
  where e.ticker_id = t.id and e.kind = 'seed' and t.treasury = 0;

-- Adds one day's revenue to a company's cash. Idempotent per (ticker, day):
-- the daily cron may run twice and the second run adds nothing.
create or replace function public.accrue_treasury(
  p_ticker_id uuid,
  p_day date,
  p_amount numeric
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_balance numeric;
begin
  if v_amount <= 0 then
    select treasury into v_balance from public.tickers where id = p_ticker_id;
    return coalesce(v_balance, 0);
  end if;

  select treasury into v_balance from public.tickers where id = p_ticker_id for update;
  if v_balance is null then
    raise exception 'unknown ticker';
  end if;

  insert into public.treasury_entries (ticker_id, kind, amount, balance_after, for_day)
  values (p_ticker_id, 'revenue', v_amount, v_balance + v_amount, p_day)
  on conflict (ticker_id, for_day) where kind = 'revenue' do nothing;

  if not found then
    return v_balance;  -- already accrued for that day
  end if;

  update public.tickers set treasury = v_balance + v_amount where id = p_ticker_id;
  return v_balance + v_amount;
end;
$$;
revoke execute on function public.accrue_treasury(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.accrue_treasury(uuid, date, numeric) to service_role;

-- ── dividends come out of the treasury now ──────────────────────────────────
--
-- The table already keys one dividend per (ticker, month), which is exactly
-- the rule we want: a company pays at most once a month, whether the founder
-- declared it or the growth formula did. It only needs to record which.

alter table public.dividends
  add column if not exists kind text not null default 'auto';
alter table public.dividends
  drop constraint if exists dividends_kind_check;
alter table public.dividends
  add constraint dividends_kind_check check (kind in ('auto', 'declared'));
alter table public.dividends
  add column if not exists declared_by uuid references public.profiles (id) on delete set null;
-- a declared dividend is a choice, not a report: it has no MRR either side
alter table public.dividends alter column prev_mrr drop not null;
alter table public.dividends alter column mrr drop not null;

-- The shared body. A dividend is declared PER SHARE, the way a real one is:
-- "six cents a share", not "spend nine hundred dollars". That matters here
-- because most of a float is usually unheld — a pool sized against the whole
-- float would pay out a fraction of itself and read as a broken promise.
--
-- The treasury is the only limit, and it binds on what is actually payable
-- (per share x shares HELD), not on the float. What gets deducted is the sum
-- of the rounded payments, so the books balance to the cent.
create or replace function public.pay_treasury_dividend(
  p_ticker_id uuid,
  p_month date,
  p_per_share numeric,
  p_kind text,
  p_declared_by uuid,
  p_prev_mrr numeric,
  p_mrr numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_float numeric;
  v_treasury numeric;
  v_budget numeric;
  v_owner uuid;
  v_held numeric;
  v_per_share numeric;
  v_holders integer;
  v_paid numeric;
begin
  if exists (select 1 from public.dividends where ticker_id = p_ticker_id and month = p_month) then
    return jsonb_build_object('paid', 0, 'per_share', 0, 'why', 'already paid this month');
  end if;

  select coalesce(shares_outstanding, 10000), treasury, claimed_by
    into v_float, v_treasury, v_owner
    from public.tickers where id = p_ticker_id for update;
  if v_float is null then
    raise exception 'unknown ticker';
  end if;

  -- A claimed listing's dividends are the founder's call, and so is the
  -- month they skip one — that is the entire signal. The growth formula
  -- only keeps paying on the listings nobody is running.
  if p_kind = 'auto' and v_owner is not null then
    return jsonb_build_object('paid', 0, 'per_share', 0, 'why', 'the founder declares this listing''s dividends');
  end if;

  select coalesce(sum(shares), 0) into v_held from public.holdings
    where ticker_id = p_ticker_id and shares > 0;
  if v_held <= 0 then
    return jsonb_build_object('paid', 0, 'per_share', 0, 'why', 'nobody holds it');
  end if;

  -- the automatic one never empties the till: half the balance at most, so
  -- an unclaimed company still has something to buy back or offer with
  v_budget := case when p_kind = 'auto' then v_treasury * 0.5 else v_treasury end;
  v_per_share := least(coalesce(p_per_share, 0), v_budget / v_held);
  if not (v_per_share > 0) then
    return jsonb_build_object('paid', 0, 'per_share', 0, 'why',
      case when v_treasury < 0.01 then 'treasury empty' else 'nothing to pay' end);
  end if;

  insert into public.dividend_payments (ticker_id, user_id, month, shares, amount)
    select p_ticker_id, h.user_id, p_month, h.shares, round(h.shares * v_per_share, 2)
    from public.holdings h
    where h.ticker_id = p_ticker_id and h.shares > 0;
  get diagnostics v_holders = row_count;

  select coalesce(sum(amount), 0) into v_paid from public.dividend_payments
    where ticker_id = p_ticker_id and month = p_month;
  -- a rate spread so thin that every holder rounds to nothing is not a
  -- dividend; undo it rather than spending the month on it
  if v_paid < 0.01 then
    delete from public.dividend_payments where ticker_id = p_ticker_id and month = p_month;
    return jsonb_build_object('paid', 0, 'per_share', 0, 'why', 'too small to reach anyone');
  end if;

  update public.profiles p
    set cash = p.cash + d.amount
    from public.dividend_payments d
    where d.ticker_id = p_ticker_id and d.month = p_month and d.user_id = p.id;

  update public.tickers set treasury = greatest(0, treasury - v_paid) where id = p_ticker_id;
  insert into public.treasury_entries (ticker_id, kind, amount, balance_after, note)
    select p_ticker_id, 'dividend', -v_paid, treasury,
      case when p_kind = 'declared' then 'dividend declared by the founder' else 'dividend on revenue growth' end
    from public.tickers where id = p_ticker_id;

  insert into public.dividends (ticker_id, month, prev_mrr, mrr, pool, per_share, holders, kind, declared_by)
    values (p_ticker_id, p_month, p_prev_mrr, p_mrr, v_paid, v_per_share, v_holders, p_kind, p_declared_by);

  return jsonb_build_object('paid', v_paid, 'per_share', v_per_share, 'holders', v_holders);
end;
$$;
revoke execute on function public.pay_treasury_dividend(uuid, date, numeric, text, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.pay_treasury_dividend(uuid, date, numeric, text, uuid, numeric, numeric) to service_role;

-- The automatic growth dividend keeps its signature and its contract (it
-- returns per-share) so lib/dividends carries on unchanged — it just spends
-- the treasury now instead of thin air, and pays what is actually there.
create or replace function public.pay_dividend(
  p_ticker_id uuid,
  p_month date,
  p_prev_mrr numeric,
  p_mrr numeric,
  p_pool numeric
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_float numeric;
begin
  select coalesce(shares_outstanding, 10000) into v_float from public.tickers where id = p_ticker_id;
  if not (v_float > 0) then
    return 0;
  end if;
  -- the growth pool is quoted across the whole float, so that is the rate
  v := public.pay_treasury_dividend(
    p_ticker_id, p_month, round(coalesce(p_pool, 0), 2) / v_float, 'auto', null, p_prev_mrr, p_mrr);
  return coalesce((v->>'per_share')::numeric, 0);
end;
$$;
revoke execute on function public.pay_dividend(uuid, date, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.pay_dividend(uuid, date, numeric, numeric, numeric) to service_role;

-- The founder's own: any rate per share the treasury can cover, once a
-- calendar month.
-- Declaring one is a signal; the month you do not declare one is a louder
-- signal, which is the whole reason this is a button and not a formula.
create or replace function public.declare_dividend(
  p_ticker_id uuid,
  p_user_id uuid,
  p_per_share numeric   -- dollars per share, the way a dividend is actually declared
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  select claimed_by into v_owner from public.tickers where id = p_ticker_id;
  if v_owner is null or v_owner <> p_user_id then
    raise exception 'only the founder of this listing can declare a dividend';
  end if;
  if p_per_share is null or p_per_share <= 0 then
    raise exception 'a dividend is a positive amount per share';
  end if;
  return public.pay_treasury_dividend(p_ticker_id, v_month, p_per_share, 'declared', p_user_id, null, null);
end;
$$;
revoke execute on function public.declare_dividend(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.declare_dividend(uuid, uuid, numeric) to service_role;

-- ── issuance ────────────────────────────────────────────────────────────────
--
-- The answer to "the float ran out and nobody can buy", which we hit twice
-- during the stress tests. A split cannot fix that — it multiplies everyone's
-- holdings too, so the free float is unchanged; we proved that the expensive
-- way. New shares can.
--
-- Existing holders are not diluted in value: the proceeds land in the
-- treasury, so the company is worth exactly what it was and is cut into more
-- slices. What the new supply does do is absorb the demand, which is what a
-- secondary offering does to a squeeze in a real market.

create table if not exists public.offerings (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  shares numeric not null check (shares > 0),
  price numeric not null check (price > 0),
  proceeds numeric not null,
  float_before numeric not null,
  float_after numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists offerings_ticker_created on public.offerings (ticker_id, created_at desc);
alter table public.offerings enable row level security;
drop policy if exists "offerings: public read" on public.offerings;
create policy "offerings: public read" on public.offerings for select using (true);

/* At most a fifth of the float at a time, and not twice in a week — enough
   to clear a squeeze, not enough to print supply until the price is zero. */
create or replace function public.issue_shares(
  p_ticker_id uuid,
  p_user_id uuid,
  p_shares numeric,
  p_price numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_float numeric;
  v_treasury numeric;
  v_shares numeric := floor(coalesce(p_shares, 0));
  v_proceeds numeric;
  v_last timestamptz;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'invalid price';
  end if;
  if v_shares < 1 then
    raise exception 'an offering is at least one share';
  end if;

  select claimed_by, coalesce(shares_outstanding, 10000), treasury
    into v_owner, v_float, v_treasury
    from public.tickers where id = p_ticker_id for update;
  if v_float is null then
    raise exception 'unknown ticker';
  end if;
  if v_owner is null or v_owner <> p_user_id then
    raise exception 'only the founder of this listing can issue shares';
  end if;

  if v_shares > floor(v_float * 0.2) then
    raise exception 'an offering is capped at a fifth of the float (% shares)', floor(v_float * 0.2);
  end if;
  if v_float + v_shares > 100000000 then
    raise exception 'that would take the float past a hundred million shares';
  end if;

  select max(created_at) into v_last from public.offerings where ticker_id = p_ticker_id;
  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'this listing already issued shares in the last seven days';
  end if;

  v_proceeds := round(v_shares * p_price, 2);

  update public.tickers
    set shares_outstanding = v_float + v_shares,
        treasury = treasury + v_proceeds
    where id = p_ticker_id;

  insert into public.offerings (ticker_id, user_id, shares, price, proceeds, float_before, float_after)
    values (p_ticker_id, p_user_id, v_shares, p_price, v_proceeds, v_float, v_float + v_shares);
  insert into public.treasury_entries (ticker_id, kind, amount, balance_after, note)
    values (p_ticker_id, 'offering', v_proceeds, v_treasury + v_proceeds,
            'issued ' || v_shares || ' shares at ' || round(p_price, 4));

  return jsonb_build_object(
    'shares', v_shares, 'price', p_price, 'proceeds', v_proceeds,
    'float', v_float + v_shares, 'treasury', v_treasury + v_proceeds
  );
end;
$$;
revoke execute on function public.issue_shares(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.issue_shares(uuid, uuid, numeric, numeric) to service_role;

-- ── the other side of it: a buyback the company pays for ────────────────────
--
-- retire_shares (0012) stays as it is — that is the founder buying on the
-- open market with their own play money and retiring what they bought, and
-- it should keep costing them personally. This is the company doing it out
-- of its own cash, which is what a buyback actually is.
create or replace function public.retire_from_treasury(
  p_ticker_id uuid,
  p_user_id uuid,
  p_shares numeric,
  p_price numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_float numeric;
  v_treasury numeric;
  v_shares numeric := round(coalesce(p_shares, 0), 4);
  v_cost numeric;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'invalid price';
  end if;
  if v_shares <= 0 then
    raise exception 'shares must be positive';
  end if;

  select claimed_by, coalesce(shares_outstanding, 10000), treasury
    into v_owner, v_float, v_treasury
    from public.tickers where id = p_ticker_id for update;
  if v_float is null then
    raise exception 'unknown ticker';
  end if;
  if v_owner is null or v_owner <> p_user_id then
    raise exception 'only the founder of this listing can spend its treasury';
  end if;

  v_cost := round(v_shares * p_price, 2);
  if v_cost > v_treasury then
    raise exception 'the treasury holds $%, this costs $%', round(v_treasury, 2), v_cost;
  end if;
  if v_float - v_shares < 100 then
    raise exception 'a float cannot be retired below a hundred shares';
  end if;

  update public.tickers
    set shares_outstanding = floor(v_float - v_shares),
        treasury = treasury - v_cost
    where id = p_ticker_id;

  insert into public.buybacks (ticker_id, user_id, shares, total, price)
    values (p_ticker_id, p_user_id, v_shares, v_cost, p_price);
  insert into public.treasury_entries (ticker_id, kind, amount, balance_after, note)
    values (p_ticker_id, 'buyback', -v_cost, v_treasury - v_cost,
            'bought back and retired ' || v_shares || ' shares');

  return jsonb_build_object(
    'shares', v_shares, 'cost', v_cost,
    'float', floor(v_float - v_shares), 'treasury', v_treasury - v_cost
  );
end;
$$;
revoke execute on function public.retire_from_treasury(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.retire_from_treasury(uuid, uuid, numeric, numeric) to service_role;

-- ── splits restate the new history too ──────────────────────────────────────
--
-- A split changes the unit, so everything quoted per share has to be
-- restated or it silently means something else afterwards. 0013 did this for
-- trades, ticks and snapshots; dividends and offerings are quoted per share
-- as well.
create or replace function public.split_ticker(
  p_ticker_id uuid,
  p_factor numeric,
  p_price numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_float numeric;
  v_new_float numeric;
begin
  if p_factor is null or p_factor <= 0 or p_factor = 1 then
    raise exception 'split factor must be positive and not one';
  end if;

  select shares_outstanding into v_float from public.tickers where id = p_ticker_id for update;
  if v_float is null then
    v_float := 10000;
  end if;
  v_new_float := round(v_float * p_factor);

  -- holders: the same value in the new count, fractions and all
  update public.holdings
    set shares = round(shares * p_factor, 4),
        avg_cost = avg_cost / p_factor
    where ticker_id = p_ticker_id;
  delete from public.holdings where ticker_id = p_ticker_id and shares <= 0.00005;

  -- the record, restated in the new unit; totals do not change
  update public.trades set shares = shares * p_factor, price = price / p_factor where ticker_id = p_ticker_id;
  update public.flow_ticks set price = price / p_factor where ticker_id = p_ticker_id;
  update public.price_snapshots set price = price / p_factor, fair_price = fair_price / p_factor where ticker_id = p_ticker_id;
  update public.dividends set per_share = per_share / p_factor where ticker_id = p_ticker_id;
  update public.dividend_payments set shares = shares * p_factor where ticker_id = p_ticker_id;
  update public.offerings
    set shares = shares * p_factor, price = price / p_factor,
        float_before = float_before * p_factor, float_after = float_after * p_factor
    where ticker_id = p_ticker_id;
  update public.buybacks set shares = shares * p_factor, price = price / p_factor where ticker_id = p_ticker_id;

  update public.tickers
    set shares_outstanding = v_new_float,
        split_at = now(),
        splits = splits || jsonb_build_object('at', now(), 'factor', p_factor, 'price', p_price)
    where id = p_ticker_id;

  return v_new_float;
end;
$$;
revoke all on function public.split_ticker(uuid, numeric, numeric) from public;
grant execute on function public.split_ticker(uuid, numeric, numeric) to service_role;
