-- SAAS EXCHANGE — market depth update.
-- Adds: self-serve listing w/ Stripe-verified MRR, watchlists, in-app
-- notifications, bull/bear votes, portfolio history, invites, fixture flags.
-- Run AFTER 0001_init.sql (paste into the Supabase SQL editor).

-- ───────────────────────── tickers: badges & provenance ─────────────────────
alter table public.tickers
  add column if not exists fixture boolean not null default false,
  add column if not exists stripe_verified boolean not null default false,
  add column if not exists handle_verified boolean not null default false,
  add column if not exists handle_proof_url text,
  add column if not exists listed_by uuid references auth.users (id) on delete set null;

-- Mark the demo seed tickers so they can be purged in one click.
update public.tickers set fixture = true where symbol in
  ('PRLA','SNDR','KWST','FRMO','CHRN','PLSE','TSTM','INBX','SCRP','DOCK',
   'VOCL','LNCH','BLLW','NTFY','GRDN','SNPT','MTRC','CLDR','PXLL','ZNBD');

-- MRR can now also come straight from Stripe.
alter table public.mrr_updates drop constraint if exists mrr_updates_source_check;
alter table public.mrr_updates add constraint mrr_updates_source_check
  check (source in ('self-reported', 'curated', 'stripe'));

-- ───────────────────────── profiles: usernames & invites ────────────────────
alter table public.profiles
  add column if not exists username text,
  add column if not exists invite_code text,
  add column if not exists invited_by uuid references public.profiles (id) on delete set null;

update public.profiles set
  username = coalesce(
    username,
    nullif(lower(regexp_replace(display_name, '[^a-zA-Z0-9]', '', 'g')), '')
      || '-' || substr(md5(id::text), 1, 4)
  ),
  invite_code = coalesce(invite_code, substr(md5(id::text || ':invite'), 1, 8));

update public.profiles
  set username = 'trader-' || substr(md5(id::text), 1, 4)
  where username is null or username like '-%';

alter table public.profiles alter column username set not null;
alter table public.profiles alter column invite_code set not null;
create unique index if not exists profiles_username_key on public.profiles (username);
create unique index if not exists profiles_invite_code_key on public.profiles (invite_code);

-- Signup trigger now also assigns username + invite code.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
begin
  v_base := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-zA-Z0-9]', '', 'g'));
  if v_base is null or v_base = '' then
    v_base := 'trader';
  end if;
  insert into public.profiles (id, display_name, username, invite_code)
  values (
    new.id,
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'trader'),
    v_base || '-' || substr(md5(new.id::text), 1, 4),
    substr(md5(new.id::text || ':invite'), 1, 8)
  );
  return new;
end;
$$;

-- ─────────────── stripe_connections (service-role only, RLS deny-all) ───────
-- Holds the founder's RESTRICTED (read-only) key, AES-256-GCM encrypted
-- app-side. No policies on purpose: only the service role touches this table.
create table if not exists public.stripe_connections (
  ticker_id uuid primary key references public.tickers (id) on delete cascade,
  encrypted_key text not null,
  key_last4 text not null,
  livemode boolean not null default true,
  connected_by uuid not null references public.profiles (id) on delete cascade,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_mrr numeric,
  status text not null default 'active' check (status in ('active', 'error'))
);
alter table public.stripe_connections enable row level security;

-- ───────────────────────────── watchlists ───────────────────────────────────
create table if not exists public.watchlists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ticker_id)
);
alter table public.watchlists enable row level security;
create policy "watchlists: read own" on public.watchlists
  for select using (auth.uid() = user_id);
create policy "watchlists: add own" on public.watchlists
  for insert with check (auth.uid() = user_id);
create policy "watchlists: remove own" on public.watchlists
  for delete using (auth.uid() = user_id);

-- ─────────────────────────── notifications ──────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker_id uuid references public.tickers (id) on delete cascade,
  kind text not null check (kind in ('mrr', 'move', 'invite', 'system')),
  title text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, read, created_at desc);
alter table public.notifications enable row level security;
create policy "notifications: read own" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notifications: mark own read" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────── ticker_votes ───────────────────────────────────
create table if not exists public.ticker_votes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker_id)
);
alter table public.ticker_votes enable row level security;
create policy "votes: read own" on public.ticker_votes
  for select using (auth.uid() = user_id);
create policy "votes: cast own" on public.ticker_votes
  for insert with check (auth.uid() = user_id);
create policy "votes: change own" on public.ticker_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ───────────────────────── portfolio_snapshots ──────────────────────────────
create table if not exists public.portfolio_snapshots (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  total_value numeric not null,
  cash numeric not null,
  holdings_value numeric not null,
  primary key (user_id, day)
);
alter table public.portfolio_snapshots enable row level security;
create policy "portfolio_snapshots: read own" on public.portfolio_snapshots
  for select using (auth.uid() = user_id);
