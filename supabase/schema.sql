-- PromptInvoice — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
--
-- Model: one workspace ("company") per email domain. Anyone who signs in with an
-- address at that domain shares the company's businesses, clients and invoices.
-- Public mail providers (gmail.com, outlook.com, …) get a private workspace keyed
-- by the full email address instead, so strangers never share data.

-- ---------------------------------------------------------------- helpers

create or replace function public.pi_is_public_domain(d text)
returns boolean
language sql
immutable
as $$
  select lower(d) = any (array[
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.co.nz','yahoo.com.au','ymail.com',
    'outlook.com','hotmail.com','hotmail.co.uk','live.com','msn.com','icloud.com','me.com','mac.com',
    'aol.com','protonmail.com','proton.me','pm.me','zoho.com','gmx.com','gmx.de','mail.com',
    'yandex.com','yandex.ru','fastmail.com','hey.com','tutanota.com','tuta.io','qq.com','163.com','126.com',
    'xtra.co.nz','rediffmail.com'
  ]);
$$;

-- The workspace key for the calling user: their email domain, or the full email
-- for public providers.
create or replace function public.pi_user_key()
returns text
language sql
stable
as $$
  select case
    when coalesce(auth.jwt() ->> 'email', '') = '' then ''
    when public.pi_is_public_domain(split_part(lower(auth.jwt() ->> 'email'), '@', 2))
      then lower(auth.jwt() ->> 'email')
    else split_part(lower(auth.jwt() ->> 'email'), '@', 2)
  end;
$$;

-- ---------------------------------------------------------------- companies

create table if not exists public.pi_companies (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- domain, or email for public providers
  name        text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.pi_companies enable row level security;

drop policy if exists "members can read their company" on public.pi_companies;
create policy "members can read their company"
  on public.pi_companies for select to authenticated
  using (key = public.pi_user_key());

drop policy if exists "members can rename their company" on public.pi_companies;
create policy "members can rename their company"
  on public.pi_companies for update to authenticated
  using (key = public.pi_user_key())
  with check (key = public.pi_user_key());

create or replace function public.pi_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.pi_companies where key = public.pi_user_key();
$$;

-- Claim (or join) the caller's company. Called by the app right after sign-in.
create or replace function public.pi_ensure_company()
returns public.pi_companies
language plpgsql
security definer
set search_path = public
as $$
declare
  k   text := public.pi_user_key();
  row public.pi_companies;
begin
  if k = '' then
    raise exception 'not signed in';
  end if;
  select * into row from public.pi_companies where key = k;
  if not found then
    insert into public.pi_companies (key, name, created_by)
    values (
      k,
      case when position('@' in k) > 0 then 'My workspace' else initcap(split_part(k, '.', 1)) end,
      auth.uid()
    )
    returning * into row;
  end if;
  return row;
end;
$$;

-- ---------------------------------------------------------------- data tables

create table if not exists public.pi_profiles (
  company_id  uuid not null references public.pi_companies (id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, id)
);

create table if not exists public.pi_clients (
  company_id  uuid not null references public.pi_companies (id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, id)
);

create table if not exists public.pi_invoices (
  company_id  uuid not null references public.pi_companies (id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, id)
);

alter table public.pi_profiles enable row level security;
alter table public.pi_clients  enable row level security;
alter table public.pi_invoices enable row level security;

drop policy if exists "company members" on public.pi_profiles;
create policy "company members" on public.pi_profiles for all to authenticated
  using (company_id = public.pi_company_id())
  with check (company_id = public.pi_company_id());

drop policy if exists "company members" on public.pi_clients;
create policy "company members" on public.pi_clients for all to authenticated
  using (company_id = public.pi_company_id())
  with check (company_id = public.pi_company_id());

drop policy if exists "company members" on public.pi_invoices;
create policy "company members" on public.pi_invoices for all to authenticated
  using (company_id = public.pi_company_id())
  with check (company_id = public.pi_company_id());

grant usage on schema public to authenticated;
grant select, update on public.pi_companies to authenticated;
grant select, insert, update, delete on public.pi_profiles, public.pi_clients, public.pi_invoices to authenticated;
grant execute on function public.pi_ensure_company() to authenticated;
grant execute on function public.pi_user_key() to authenticated;
grant execute on function public.pi_company_id() to authenticated;
grant execute on function public.pi_is_public_domain(text) to authenticated;
