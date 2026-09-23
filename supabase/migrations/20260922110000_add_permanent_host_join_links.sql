create table if not exists public.host_join_links (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint host_join_links_slug_format check (slug ~ '^[a-z0-9]{16,32}$')
);

alter table public.host_join_links enable row level security;

revoke all on table public.host_join_links from public, anon;
grant select on table public.host_join_links to authenticated;

drop policy if exists "Hosts read their permanent join link" on public.host_join_links;
create policy "Hosts read their permanent join link"
on public.host_join_links
for select
to authenticated
using (host_id = (select auth.uid()));

create or replace function public.ensure_host_join_link()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_user_id uuid := auth.uid();
  stable_slug text;
begin
  if host_user_id is null then
    raise exception 'Authentication required';
  end if;

  select links.slug
  into stable_slug
  from public.host_join_links as links
  where links.host_id = host_user_id;

  if stable_slug is null then
    loop
      stable_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
      begin
        insert into public.host_join_links (host_id, slug)
        values (host_user_id, stable_slug);
        exit;
      exception when unique_violation then
        select links.slug
        into stable_slug
        from public.host_join_links as links
        where links.host_id = host_user_id;
        if stable_slug is not null then exit; end if;
      end;
    end loop;
  end if;

  return stable_slug;
end;
$$;

create or replace function public.resolve_host_join_link(p_slug text)
returns table (game_code text, game_title text)
language sql
security definer
stable
set search_path = ''
as $$
  select games.code, games.title
  from public.host_join_links as links
  join public.quizzes on quizzes.owner_id = links.host_id
  join public.games on games.quiz_id = quizzes.id
  where links.slug = lower(btrim(p_slug))
    and games.status in ('lobby', 'live')
  order by games.created_at desc
  limit 1;
$$;

revoke all on function public.ensure_host_join_link() from public, anon;
grant execute on function public.ensure_host_join_link() to authenticated;

revoke all on function public.resolve_host_join_link(text) from public;
grant execute on function public.resolve_host_join_link(text) to anon, authenticated;

comment on table public.host_join_links is
  'Stable public join aliases for hosts. Resolution reveals only the newest currently joinable game code.';

comment on function public.resolve_host_join_link(text) is
  'Resolves a stable host link to that host''s newest lobby or live game without exposing host identity.';
