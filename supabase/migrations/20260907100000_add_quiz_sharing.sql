create table public.quiz_share_links (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  share_token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz,
  revoked_at timestamptz,
  claim_count integer not null default 0 check (claim_count >= 0),
  last_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quiz_share_links_owner_quiz_idx
  on public.quiz_share_links (owner_id, quiz_id, created_at desc);

create table public.quiz_share_claims (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.quiz_share_links(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  copied_quiz_id uuid references public.quizzes(id) on delete set null,
  claimed_at timestamptz not null default now(),
  unique (share_link_id, recipient_id)
);

create index quiz_share_claims_recipient_idx
  on public.quiz_share_claims (recipient_id, claimed_at desc);

alter table public.quiz_share_links enable row level security;
alter table public.quiz_share_claims enable row level security;

revoke all on table public.quiz_share_links from anon;
revoke all on table public.quiz_share_claims from anon;
grant select, insert, update, delete on table public.quiz_share_links to authenticated;
grant select on table public.quiz_share_claims to authenticated;

create policy "Hosts manage their quiz share links"
on public.quiz_share_links
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_share_links.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
);

create policy "Recipients read their quiz share claims"
on public.quiz_share_claims
for select
to authenticated
using (recipient_id = (select auth.uid()));

create or replace function public.create_quiz_share_link(
  p_quiz_id uuid,
  p_expires_in_days integer default 30
)
returns table (share_token uuid, expires_at timestamptz, claim_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_link public.quiz_share_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_expires_in_days is not null and (p_expires_in_days < 1 or p_expires_in_days > 365) then
    raise exception 'Share links must expire between 1 and 365 days';
  end if;

  if not exists (
    select 1
    from public.quizzes
    where quizzes.id = p_quiz_id
      and quizzes.owner_id = auth.uid()
  ) then
    raise exception 'Quiz not found or not owned by current host';
  end if;

  select links.*
  into selected_link
  from public.quiz_share_links as links
  where links.quiz_id = p_quiz_id
    and links.owner_id = auth.uid()
    and links.revoked_at is null
    and (links.expires_at is null or links.expires_at > now())
  order by links.created_at desc
  limit 1
  for update;

  if selected_link.id is null then
    update public.quiz_share_links
    set revoked_at = coalesce(revoked_at, now()),
        updated_at = now()
    where quiz_id = p_quiz_id
      and owner_id = auth.uid()
      and revoked_at is null;

    insert into public.quiz_share_links (quiz_id, owner_id, expires_at)
    values (
      p_quiz_id,
      auth.uid(),
      case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end
    )
    returning * into selected_link;
  end if;

  return query
  select selected_link.share_token, selected_link.expires_at, selected_link.claim_count;
end;
$$;

create or replace function public.revoke_quiz_share_link(p_share_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.quiz_share_links
  set revoked_at = now(),
      updated_at = now()
  where share_token = p_share_token
    and owner_id = auth.uid()
    and revoked_at is null;

  get diagnostics revoked_count = row_count;
  return revoked_count > 0;
end;
$$;

create or replace function public.get_shared_quiz_preview(p_share_token uuid)
returns table (
  quiz_title text,
  round_count integer,
  question_count integer,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select quizzes.title, quizzes.round_count, quizzes.question_count, links.expires_at
  from public.quiz_share_links as links
  join public.quizzes as quizzes on quizzes.id = links.quiz_id
  where auth.uid() is not null
    and links.share_token = p_share_token
    and links.revoked_at is null
    and (links.expires_at is null or links.expires_at > now())
  limit 1;
$$;

create or replace function public.claim_shared_quiz(p_share_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claiming_user_id uuid := auth.uid();
  selected_link public.quiz_share_links%rowtype;
  existing_copy_id uuid;
  copied_quiz_id uuid;
begin
  if claiming_user_id is null then
    raise exception 'Authentication required';
  end if;

  select links.*
  into selected_link
  from public.quiz_share_links as links
  where links.share_token = p_share_token
    and links.revoked_at is null
    and (links.expires_at is null or links.expires_at > now())
  for update of links;

  if selected_link.id is null then
    raise exception 'SHARE_LINK_INVALID';
  end if;

  if selected_link.owner_id = claiming_user_id then
    raise exception 'SHARE_OWN_QUIZ';
  end if;

  select claims.copied_quiz_id
  into existing_copy_id
  from public.quiz_share_claims as claims
  join public.quizzes as copied_quiz on copied_quiz.id = claims.copied_quiz_id
  where claims.share_link_id = selected_link.id
    and claims.recipient_id = claiming_user_id
    and copied_quiz.owner_id = claiming_user_id;

  if existing_copy_id is not null then
    return existing_copy_id;
  end if;

  delete from public.quiz_share_claims as claims
  where claims.share_link_id = selected_link.id
    and claims.recipient_id = claiming_user_id;

  insert into public.quizzes (
    owner_id, title, status, round_count, question_count, estimated_minutes, seed_key
  )
  select
    claiming_user_id,
    quizzes.title || ' (Shared copy)',
    quizzes.status,
    quizzes.round_count,
    quizzes.question_count,
    quizzes.estimated_minutes,
    null
  from public.quizzes as quizzes
  where quizzes.id = selected_link.quiz_id
  returning id into copied_quiz_id;

  if copied_quiz_id is null then
    raise exception 'SHARE_LINK_INVALID';
  end if;

  insert into public.quiz_questions (
    quiz_id, question_key, position, item_position, round_number, round_position,
    round_question_count, round_title, prompt, category, difficulty, question_type,
    correct_answer, accepted_answers, options, tags, image_url, points_max, bonus,
    metadata_snapshot, notes, source_question_id, source_revision
  )
  select
    copied_quiz_id, questions.question_key, questions.position, questions.item_position,
    questions.round_number, questions.round_position, questions.round_question_count,
    questions.round_title, questions.prompt, questions.category, questions.difficulty,
    questions.question_type, questions.correct_answer, questions.accepted_answers,
    questions.options, questions.tags, questions.image_url, questions.points_max,
    questions.bonus, questions.metadata_snapshot, questions.notes,
    case when exists (
      select 1
      from public.source_questions as source
      where source.id = questions.source_question_id
        and (source.origin = 'platform' or source.owner_id = claiming_user_id)
    ) then questions.source_question_id else null end,
    case when exists (
      select 1
      from public.source_questions as source
      where source.id = questions.source_question_id
        and (source.origin = 'platform' or source.owner_id = claiming_user_id)
    ) then questions.source_revision else null end
  from public.quiz_questions as questions
  where questions.quiz_id = selected_link.quiz_id;

  insert into public.quiz_content_screens (
    quiz_id, screen_key, item_position, round_number, round_title, title, body, image_url
  )
  select
    copied_quiz_id, screens.screen_key, screens.item_position, screens.round_number,
    screens.round_title, screens.title, screens.body, screens.image_url
  from public.quiz_content_screens as screens
  where screens.quiz_id = selected_link.quiz_id;

  insert into public.quiz_tiebreakers (
    quiz_id, tiebreaker_key, position, prompt, correct_value, answer_unit, notes
  )
  select
    copied_quiz_id, tiebreakers.tiebreaker_key, tiebreakers.position,
    tiebreakers.prompt, tiebreakers.correct_value, tiebreakers.answer_unit, tiebreakers.notes
  from public.quiz_tiebreakers as tiebreakers
  where tiebreakers.quiz_id = selected_link.quiz_id;

  insert into public.quiz_show_games (
    quiz_id, show_game_key, item_position, round_number, round_title, game_type, title, settings
  )
  select
    copied_quiz_id, show_games.show_game_key, show_games.item_position,
    show_games.round_number, show_games.round_title, show_games.game_type,
    show_games.title, show_games.settings
  from public.quiz_show_games as show_games
  where show_games.quiz_id = selected_link.quiz_id;

  insert into public.quiz_share_claims (share_link_id, recipient_id, copied_quiz_id)
  values (selected_link.id, claiming_user_id, copied_quiz_id);

  update public.quiz_share_links
  set claim_count = claim_count + 1,
      last_claimed_at = now(),
      updated_at = now()
  where id = selected_link.id;

  return copied_quiz_id;
end;
$$;

revoke all on function public.create_quiz_share_link(uuid, integer) from public;
revoke all on function public.revoke_quiz_share_link(uuid) from public;
revoke all on function public.get_shared_quiz_preview(uuid) from public;
revoke all on function public.claim_shared_quiz(uuid) from public;

grant execute on function public.create_quiz_share_link(uuid, integer) to authenticated;
grant execute on function public.revoke_quiz_share_link(uuid) to authenticated;
grant execute on function public.get_shared_quiz_preview(uuid) to authenticated;
grant execute on function public.claim_shared_quiz(uuid) to authenticated;

comment on table public.quiz_share_links is
  'Private bearer links that let another authenticated host claim an independent quiz copy.';

comment on function public.claim_shared_quiz(uuid) is
  'Idempotently deep-copies a shared quiz into the authenticated recipient account without granting access to the source quiz.';
