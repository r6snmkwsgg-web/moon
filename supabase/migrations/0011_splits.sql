-- 0011_splits — the float grows with demand and shrinks at the floor.
--
-- A split changes the count, never the value: every holding, every
-- recorded print, every tick and every snapshot is restated in the new
-- unit inside one transaction, so a chart is continuous across it and a
-- position is worth to the cent what it was worth a second before. A
-- reverse split (factor below one) rounds each holding down to whole
-- shares and pays the remainder in cash at the current price, the way a
-- broker does.

alter table public.tickers add column if not exists split_at timestamptz;
alter table public.tickers add column if not exists splits jsonb not null default '[]'::jsonb;

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
  v_new_price numeric;
begin
  if p_factor is null or p_factor <= 0 or p_factor = 1 then
    raise exception 'split factor must be positive and not one';
  end if;

  select shares_outstanding into v_float from public.tickers where id = p_ticker_id for update;
  if v_float is null then
    v_float := 10000;
  end if;
  v_new_float := round(v_float * p_factor);
  v_new_price := p_price / p_factor;

  -- holders: the same value in the new count; a reverse split's fractions are paid out
  if p_factor > 1 then
    update public.holdings
      set shares = shares * p_factor,
          avg_cost = avg_cost / p_factor
      where ticker_id = p_ticker_id;
  else
    update public.profiles p
      set cash = p.cash + round(((h.shares * p_factor) - floor(h.shares * p_factor)) * v_new_price, 2)
      from public.holdings h
      where h.ticker_id = p_ticker_id and h.user_id = p.id;
    update public.holdings
      set shares = floor(shares * p_factor),
          avg_cost = avg_cost / p_factor
      where ticker_id = p_ticker_id;
    delete from public.holdings where ticker_id = p_ticker_id and shares <= 0;
  end if;

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
