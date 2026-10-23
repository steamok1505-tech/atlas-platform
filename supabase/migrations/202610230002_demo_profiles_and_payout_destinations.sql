-- Atlas payout destination + isolated demo profiles/conversations.
-- Demo profiles are synthetic test data, never auth users, and never affect worker earnings.

alter table public.withdrawals
  add column if not exists payout_method text not null default 'Binance Pay ID',
  add column if not exists payout_address text not null default '';

create table if not exists public.demo_profiles (
  id text primary key,
  name text not null,
  email text not null unique,
  is_demo boolean not null default true check (is_demo = true),
  created_at timestamptz not null default now()
);
alter table public.demo_profiles enable row level security;

alter table public.messages drop constraint if exists messages_thread_type_check;
alter table public.messages add constraint messages_thread_type_check
  check (thread_type in ('worker', 'visitor', 'demo'));

insert into public.demo_profiles (id, name, email, is_demo, created_at)
select
  'demo_' || lpad(n::text, 4, '0'),
  'Demo Profile ' || lpad(n::text, 4, '0'),
  'demo.profile.' || lpad(n::text, 4, '0') || '@example.test',
  true,
  now() - (n * interval '1 minute')
from generate_series(1, 400) as gs(n)
on conflict (id) do nothing;

-- One visibly synthetic starter message creates a separate test conversation per profile.
insert into public.messages (thread_type, thread_key, sender_role, sender_name, sender_email, body, created_at)
select 'demo', d.id, 'worker', d.name, d.email,
       'DEMO ONLY: This is a synthetic sample conversation. No real worker sent this message.', d.created_at
from public.demo_profiles d
where not exists (
  select 1 from public.messages m where m.thread_type = 'demo' and m.thread_key = d.id
);

-- Replace the older RPC with a version that atomically reserves the balance and stores the destination.
drop function if exists public.atlas_request_withdrawal(uuid, integer);
create or replace function public.atlas_request_withdrawal(
  p_worker_id uuid,
  p_gross_cents integer,
  p_payout_method text,
  p_payout_address text
)
returns table (id uuid, gross_cents integer, fee_cents integer, net_cents integer, status text)
language plpgsql security definer set search_path = '' as $$
declare
  v_earned integer;
  v_reserved integer;
  v_fee integer;
  v_id uuid;
  v_method text := trim(coalesce(p_payout_method, ''));
  v_address text := trim(coalesce(p_payout_address, ''));
begin
  if p_gross_cents < 5000 or mod(p_gross_cents, 5000) <> 0 then
    raise exception 'Withdrawal requests must be $50 or a multiple of $50.';
  end if;
  if v_method not in ('Binance Pay ID', 'USDT (TRC20)', 'USDT (BEP20)', 'USDT (ERC20)', 'BTC', 'ETH') then
    raise exception 'Choose a supported payout method or network.';
  end if;
  if char_length(v_address) < 5 or char_length(v_address) > 180 then
    raise exception 'Enter a payout destination between 5 and 180 characters.';
  end if;
  perform 1 from public.profiles where public.profiles.id = p_worker_id and public.profiles.role = 'worker' for update;
  if not found then raise exception 'Worker account not found.'; end if;
  select count(*) * 800 into v_earned from public.submissions where worker_id = p_worker_id and status = 'approved';
  select coalesce(sum(public.withdrawals.gross_cents), 0) into v_reserved from public.withdrawals where worker_id = p_worker_id and status in ('pending','paid');
  if p_gross_cents > greatest(0, v_earned - v_reserved) then raise exception 'Requested amount exceeds available balance.'; end if;
  v_fee := (p_gross_cents / 5000) * 1000;
  insert into public.withdrawals(worker_id, gross_cents, fee_cents, net_cents, payout_method, payout_address)
    values (p_worker_id, p_gross_cents, v_fee, p_gross_cents - v_fee, v_method, v_address)
    returning public.withdrawals.id into v_id;
  return query select v_id, p_gross_cents, v_fee, p_gross_cents - v_fee, 'pending'::text;
end;
$$;
revoke all on function public.atlas_request_withdrawal(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.atlas_request_withdrawal(uuid, integer, text, text) to service_role;
