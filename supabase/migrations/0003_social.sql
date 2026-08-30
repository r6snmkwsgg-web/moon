-- SAAS EXCHANGE — social core.
-- Adds: public trade rationales, ticker discussions, follows.
-- Run AFTER 0002_market_depth.sql (paste into the Supabase SQL editor).

-- ─────────────────── trades: the optional public "why" ──────────────────────
alter table public.trades
  add column if not exists note text
    check (note is null or char_length(note) <= 140);

-- ───────────────────── posts: ticker discussion threads ─────────────────────
-- Short takes pinned to a ticker, tagged bullish/bearish. The poster's REAL
-- position is joined live from holdings at render time — never stored, so it
-- can't go stale or be faked.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  ticker_id uuid not null references public.tickers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  stance smallint check (stance in (-1, 1)), -- null = no call
  created_at timestamptz not null default now()
);

create index if not exists posts_ticker_created
  on public.posts (ticker_id, created_at desc);

alter table public.posts enable row level security;

create policy "posts: public read" on public.posts
  for select using (true);
create policy "posts: own insert" on public.posts
  for insert with check (auth.uid() = user_id);
create policy "posts: own delete" on public.posts
  for delete using (auth.uid() = user_id);

-- ──────────────────────────────── follows ───────────────────────────────────
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee on public.follows (followee_id);

alter table public.follows enable row level security;

create policy "follows: public read" on public.follows
  for select using (true);
create policy "follows: own insert" on public.follows
  for insert with check (auth.uid() = follower_id);
create policy "follows: own delete" on public.follows
  for delete using (auth.uid() = follower_id);
