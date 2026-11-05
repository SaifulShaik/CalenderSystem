-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course text,
  due_at timestamptz not null,
  done boolean not null default false,
  -- which reminders have already been sent (so you never get duplicates)
  notified_day boolean not null default false,
  notified_hours boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Row level security: you can only ever see and change your own rows.
alter table assignments enable row level security;
alter table push_subscriptions enable row level security;

create policy "own assignments" on assignments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own subscriptions" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
