create table if not exists public.quiz_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  sort_position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_folders_name_present check (length(btrim(name)) > 0)
);

create index if not exists quiz_folders_owner_sort_idx
  on public.quiz_folders (owner_id, sort_position, created_at);

create unique index if not exists quiz_folders_owner_name_unique_idx
  on public.quiz_folders (owner_id, lower(btrim(name)));

alter table public.quiz_folders enable row level security;

revoke all on table public.quiz_folders from anon;
grant select, insert, update, delete on table public.quiz_folders to authenticated;

drop policy if exists "Hosts manage their quiz folders" on public.quiz_folders;
create policy "Hosts manage their quiz folders"
on public.quiz_folders
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

alter table public.quizzes
  add column if not exists folder_id uuid references public.quiz_folders(id) on delete set null;

drop policy if exists "Hosts manage their quizzes" on public.quizzes;
create policy "Hosts manage their quizzes"
on public.quizzes
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and (
    folder_id is null
    or exists (
      select 1 from public.quiz_folders
      where quiz_folders.id = quizzes.folder_id
        and quiz_folders.owner_id = (select auth.uid())
    )
  )
);

create index if not exists quizzes_owner_folder_updated_idx
  on public.quizzes (owner_id, folder_id, updated_at desc);

comment on table public.quiz_folders is
  'Host-owned folders used to organise reusable quizzes on My Quizzes.';

comment on column public.quizzes.folder_id is
  'Optional owner-scoped dashboard folder. Null means the quiz is unfiled.';
