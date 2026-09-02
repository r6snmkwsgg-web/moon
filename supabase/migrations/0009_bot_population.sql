-- 0009_bot_population.sql — the AI traders as a population, not a list.
--
-- Twelve bots were a roster in code. A thousand are rows: each is an
-- ordinary account (the signup trigger provisions its profile like anyone's)
-- flagged as a bot and carrying its persona — style mix, stake, activity,
-- holding habit, voice, who it follows — so the five-minute round, the tape,
-- the holders table and the leaderboard all read the same fact.
--
-- Idempotent. Run in the Supabase SQL editor, then `npx tsx scripts/seed-bots.ts`.

alter table public.profiles
  add column if not exists is_bot boolean not null default false;

alter table public.profiles
  add column if not exists persona jsonb;

-- the round asks "every bot" once per five minutes; a partial index keeps
-- that a short scan however many people sign up
create index if not exists profiles_is_bot_idx
  on public.profiles (is_bot) where is_bot;
