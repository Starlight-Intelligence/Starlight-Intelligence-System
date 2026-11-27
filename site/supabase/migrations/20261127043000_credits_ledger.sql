-- Credits ledger for the Starlight site and Desk.
--
-- DISABLED BY DEFAULT twice over: the site checks CREDITS_ENABLED, and the
-- database kill switch (public.credit_controls.enabled) starts false. With the
-- switch off, reserve_credits and grant_from_stripe_event raise; commit and
-- release still work so open holds can always be settled.
--
-- Invariants enforced here, not in application code:
--   * credit_accounts.balance >= 0 (CHECK), and every mutation locks the
--     account row (FOR UPDATE) before reading the balance.
--   * credit_ledger is append-only: UPDATE, DELETE and TRUNCATE raise.
--   * Each Stripe event id grants at most once (stripe_events primary key).
--   * Each (user_id, idempotency_key) holds at most once.
--   * Clients (anon, authenticated) can only SELECT their own rows. Every
--     mutation goes through a SECURITY DEFINER function executable by
--     service_role only.
--   * There is no function that refunds, pays out, or transfers credits
--     between accounts.
--
-- Built on SIP — operational tier.

begin;

-- One row. The database-side kill switch.
create table if not exists public.credit_controls (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);
insert into public.credit_controls (id, enabled) values (true, false) on conflict (id) do nothing;

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete restrict,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]{8,255}$'),
  event_type text not null,
  user_id uuid not null references public.credit_accounts (user_id) on delete restrict,
  pack_id text not null,
  credits bigint not null check (credits > 0),
  livemode boolean not null,
  received_at timestamptz not null default now()
);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.credit_accounts (user_id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  amount bigint not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'committed', 'released')),
  charged bigint check (charged is null or (charged >= 0 and charged <= amount)),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, idempotency_key),
  check ((status = 'open') = (settled_at is null)),
  check ((status = 'committed') = (charged is not null))
);
create index if not exists credit_reservations_open_idx on public.credit_reservations (created_at) where status = 'open';

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.credit_accounts (user_id) on delete restrict,
  kind text not null check (kind in ('grant', 'reserve', 'reservation_refund')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reservation_id uuid references public.credit_reservations (id) on delete restrict,
  stripe_event_id text references public.stripe_events (event_id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (kind = 'grant' and amount > 0 and stripe_event_id is not null and reservation_id is null)
    or (kind = 'reserve' and amount < 0 and reservation_id is not null and stripe_event_id is null)
    or (kind = 'reservation_refund' and amount > 0 and reservation_id is not null and stripe_event_id is null)
  )
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, id);
create unique index if not exists credit_ledger_one_grant_per_event on public.credit_ledger (stripe_event_id) where stripe_event_id is not null;

comment on table public.credit_ledger is 'Append-only credit ledger. Written only by SECURITY DEFINER functions; UPDATE/DELETE/TRUNCATE are blocked by trigger.';

-- Append-only enforcement.
create or replace function public.credit_ledger_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$;

drop trigger if exists credit_ledger_no_update_delete on public.credit_ledger;
create trigger credit_ledger_no_update_delete
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_block_mutation();

drop trigger if exists credit_ledger_no_truncate on public.credit_ledger;
create trigger credit_ledger_no_truncate
  before truncate on public.credit_ledger
  for each statement execute function public.credit_ledger_block_mutation();

-- Row level security: users read only their own rows; nobody writes directly.
alter table public.credit_controls enable row level security;
alter table public.credit_controls force row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_accounts force row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_ledger force row level security;
alter table public.credit_reservations enable row level security;
alter table public.credit_reservations force row level security;
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;

revoke all on table public.credit_controls, public.credit_accounts, public.credit_ledger, public.credit_reservations, public.stripe_events from public, anon, authenticated;
grant select on table public.credit_accounts, public.credit_ledger, public.credit_reservations to authenticated;
grant select on table public.credit_controls, public.credit_accounts, public.credit_ledger, public.credit_reservations, public.stripe_events to service_role;

drop policy if exists credit_accounts_read_own on public.credit_accounts;
create policy credit_accounts_read_own on public.credit_accounts for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists credit_ledger_read_own on public.credit_ledger;
create policy credit_ledger_read_own on public.credit_ledger for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists credit_reservations_read_own on public.credit_reservations;
create policy credit_reservations_read_own on public.credit_reservations for select to authenticated using (user_id = (select auth.uid()));
-- service_role bypasses RLS; stripe_events and credit_controls have no client policy at all.

-- Helpers -------------------------------------------------------------------

create or replace function public.credits_switched_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.credit_controls where id), false);
$$;

create or replace function public.get_credit_balance(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select balance from public.credit_accounts where user_id = p_user_id), 0);
$$;

-- Mutations -----------------------------------------------------------------

create or replace function public.reserve_credits(p_user_id uuid, p_amount bigint, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_existing public.credit_reservations%rowtype;
  v_id uuid;
begin
  if not public.credits_switched_on() then raise exception 'credits are switched off'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'reservation amount must be positive'; end if;

  select balance into v_balance from public.credit_accounts where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reservation_id', null, 'amount', p_amount, 'balance', 0);
  end if;

  select * into v_existing from public.credit_reservations where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> p_amount then raise exception 'idempotency key already holds a different amount'; end if;
    return jsonb_build_object('ok', true, 'reservation_id', v_existing.id, 'amount', v_existing.amount, 'balance', v_balance);
  end if;

  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'reservation_id', null, 'amount', p_amount, 'balance', v_balance);
  end if;

  insert into public.credit_reservations (user_id, idempotency_key, amount)
  values (p_user_id, p_idempotency_key, p_amount)
  returning id into v_id;

  v_balance := v_balance - p_amount;
  update public.credit_accounts set balance = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.credit_ledger (user_id, kind, amount, balance_after, reservation_id)
  values (p_user_id, 'reserve', -p_amount, v_balance, v_id);

  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'amount', p_amount, 'balance', v_balance);
end;
$$;

create or replace function public.commit_reservation(p_reservation_id uuid, p_actual bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.credit_reservations%rowtype;
  v_balance bigint;
  v_refund bigint;
begin
  if p_actual is null or p_actual < 0 then raise exception 'actual spend must be zero or more'; end if;

  select * into v_res from public.credit_reservations where id = p_reservation_id;
  if not found then raise exception 'no such reservation'; end if;
  -- Lock the account first, then re-read the reservation, in the same order every function uses.
  select balance into v_balance from public.credit_accounts where user_id = v_res.user_id for update;
  select * into v_res from public.credit_reservations where id = p_reservation_id for update;

  if v_res.status = 'committed' and v_res.charged = p_actual then
    return jsonb_build_object('charged', p_actual, 'refunded', v_res.amount - p_actual, 'balance', v_balance);
  end if;
  if v_res.status <> 'open' then raise exception 'reservation already settled'; end if;
  if p_actual > v_res.amount then raise exception 'actual spend exceeds the reservation'; end if;

  v_refund := v_res.amount - p_actual;
  if v_refund > 0 then
    v_balance := v_balance + v_refund;
    update public.credit_accounts set balance = v_balance, updated_at = now() where user_id = v_res.user_id;
    insert into public.credit_ledger (user_id, kind, amount, balance_after, reservation_id)
    values (v_res.user_id, 'reservation_refund', v_refund, v_balance, v_res.id);
  end if;
  update public.credit_reservations set status = 'committed', charged = p_actual, settled_at = now() where id = v_res.id;

  return jsonb_build_object('charged', p_actual, 'refunded', v_refund, 'balance', v_balance);
end;
$$;

create or replace function public.release_reservation(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.credit_reservations%rowtype;
  v_balance bigint;
begin
  select * into v_res from public.credit_reservations where id = p_reservation_id;
  if not found then raise exception 'no such reservation'; end if;
  select balance into v_balance from public.credit_accounts where user_id = v_res.user_id for update;
  select * into v_res from public.credit_reservations where id = p_reservation_id for update;

  if v_res.status = 'released' then
    return jsonb_build_object('released', v_res.amount, 'balance', v_balance);
  end if;
  if v_res.status <> 'open' then raise exception 'reservation already settled'; end if;

  v_balance := v_balance + v_res.amount;
  update public.credit_accounts set balance = v_balance, updated_at = now() where user_id = v_res.user_id;
  insert into public.credit_ledger (user_id, kind, amount, balance_after, reservation_id)
  values (v_res.user_id, 'reservation_refund', v_res.amount, v_balance, v_res.id);
  update public.credit_reservations set status = 'released', settled_at = now() where id = v_res.id;

  return jsonb_build_object('released', v_res.amount, 'balance', v_balance);
end;
$$;

-- Called only by the site's Stripe webhook after it verified the signature,
-- the event type, the paid status, and the pack's server-side amount.
create or replace function public.grant_from_stripe_event(
  p_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_credits bigint,
  p_pack_id text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_inserted text;
begin
  if not public.credits_switched_on() then raise exception 'credits are switched off'; end if;
  if p_event_type <> 'checkout.session.completed' then raise exception 'only checkout.session.completed grants credits'; end if;
  if p_credits is null or p_credits <= 0 then raise exception 'grant must be positive'; end if;

  insert into public.credit_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select balance into v_balance from public.credit_accounts where user_id = p_user_id for update;

  insert into public.stripe_events (event_id, event_type, user_id, pack_id, credits, livemode)
  values (p_event_id, p_event_type, p_user_id, p_pack_id, p_credits, p_livemode)
  on conflict (event_id) do nothing
  returning event_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('granted', false, 'duplicate', true, 'balance', v_balance);
  end if;

  v_balance := v_balance + p_credits;
  update public.credit_accounts set balance = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.credit_ledger (user_id, kind, amount, balance_after, stripe_event_id)
  values (p_user_id, 'grant', p_credits, v_balance, p_event_id);

  return jsonb_build_object('granted', true, 'duplicate', false, 'balance', v_balance);
end;
$$;

-- Only the server (service_role) may call any of these.
revoke all on function public.credits_switched_on() from public, anon, authenticated;
revoke all on function public.get_credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.reserve_credits(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.commit_reservation(uuid, bigint) from public, anon, authenticated;
revoke all on function public.release_reservation(uuid) from public, anon, authenticated;
revoke all on function public.grant_from_stripe_event(text, text, uuid, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.credit_ledger_block_mutation() from public, anon, authenticated;

grant execute on function public.credits_switched_on() to service_role;
grant execute on function public.get_credit_balance(uuid) to service_role;
grant execute on function public.reserve_credits(uuid, bigint, text) to service_role;
grant execute on function public.commit_reservation(uuid, bigint) to service_role;
grant execute on function public.release_reservation(uuid) to service_role;
grant execute on function public.grant_from_stripe_event(text, text, uuid, bigint, text, boolean) to service_role;

commit;
