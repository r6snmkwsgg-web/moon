-- 0013_fractional_shares — a share can be bought in pieces.
--
-- Shares were already stored as numerics; the ledger simply refused any
-- order that was not a whole number. Now an order is any positive amount,
-- kept to four decimal places, and it has to be worth at least a cent so
-- that rounding the total cannot hand out free stock. A reverse split
-- keeps the fractions too, instead of flooring them and paying the rest out.

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
  v_shares_in numeric := round(p_shares, 4);
  v_total numeric := round(round(p_shares, 4) * p_price, 2);
  v_cash numeric;
  v_shares numeric;
  v_avg numeric;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'invalid side';
  end if;
  if p_shares is null or v_shares_in <= 0 then
    raise exception 'shares must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid price';
  end if;
  if v_total < 0.01 then
    raise exception 'order too small';
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
      p_user_id, p_ticker_id, v_shares_in,
      p_price
    )
    on conflict (user_id, ticker_id) do update set
      avg_cost = (public.holdings.shares * public.holdings.avg_cost + excluded.shares * p_price)
                 / (public.holdings.shares + excluded.shares),
      shares = public.holdings.shares + excluded.shares;
  else
    -- a sell of everything you hold, to the fourth decimal, is a sell of everything
    if v_shares < v_shares_in then
      if v_shares >= v_shares_in - 0.0001 then
        v_shares_in := v_shares;
      else
        raise exception 'insufficient shares';
      end if;
    end if;
    update public.profiles set cash = cash + v_total where id = p_user_id;
    update public.holdings
      set shares = shares - v_shares_in
      where user_id = p_user_id and ticker_id = p_ticker_id;
    delete from public.holdings
      where user_id = p_user_id and ticker_id = p_ticker_id and shares <= 0.00005;
  end if;

  insert into public.trades (user_id, ticker_id, side, shares, price, total)
  values (p_user_id, p_ticker_id, p_side, v_shares_in, p_price, v_total);

  update public.tickers
    set sentiment = greatest(-6, least(4, p_new_sentiment))
    where id = p_ticker_id;

  select cash into v_cash from public.profiles where id = p_user_id;
  return jsonb_build_object('cash', v_cash);
end;
$$;

revoke execute on function public.execute_trade from public, anon, authenticated;
grant execute on function public.execute_trade to service_role;

-- a reverse split keeps every fraction now that a fraction can be held
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
