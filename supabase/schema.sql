-- FitFore database setup. Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to run more than once.

-- Every saved item (a day's log, a golf session, a weekly check-in, settings, the workout plan)
-- is one row, owned by one user.
create table if not exists public.docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null check (char_length(path) between 3 and 120),
  data jsonb not null check (pg_column_size(data) < 400000),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

alter table public.docs enable row level security;

-- Newer Supabase projects don't open new tables to signed-in users automatically.
-- Row level security (the policies below) still limits each user to their own rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.docs to authenticated;
revoke all on table public.docs from anon;

drop policy if exists "Users read their own data" on public.docs;
create policy "Users read their own data" on public.docs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users add their own data" on public.docs;
create policy "Users add their own data" on public.docs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users change their own data" on public.docs;
create policy "Users change their own data" on public.docs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete their own data" on public.docs;
create policy "Users delete their own data" on public.docs
  for delete to authenticated using (auth.uid() = user_id);

-- Daily AI request counts. No one can read or change this table directly;
-- only the function below updates it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

-- Adds one AI request for the signed-in user today and returns today's total.
create or replace function public.use_ai_credit()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  return n;
end;
$$;

revoke all on function public.use_ai_credit() from public, anon;
grant execute on function public.use_ai_credit() to authenticated;
