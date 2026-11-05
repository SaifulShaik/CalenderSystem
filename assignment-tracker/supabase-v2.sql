-- Run this in Supabase (SQL Editor -> New query -> paste -> Run) AFTER supabase.sql.
-- It is safe to run more than once.

-- ---------- changes to existing table ----------
alter table assignments add column if not exists est_minutes int not null default 60;
alter table assignments add column if not exists notified_overdue boolean not null default false;

-- ---------- tasks ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  est_minutes int not null default 30 check (est_minutes > 0),
  priority int not null default 2 check (priority between 1 and 3),   -- 1 low, 2 medium, 3 high
  deadline timestamptz,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- daily goals ----------
-- A recurring goal is a "template" row (recurring <> 'none', goal_date null).
-- The app creates one normal row per day from each template.
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  goal_date date,
  done boolean not null default false,
  recurring text not null default 'none' check (recurring in ('none', 'daily', 'weekdays')),
  template_id uuid references goals(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists goals_template_day
  on goals (template_id, goal_date) where template_id is not null;

-- ---------- the day schedule ----------
create table if not exists schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  kind text not null default 'other' check (kind in ('assignment', 'task', 'goal', 'break', 'other')),
  assignment_id uuid references assignments(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  locked boolean not null default false,
  created_by text not null default 'user' check (created_by in ('user', 'ai')),
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists schedule_blocks_user_start on schedule_blocks (user_id, start_at);

-- ---------- your scheduling preferences (one row per user) ----------
create table if not exists preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wake_time time not null default '07:30',
  bed_time time not null default '23:00',
  work_start time not null default '09:00',
  work_end time not null default '21:00',
  focus_start time not null default '09:00',
  focus_end time not null default '12:00',
  break_minutes int not null default 10,
  break_every_minutes int not null default 90,
  timezone text not null default 'America/Toronto',
  ai_mode text not null default 'ask' check (ai_mode in ('ask', 'auto_small')),
  remind_long_hours int not null default 24,
  remind_short_hours int not null default 2,
  alerts_blocks boolean not null default true,
  alerts_morning boolean not null default true,
  last_morning_date date
);

-- ---------- AI history ----------
create table if not exists ai_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  summary text,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  applied boolean not null default true,
  undone boolean not null default false
);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_user_time on ai_messages (user_id, created_at);

-- ---------- row level security: you only ever see your own rows ----------
do $$
declare t text;
begin
  foreach t in array array['tasks', 'goals', 'schedule_blocks', 'preferences', 'ai_changes', 'ai_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
