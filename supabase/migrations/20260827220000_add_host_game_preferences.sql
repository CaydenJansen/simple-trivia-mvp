create table if not exists public.host_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(game_settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.host_preferences enable row level security;

revoke all on table public.host_preferences from public, anon;
grant select, insert, update on table public.host_preferences to authenticated;

drop policy if exists "Hosts read their own preferences" on public.host_preferences;
create policy "Hosts read their own preferences"
on public.host_preferences for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Hosts create their own preferences" on public.host_preferences;
create policy "Hosts create their own preferences"
on public.host_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Hosts update their own preferences" on public.host_preferences;
create policy "Hosts update their own preferences"
on public.host_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

comment on table public.host_preferences is
  'Per-host defaults for new live games. Each active game keeps its own frozen, independently editable settings.';
