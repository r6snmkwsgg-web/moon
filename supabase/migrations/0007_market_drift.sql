-- 0007 — the drift: the weather stops being a formula and becomes a record.
--
-- Until now the volatility between real events came from marketFlow(), a pure
-- function of (symbol, time). That function ships to the browser — every page
-- that renders a live price imports lib/pricing — so anyone could open a
-- console and evaluate it at Date.now() + 86400000 to read tomorrow's price
-- today, then buy every trough and sell every peak. Making the function more
-- elaborate would not have helped: the attack was never to reverse-engineer
-- it, only to CALL it.
--
-- So the weather is no longer computed. It is WRITTEN, by the five-minute
-- poller, one tick at a time, from server-side entropy. There is nothing to
-- precompute because the next value does not exist until the cron creates it.
--
--   drift_state — the current level, denormalised onto tickers so every board
--                 and quote read gets it for free.
--   flow_ticks  — the recorded walk, so charts can still redraw the past
--                 exactly as it happened.
--
-- Facts stay facts: MRR, trades and revenue events are still never fabricated.
-- Only the weather is simulated, and now it is simulated once, in public,
-- and kept.

-- ── the walk's current state, on the ticker row ─────────────────────────────
alter table public.tickers
  add column if not exists drift numeric not null default 0;
alter table public.tickers
  add column if not exists vol_state numeric not null default 0;
alter table public.tickers
  add column if not exists drift_at timestamptz;

comment on column public.tickers.drift is
  'Current simulated deviation from the sentiment-adjusted price, as a signed fraction. Advanced by the five-minute poller from real entropy — never derived from time.';
comment on column public.tickers.vol_state is
  'Log-volatility state of the drift walk. A slow second walk, so quiet stretches and violent ones cluster the way they do in real tapes.';
comment on column public.tickers.drift_at is
  'When the drift was last advanced. The poller skips tickers stepped within the interval, so a client nudge cannot spin the walk faster than the clock.';

-- Start the walk somewhere plausible rather than at dead-flat fair value.
-- Without this, the deploy that switches the weather from a formula to a
-- record snaps every price to its anchor at once — a market-wide jolt for no
-- reason anyone could read. Four uniforms summed is a decent normal
-- (sd ~ 0.18, matching the walk's own stationary spread), and these draws are
-- the database's: written once, never recomputed.
update public.tickers
set drift = greatest(-0.55, least(0.55,
      (random() + random() + random() + random() - 2) * 0.31)),
    vol_state = (random() - 0.5) * 0.6
where drift = 0 and drift_at is null;
-- drift_at stays null on purpose: the first poller run then owes one tick.

-- ── the recorded walk ───────────────────────────────────────────────────────
create table if not exists public.flow_ticks (
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  at timestamptz not null,
  drift numeric not null,
  -- the settled price at that instant, stored rather than reconstructed: a
  -- chart drawn a month from now must show what the tape actually did, not
  -- what today's sentiment and multiple would imply it did.
  price numeric not null check (price >= 0),
  primary key (ticker_id, at)
);

create index if not exists flow_ticks_ticker_at_idx
  on public.flow_ticks (ticker_id, at desc);

alter table public.flow_ticks enable row level security;

drop policy if exists "flow ticks are public" on public.flow_ticks;
create policy "flow ticks are public"
  on public.flow_ticks for select
  using (true);
-- no insert/update/delete policy: only the service role (the poller) writes.

-- ── sentiment moved to log space in the app; the schema never followed ──────
--
-- lib/pricing.ts prices at fair × e^sentiment and clamps to [-6, 4], but this
-- table still refused anything outside ±0.4 and execute_trade clamped to the
-- same band before writing. The whole log-space change was therefore inert in
-- production: every trade's sentiment was silently squashed back to ±0.4.
alter table public.tickers
  drop constraint if exists tickers_sentiment_check;
alter table public.tickers
  add constraint tickers_sentiment_check check (sentiment between -6 and 4);

comment on column public.tickers.sentiment is
  'Log-space hype: price = fair x exp(sentiment). Clamped to [-6, 4] — no floor worth the name, so a crash can keep going.';

-- execute_trade only needs its clamp widened to match; everything else in the
-- function is unchanged (the price and the new sentiment are still computed in
-- lib/pricing.ts and passed in).
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
    set sentiment = greatest(-6, least(4, p_new_sentiment))
    where id = p_ticker_id;

  select cash into v_cash from public.profiles where id = p_user_id;
  return jsonb_build_object('cash', v_cash);
end;
$$;

revoke execute on function public.execute_trade from public, anon, authenticated;
grant execute on function public.execute_trade to service_role;

-- price_snapshots.sentiment is a historical record, not a live value — it has
-- no check constraint, so log-space numbers land there fine.
