-- 0014_batch_fills — a whole round of orders on one ticker, in one trip.
--
-- Every AI trade used to go through execute_trade one at a time, and each
-- one carried about six round trips of its own: read the ticker, read the
-- revenue record, the holdings, the Stripe connection, the events, the
-- takings, then claim the curve and write the ledger. Forty trades cost
-- roughly two hundred and forty round trips and twenty-four seconds, which
-- is why the market could never print more than forty trades in five
-- minutes however many traders were awake.
--
-- The round already holds all of that. It prices every order itself, walking
-- the same curve, and hands the finished list to this function: one call per
-- ticker, one transaction, one lock.
--
-- An order that the ledger refuses (a bot that spent its cash in an earlier
-- order this round, a position sold out from under it) is SKIPPED rather
-- than aborting its neighbours, and comes back in the result so the caller
-- can count it. The curve only moves by what actually filled.

create or replace function public.execute_trades_batch(
  p_ticker_id uuid,
  p_orders jsonb,             -- [{user_id, side, shares, price, total, note}]
  p_sentiment_start numeric,  -- what the caller priced against
  p_impact_factor numeric,    -- lib/pricing TRADE_IMPACT_FACTOR
  p_float numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order jsonb;
  v_user uuid;
  v_side text;
  v_shares numeric;
  v_price numeric;
  v_total numeric;
  v_note text;
  v_cash numeric;
  v_held numeric;
  v_sentiment numeric;
  v_delta numeric := 0;
  v_filled int := 0;
  v_skipped int := 0;
  v_reasons jsonb := '[]'::jsonb;
begin
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    raise exception 'orders must be an array';
  end if;
  if p_float is null or p_float <= 0 then
    raise exception 'invalid float';
  end if;

  -- Lock the ticker for the length of the batch, then check the curve has
  -- not moved since the caller priced against it. A human trading the same
  -- name in the same instant is the case this guards: their fill lands
  -- first and this batch re-prices rather than overwriting them.
  select sentiment into v_sentiment from public.tickers
    where id = p_ticker_id for update;
  if v_sentiment is null then
    raise exception 'unknown ticker';
  end if;
  if abs(v_sentiment - p_sentiment_start) > 0.000001 then
    return jsonb_build_object('moved', true, 'sentiment', v_sentiment);
  end if;

  for v_order in select * from jsonb_array_elements(p_orders)
  loop
    v_user := (v_order->>'user_id')::uuid;
    v_side := v_order->>'side';
    v_shares := round((v_order->>'shares')::numeric, 4);
    v_price := (v_order->>'price')::numeric;
    v_total := round(v_shares * v_price, 2);
    v_note := nullif(v_order->>'note', '');

    if v_side not in ('buy','sell') or v_shares <= 0 or v_price <= 0 or v_total < 0.01 then
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_object('user_id', v_user, 'why', 'invalid');
      continue;
    end if;

    select cash into v_cash from public.profiles where id = v_user for update;
    if v_cash is null then
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_object('user_id', v_user, 'why', 'no profile');
      continue;
    end if;

    select shares into v_held from public.holdings
      where user_id = v_user and ticker_id = p_ticker_id for update;
    v_held := coalesce(v_held, 0);

    if v_side = 'buy' then
      if v_cash < v_total then
        v_skipped := v_skipped + 1;
        v_reasons := v_reasons || jsonb_build_object('user_id', v_user, 'why', 'cash');
        continue;
      end if;
      update public.profiles set cash = cash - v_total where id = v_user;
      insert into public.holdings (user_id, ticker_id, shares, avg_cost)
      values (v_user, p_ticker_id, v_shares, v_price)
      on conflict (user_id, ticker_id) do update set
        avg_cost = (public.holdings.shares * public.holdings.avg_cost + excluded.shares * v_price)
                   / (public.holdings.shares + excluded.shares),
        shares = public.holdings.shares + excluded.shares;
    else
      -- a sell of everything you hold, to the fourth decimal, is a sell of everything
      if v_held < v_shares then
        if v_held >= v_shares - 0.0001 then
          v_shares := v_held;
          v_total := round(v_shares * v_price, 2);
        else
          v_skipped := v_skipped + 1;
          v_reasons := v_reasons || jsonb_build_object('user_id', v_user, 'why', 'shares');
          continue;
        end if;
      end if;
      if v_shares <= 0 or v_total < 0.01 then
        v_skipped := v_skipped + 1;
        v_reasons := v_reasons || jsonb_build_object('user_id', v_user, 'why', 'dust');
        continue;
      end if;
      update public.profiles set cash = cash + v_total where id = v_user;
      update public.holdings set shares = shares - v_shares
        where user_id = v_user and ticker_id = p_ticker_id;
      delete from public.holdings
        where user_id = v_user and ticker_id = p_ticker_id and shares <= 0.00005;
    end if;

    insert into public.trades (user_id, ticker_id, side, shares, price, total, note)
    values (v_user, p_ticker_id, v_side, v_shares, v_price, v_total, v_note);

    -- pressure accumulates in log space, exactly as lib/pricing applyTrade
    v_delta := v_delta + (case when v_side = 'buy' then 1 else -1 end)
                       * (v_shares / p_float) * p_impact_factor;
    v_filled := v_filled + 1;
  end loop;

  update public.tickers
    set sentiment = greatest(-6, least(4, v_sentiment + v_delta))
    where id = p_ticker_id;

  return jsonb_build_object(
    'moved', false,
    'filled', v_filled,
    'skipped', v_skipped,
    'reasons', v_reasons,
    'sentiment', greatest(-6, least(4, v_sentiment + v_delta))
  );
end;
$$;

revoke execute on function public.execute_trades_batch(uuid, jsonb, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.execute_trades_batch(uuid, jsonb, numeric, numeric, numeric) to service_role;

-- The tape is about to get fifty times busier, so it needs an index that
-- answers "the newest N prints on this ticker" without touching the rest,
-- and one for a trader's own history.
create index if not exists trades_ticker_created_idx
  on public.trades (ticker_id, created_at desc);
create index if not exists trades_user_created_idx
  on public.trades (user_id, created_at desc);
-- the floor's theses tab reads only the prints that carry one
create index if not exists trades_ticker_noted_idx
  on public.trades (ticker_id, created_at desc)
  where note is not null;
