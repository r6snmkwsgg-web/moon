-- 0006 — Stripe Connect (OAuth), alongside the restricted-key path.
--
-- Pasting a restricted key works, but it asks a founder to leave the site,
-- create a credential, and paste it into a stranger's form — seven steps and
-- a scary one. OAuth is three: click, approve on Stripe's own consent screen,
-- come back.
--
-- The two paths stay side by side on purpose. OAuth's read_only scope covers
-- the WHOLE connected account, while a restricted key can be pinned to exactly
-- Subscriptions + Invoices read, so a careful founder can reasonably prefer
-- the narrower one. Easy by default, narrow if you want it.
--
-- The security shape differs too. A key connection stores someone else's
-- credential encrypted at rest; an OAuth connection stores only an acct_ id
-- and reads through the platform's own key, so there is no third-party secret
-- to leak.

alter table public.stripe_connections
  add column if not exists method text not null default 'key';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stripe_connections_method_check'
  ) then
    alter table public.stripe_connections
      add constraint stripe_connections_method_check
      check (method in ('key', 'oauth'));
  end if;
end $$;

-- The connected account, for method = 'oauth'. Not a secret: it identifies an
-- account, it does not grant access to one — reads go through the platform key.
alter table public.stripe_connections
  add column if not exists stripe_account_id text;
alter table public.stripe_connections
  add column if not exists connect_scope text;

-- An OAuth connection has no key to store, so these stop being required.
alter table public.stripe_connections alter column encrypted_key drop not null;
alter table public.stripe_connections alter column key_last4 drop not null;

-- Whichever path was used, a connection must carry the thing it reads with.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stripe_connections_credential_check'
  ) then
    alter table public.stripe_connections
      add constraint stripe_connections_credential_check
      check (
        (method = 'key'   and encrypted_key is not null)
        or
        (method = 'oauth' and stripe_account_id is not null)
      );
  end if;
end $$;

-- One Stripe account cannot back two tickers.
create unique index if not exists stripe_connections_account_idx
  on public.stripe_connections (stripe_account_id)
  where stripe_account_id is not null;

comment on column public.stripe_connections.method is
  'How revenue is read: ''key'' = founder-pasted restricted key (encrypted here), ''oauth'' = Stripe Connect, read through the platform key with a Stripe-Account header.';
