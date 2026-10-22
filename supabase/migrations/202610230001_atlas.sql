-- Atlas Supabase schema. Run via Supabase SQL Editor or `supabase db push`.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Atlas Worker',
  email text not null unique,
  role text not null default 'worker' check (role in ('admin','worker')),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  original_name text not null,
  storage_path text not null unique,
  due_date date,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  worker_id uuid not null references public.profiles(id),
  original_name text not null,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists one_open_submission_per_task_worker
  on public.submissions(task_id, worker_id) where status in ('pending','approved');

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id),
  gross_cents integer not null check (gross_cents > 0),
  fee_cents integer not null check (fee_cents >= 0),
  net_cents integer not null check (net_cents >= 0),
  status text not null default 'pending' check (status in ('pending','paid','rejected')),
  admin_note text not null default '',
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  thread_type text not null check (thread_type in ('worker','visitor')),
  thread_key text not null,
  sender_role text not null check (sender_role in ('worker','visitor','admin')),
  sender_name text not null,
  sender_email text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_idx on public.messages(thread_type, thread_key, id);

-- Automatically create a worker profile after Supabase Auth sign-up.
create or replace function public.atlas_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Atlas Worker'),
    lower(new.email),
    'worker'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists atlas_auth_user_created on auth.users;
create trigger atlas_auth_user_created
after insert on auth.users for each row execute procedure public.atlas_create_profile();

-- Private bucket. Files are uploaded directly from the browser to avoid Edge Function upload-size limits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atlas-pdfs', 'atlas-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];

-- Keep database tables inaccessible from the public browser key. The Edge Function uses the server-only secret key.
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.messages enable row level security;

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile" on public.profiles
for select to authenticated using (id = auth.uid());

drop policy if exists "admin uploads source PDFs" on storage.objects;
create policy "admin uploads source PDFs" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'atlas-pdfs'
  and (storage.foldername(name))[1] = 'tasks'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "workers upload own submissions" on storage.objects;
create policy "workers upload own submissions" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'atlas-pdfs'
  and (storage.foldername(name))[1] = 'submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'worker')
);

-- After registering your own account, promote only that account to admin in SQL Editor:
-- update public.profiles set role = 'admin' where email = 'YOUR-ADMIN-EMAIL';

-- Atomic balance check + withdrawal reservation prevents concurrent requests overspending a balance.
create or replace function public.atlas_request_withdrawal(p_worker_id uuid, p_gross_cents integer)
returns table (id uuid, gross_cents integer, fee_cents integer, net_cents integer, status text)
language plpgsql security definer set search_path = '' as $$
declare
  v_earned integer;
  v_reserved integer;
  v_fee integer;
  v_id uuid;
begin
  if p_gross_cents < 5000 or mod(p_gross_cents, 5000) <> 0 then
    raise exception 'Withdrawal requests must be $50 or a multiple of $50.';
  end if;
  perform 1 from public.profiles where public.profiles.id = p_worker_id and public.profiles.role = 'worker' for update;
  if not found then raise exception 'Worker account not found.'; end if;
  select count(*) * 800 into v_earned from public.submissions where worker_id = p_worker_id and status = 'approved';
  select coalesce(sum(public.withdrawals.gross_cents), 0) into v_reserved from public.withdrawals where worker_id = p_worker_id and status in ('pending','paid');
  if p_gross_cents > greatest(0, v_earned - v_reserved) then raise exception 'Requested amount exceeds available balance.'; end if;
  v_fee := (p_gross_cents / 5000) * 1000;
  insert into public.withdrawals(worker_id, gross_cents, fee_cents, net_cents)
    values (p_worker_id, p_gross_cents, v_fee, p_gross_cents - v_fee) returning public.withdrawals.id into v_id;
  return query select v_id, p_gross_cents, v_fee, p_gross_cents - v_fee, 'pending'::text;
end;
$$;
revoke all on function public.atlas_request_withdrawal(uuid, integer) from public, anon, authenticated;
grant execute on function public.atlas_request_withdrawal(uuid, integer) to service_role;
