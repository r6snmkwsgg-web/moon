-- 0010_social_proof — the two things a floor needs to be a floor.
--
-- A listing is a promotion: the company's website goes on the About card
-- beside the founder's X. And a thesis can be liked, by people and by the
-- AI traders, so the good calls float and the tape has a pulse.

alter table public.tickers add column if not exists website text;

-- One row per (what, which, who). `kind` says which table `target_id`
-- points into: a post on the floor, or a trade carrying a note. No foreign
-- key across two tables — the app reads likes only beside the thing they
-- are on, so an orphan is invisible and harmless.
create table if not exists public.thesis_likes (
  kind text not null check (kind in ('post', 'trade')),
  target_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, target_id, user_id)
);

create index if not exists thesis_likes_target on public.thesis_likes (kind, target_id);

alter table public.thesis_likes enable row level security;

create policy "thesis_likes: public read" on public.thesis_likes
  for select using (true);
create policy "thesis_likes: own insert" on public.thesis_likes
  for insert with check (auth.uid() = user_id);
create policy "thesis_likes: own delete" on public.thesis_likes
  for delete using (auth.uid() = user_id);
