begin;

-- Platform administration remains independent from ordinary host ownership.
-- The earliest quiz owner bootstraps the first super-admin; subsequent access
-- is granted explicitly in platform_admins or through trusted JWT app metadata.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_admins (user_id, role, granted_reason)
select quizzes.owner_id, 'super_admin', 'Initial platform owner bootstrap'
from public.quizzes
where quizzes.owner_id is not null
order by quizzes.created_at, quizzes.id
limit 1
on conflict (user_id) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'super_admin')
    or exists (
      select 1 from public.platform_admins
      where platform_admins.user_id = auth.uid()
        and platform_admins.active
    )
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;
grant select on table public.platform_admins to authenticated;

create policy "Platform admins read admin membership"
on public.platform_admins for select to authenticated
using (public.is_platform_admin());

-- Keep observed performance separate from editorial judgement. Auto-Build may
-- use observed_difficulty after a meaningful sample without overwriting the
-- editor-assigned value.
alter table public.source_questions
  add column if not exists observed_difficulty smallint
    check (observed_difficulty is null or observed_difficulty between 1 and 5),
  add column if not exists observed_sample_size integer not null default 0
    check (observed_sample_size >= 0),
  add column if not exists observed_correct_rate numeric(6,5)
    check (observed_correct_rate is null or observed_correct_rate between 0 and 1),
  add column if not exists observed_updated_at timestamptz;

-- Observed telemetry is operational metadata, not an editorial revision. Keep
-- source provenance stable while these four fields are refreshed.
create or replace function public.touch_source_question()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if (
    to_jsonb(new) - array[
      'revision', 'updated_at', 'observed_difficulty', 'observed_sample_size',
      'observed_correct_rate', 'observed_updated_at'
    ]
  ) is distinct from (
    to_jsonb(old) - array[
      'revision', 'updated_at', 'observed_difficulty', 'observed_sample_size',
      'observed_correct_rate', 'observed_updated_at'
    ]
  ) then new.revision = old.revision + 1;
  else new.revision = old.revision;
  end if;
  return new;
end;
$$;

alter table public.game_questions
  add column if not exists source_question_id uuid
    references public.source_questions(id) on delete set null,
  add column if not exists source_revision integer
    check (source_revision is null or source_revision > 0);

create index if not exists game_questions_source_question_idx
  on public.game_questions (source_question_id)
  where source_question_id is not null;

create table if not exists public.question_performance_events (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  source_revision integer not null check (source_revision > 0),
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  correct_items integer not null check (correct_items >= 0),
  total_items integer not null check (total_items > 0),
  points_awarded integer not null check (points_awarded >= 0),
  points_possible integer not null check (points_possible > 0),
  first_recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_performance_events_source_idx
  on public.question_performance_events (source_question_id, updated_at desc);

alter table public.question_performance_events enable row level security;
revoke all on table public.question_performance_events from public, anon, authenticated;

create table if not exists public.question_answer_suggestions (
  id uuid primary key default gen_random_uuid(),
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  source_revision integer not null check (source_revision > 0),
  answer_slot integer not null default 0 check (answer_slot >= 0),
  proposed_answer text not null check (length(btrim(proposed_answer)) > 0),
  normalized_answer text not null check (length(btrim(normalized_answer)) > 0),
  expected_answer text,
  status text not null default 'collecting'
    check (status in ('collecting', 'pending', 'approved', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  unique (source_question_id, source_revision, answer_slot, normalized_answer)
);

create table if not exists public.question_answer_suggestion_signals (
  suggestion_id uuid not null references public.question_answer_suggestions(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (suggestion_id, host_id)
);

create table if not exists public.platform_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.question_answer_suggestions enable row level security;
alter table public.question_answer_suggestion_signals enable row level security;
alter table public.platform_admin_audit_log enable row level security;
revoke all on table public.question_answer_suggestions from public, anon, authenticated;
revoke all on table public.question_answer_suggestion_signals from public, anon, authenticated;
revoke all on table public.platform_admin_audit_log from public, anon, authenticated;

create or replace function public.normalise_answer_signal(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.question_snapshot_matches_source(
  p_game_id uuid,
  p_question_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.game_questions gq
    join public.source_questions sq on sq.id = gq.source_question_id
    where gq.game_id = p_game_id
      and gq.question_key = p_question_key
      and sq.origin = 'platform'
      and gq.source_revision = sq.revision
      and gq.prompt = sq.prompt
      and gq.question_type = sq.question_type
      and gq.correct_answer = sq.correct_answer
      and gq.accepted_answers = sq.accepted_answers
      and coalesce(gq.options, 'null'::jsonb) = coalesce(sq.options, 'null'::jsonb)
  );
$$;

revoke all on function public.question_snapshot_matches_source(uuid, text) from public, anon, authenticated;

create or replace function public.refresh_question_observed_difficulty(p_source_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sample_count integer;
  correct_rate numeric;
  next_difficulty smallint;
begin
  select count(*)::integer,
         coalesce(sum(correct_items)::numeric / nullif(sum(total_items), 0), 0)
    into sample_count, correct_rate
  from public.question_performance_events
  where source_question_id = p_source_question_id;

  next_difficulty := case
    when sample_count < 20 then null
    when correct_rate >= 0.80 then 1
    when correct_rate >= 0.65 then 2
    when correct_rate >= 0.45 then 3
    when correct_rate >= 0.30 then 4
    else 5
  end;

  update public.source_questions
  set observed_sample_size = sample_count,
      observed_correct_rate = case when sample_count = 0 then null else correct_rate end,
      observed_difficulty = next_difficulty,
      observed_updated_at = now()
  where id = p_source_question_id;
end;
$$;

revoke all on function public.refresh_question_observed_difficulty(uuid) from public, anon, authenticated;

create or replace function public.capture_question_performance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot public.game_questions%rowtype;
  correct_count integer;
  item_count integer;
  prior_source_id uuid;
begin
  if tg_op = 'DELETE' then
    select source_question_id into prior_source_id
    from public.question_performance_events
    where submission_id = old.id;
    delete from public.question_performance_events where submission_id = old.id;
    if prior_source_id is not null then
      perform public.refresh_question_observed_difficulty(prior_source_id);
    end if;
    return old;
  end if;

  if new.is_correct is null then
    return new;
  end if;

  select * into snapshot
  from public.game_questions
  where game_id = new.game_id and question_key = new.question_key;

  if snapshot.source_question_id is null
     or not public.question_snapshot_matches_source(new.game_id, new.question_key) then
    select source_question_id into prior_source_id
    from public.question_performance_events
    where submission_id = new.id;
    delete from public.question_performance_events where submission_id = new.id;
    if prior_source_id is not null then
      perform public.refresh_question_observed_difficulty(prior_source_id);
    end if;
    return new;
  end if;

  select count(*) filter (where item->>'status' = 'correct')::integer,
         count(*)::integer
    into correct_count, item_count
  from jsonb_array_elements(coalesce(new.grading_json->'items', '[]'::jsonb)) item;

  if coalesce(item_count, 0) = 0 then
    item_count := greatest(snapshot.points_max, 1);
    correct_count := case when new.is_correct then item_count else 0 end;
  else
    item_count := greatest(item_count, greatest(snapshot.points_max, 1));
    correct_count := least(coalesce(correct_count, 0), item_count);
  end if;

  insert into public.question_performance_events (
    submission_id, source_question_id, source_revision, game_id, team_id,
    correct_items, total_items, points_awarded, points_possible
  ) values (
    new.id, snapshot.source_question_id, snapshot.source_revision, new.game_id, new.team_id,
    correct_count, item_count, greatest(new.points_awarded, 0), greatest(snapshot.points_max, 1)
  )
  on conflict (submission_id) do update set
    source_question_id = excluded.source_question_id,
    source_revision = excluded.source_revision,
    correct_items = excluded.correct_items,
    total_items = excluded.total_items,
    points_awarded = excluded.points_awarded,
    points_possible = excluded.points_possible,
    updated_at = now();

  perform public.refresh_question_observed_difficulty(snapshot.source_question_id);
  if prior_source_id is not null and prior_source_id <> snapshot.source_question_id then
    perform public.refresh_question_observed_difficulty(prior_source_id);
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_capture_question_performance_write on public.submissions;
drop trigger if exists submissions_capture_question_performance_delete on public.submissions;
create trigger submissions_capture_question_performance_write
after insert or update of is_correct, grading_json, points_awarded on public.submissions
for each row execute function public.capture_question_performance();
create trigger submissions_capture_question_performance_delete
after delete on public.submissions
for each row execute function public.capture_question_performance();

create or replace function public.record_host_answer_override(
  p_submission_id uuid,
  p_answer_slot integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_submission public.submissions%rowtype;
  selected_question public.game_questions%rowtype;
  selected_source public.source_questions%rowtype;
  grading_item jsonb;
  proposed text;
  expected text;
  resolved_answer_slot integer;
  normalized text;
  recorded_suggestion_id uuid;
  host_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_answer_slot < 0 then raise exception 'Answer slot must be zero or greater'; end if;

  select submissions.* into selected_submission
  from public.submissions
  join public.games on games.id = submissions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where submissions.id = p_submission_id
    and quizzes.owner_id = auth.uid();
  if selected_submission.id is null then raise exception 'Submission not found or not owned by current host'; end if;

  select * into selected_question from public.game_questions
  where game_id = selected_submission.game_id
    and question_key = selected_submission.question_key;
  if selected_question.source_question_id is null
     or not public.question_snapshot_matches_source(selected_submission.game_id, selected_submission.question_key) then
    return null;
  end if;

  select * into selected_source from public.source_questions
  where id = selected_question.source_question_id and origin = 'platform';
  if selected_source.id is null
     or selected_question.question_type not in ('single-answer', 'image-question', 'multi-answer', 'multi-part') then
    return null;
  end if;

  grading_item := selected_submission.grading_json->'items'->p_answer_slot;
  if grading_item is null or grading_item->>'status' <> 'correct' then return null; end if;
  proposed := btrim(coalesce(grading_item->>'submitted', ''));
  expected := nullif(btrim(coalesce(grading_item->>'expected', '')), '');
  normalized := public.normalise_answer_signal(proposed);
  if normalized = '' then return null; end if;

  if selected_question.question_type = 'multi-answer' then
    if expected is null then return null; end if;
    select answer.ordinality::integer - 1 into resolved_answer_slot
    from jsonb_array_elements_text(selected_source.correct_answer)
      with ordinality as answer(value, ordinality)
    where public.normalise_answer_signal(answer.value) = public.normalise_answer_signal(expected)
    order by answer.ordinality
    limit 1;
    if resolved_answer_slot is null then return null; end if;
  elsif selected_question.question_type = 'multi-part' then
    resolved_answer_slot := p_answer_slot;
  else
    resolved_answer_slot := 0;
  end if;

  -- Exact answers and already-approved aliases do not need editorial review.
  if normalized = public.normalise_answer_signal(coalesce(expected, selected_source.correct_answer #>> '{}'))
     or exists (
       select 1 from jsonb_array_elements_text(
         case
           when selected_question.question_type in ('multi-part', 'multi-answer')
             then coalesce(selected_source.accepted_answers->resolved_answer_slot, '[]'::jsonb)
           else selected_source.accepted_answers
         end
       ) alias
       where public.normalise_answer_signal(alias) = normalized
     ) then
    return null;
  end if;

  insert into public.question_answer_suggestions (
    source_question_id, source_revision, answer_slot,
    proposed_answer, normalized_answer, expected_answer
  ) values (
    selected_source.id, selected_source.revision, resolved_answer_slot,
    proposed, normalized, expected
  )
  on conflict (source_question_id, source_revision, answer_slot, normalized_answer)
  do update set proposed_answer = excluded.proposed_answer, updated_at = now()
  returning id into recorded_suggestion_id;

  insert into public.question_answer_suggestion_signals (
    suggestion_id, host_id, game_id, submission_id
  ) values (recorded_suggestion_id, auth.uid(), selected_submission.game_id, selected_submission.id)
  on conflict (suggestion_id, host_id) do update set
    game_id = excluded.game_id,
    submission_id = excluded.submission_id,
    last_seen_at = now();

  select count(distinct host_id)::integer into host_count
  from public.question_answer_suggestion_signals
  where question_answer_suggestion_signals.suggestion_id = recorded_suggestion_id;

  update public.question_answer_suggestions
  set status = case when host_count >= 3 and status = 'collecting' then 'pending' else status end,
      updated_at = now()
  where id = recorded_suggestion_id;

  return recorded_suggestion_id;
end;
$$;

revoke all on function public.record_host_answer_override(uuid, integer) from public, anon;
grant execute on function public.record_host_answer_override(uuid, integer) to authenticated;

create or replace function public.get_platform_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;

  select jsonb_build_object(
    'games_total', (select count(*) from public.games),
    'games_last_30_days', (select count(*) from public.games where created_at >= now() - interval '30 days'),
    'games_last_7_days', (select count(*) from public.games where created_at >= now() - interval '7 days'),
    'games_live', (select count(*) from public.games where status in ('lobby', 'live')),
    'unique_hosts', (select count(distinct quizzes.owner_id) from public.games join public.quizzes on quizzes.id = games.quiz_id),
    'teams_total', (select count(*) from public.teams),
    'answers_total', (select count(*) from public.submissions),
    'library_active', (select count(*) from public.source_questions where origin = 'platform' and status = 'active' and is_verified),
    'library_never_played', (
      select count(*) from public.source_questions sq
      where sq.origin = 'platform' and sq.status = 'active' and sq.is_verified
        and not exists (select 1 from public.question_performance_events qpe where qpe.source_question_id = sq.id)
    ),
    'suggestions_pending', (select count(*) from public.question_answer_suggestions where status = 'pending'),
    'questions_observed', (select count(*) from public.source_questions where observed_sample_size > 0),
    'questions_adapted', (select count(*) from public.source_questions where observed_difficulty is not null),
    'most_used', coalesce((
      select jsonb_agg(row_data order by uses desc)
      from (
        select sq.id, sq.prompt, sq.editorial_difficulty, sq.observed_difficulty,
               sq.observed_sample_size as uses,
               round(coalesce(sq.observed_correct_rate, 0) * 100, 1) as correct_percent
        from public.source_questions sq
        where sq.origin = 'platform' and sq.observed_sample_size > 0
        order by sq.observed_sample_size desc, sq.prompt
        limit 10
      ) row_data
    ), '[]'::jsonb),
    'supply_by_difficulty', coalesce((
      select jsonb_agg(row_data order by difficulty)
      from (
        select difficulty, count(*)::integer as question_count
        from (
          select coalesce(observed_difficulty, editorial_difficulty) as difficulty
          from public.source_questions
          where origin = 'platform' and status = 'active' and is_verified
        ) eligible
        group by difficulty
      ) row_data
    ), '[]'::jsonb),
    'supply_by_mechanic', coalesce((
      select jsonb_agg(row_data order by question_count, question_type)
      from (
        select question_type, count(*)::integer as question_count
        from public.source_questions
        where origin = 'platform' and status = 'active' and is_verified
        group by question_type
      ) row_data
    ), '[]'::jsonb),
    'supply_by_category', coalesce((
      select jsonb_agg(row_data order by question_count, category_name)
      from (
        select coalesce(categories.name, 'Uncategorised') as category_name,
               count(distinct sq.id)::integer as question_count
        from public.source_questions sq
        left join public.source_question_categories sqc on sqc.source_question_id = sq.id and sqc.role = 'primary'
        left join public.categories on categories.id = sqc.category_id
        where sq.origin = 'platform' and sq.status = 'active' and sq.is_verified
        group by coalesce(categories.name, 'Uncategorised')
      ) row_data
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_platform_admin_dashboard() from public, anon;
grant execute on function public.get_platform_admin_dashboard() to authenticated;

create or replace function public.get_answer_suggestion_queue()
returns table (
  suggestion_id uuid,
  question_id uuid,
  question_prompt text,
  question_type text,
  current_answer jsonb,
  answer_slot integer,
  proposed_answer text,
  expected_answer text,
  distinct_host_count bigint,
  signal_count bigint,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  return query
  select s.id, sq.id, sq.prompt, sq.question_type, sq.correct_answer,
         s.answer_slot, s.proposed_answer, s.expected_answer,
         count(distinct signals.host_id), count(signals.*), s.status, s.created_at
  from public.question_answer_suggestions s
  join public.source_questions sq on sq.id = s.source_question_id
  left join public.question_answer_suggestion_signals signals on signals.suggestion_id = s.id
  where s.status in ('pending', 'collecting')
  group by s.id, sq.id, sq.prompt, sq.question_type, sq.correct_answer
  order by case when s.status = 'pending' then 0 else 1 end,
           count(distinct signals.host_id) desc, s.created_at;
end;
$$;

revoke all on function public.get_answer_suggestion_queue() from public, anon;
grant execute on function public.get_answer_suggestion_queue() to authenticated;

create or replace function public.review_answer_suggestion(
  p_suggestion_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  suggestion public.question_answer_suggestions%rowtype;
  source public.source_questions%rowtype;
  aliases jsonb;
  slot_aliases jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;

  select * into suggestion from public.question_answer_suggestions
  where id = p_suggestion_id for update;
  if suggestion.id is null then raise exception 'Suggestion not found'; end if;
  if suggestion.status not in ('pending', 'collecting') then raise exception 'Suggestion has already been reviewed'; end if;

  select * into source from public.source_questions where id = suggestion.source_question_id for update;
  if source.id is null or source.revision <> suggestion.source_revision then
    update public.question_answer_suggestions
    set status = 'stale', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note, updated_at = now()
    where id = suggestion.id;
    return 'stale';
  end if;

  if p_decision = 'approved' then
    if source.question_type in ('single-answer', 'image-question') then
      aliases := coalesce(source.accepted_answers, '[]'::jsonb);
      if not exists (
        select 1 from jsonb_array_elements_text(aliases) alias
        where public.normalise_answer_signal(alias) = suggestion.normalized_answer
      ) then aliases := aliases || to_jsonb(suggestion.proposed_answer); end if;
    elsif source.question_type in ('multi-answer', 'multi-part') then
      aliases := coalesce(source.accepted_answers, '[]'::jsonb);
      while jsonb_array_length(aliases) <= suggestion.answer_slot loop
        aliases := aliases || '[]'::jsonb;
      end loop;
      slot_aliases := coalesce(aliases->suggestion.answer_slot, '[]'::jsonb);
      if jsonb_typeof(slot_aliases) <> 'array' then slot_aliases := '[]'::jsonb; end if;
      if not exists (
        select 1 from jsonb_array_elements_text(slot_aliases) alias
        where public.normalise_answer_signal(alias) = suggestion.normalized_answer
      ) then slot_aliases := slot_aliases || to_jsonb(suggestion.proposed_answer); end if;
      aliases := jsonb_set(aliases, array[suggestion.answer_slot::text], slot_aliases, true);
    else
      raise exception 'This question type does not support accepted-answer alternatives';
    end if;

    update public.source_questions set accepted_answers = aliases where id = source.id;
  end if;

  update public.question_answer_suggestions
  set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid(),
      review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = suggestion.id;

  insert into public.platform_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'answer_suggestion_' || p_decision, 'question_answer_suggestion', suggestion.id,
          jsonb_build_object('source_question_id', source.id, 'proposed_answer', suggestion.proposed_answer));

  return p_decision;
end;
$$;

revoke all on function public.review_answer_suggestion(uuid, text, text) from public, anon;
grant execute on function public.review_answer_suggestion(uuid, text, text) to authenticated;

-- Ensure future live snapshots keep their source provenance. The show-game
-- wrapper calls this function, so no parallel snapshot path is required.
create or replace function public.create_game_from_quiz(
  p_quiz_id uuid,
  p_settings jsonb default '{}'::jsonb
)
returns table (game_id uuid, game_code text, game_title text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_quiz public.quizzes%rowtype;
  first_question_key text;
  generated_code text;
  created_game_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_settings) <> 'object' then raise exception 'Game settings must be a JSON object'; end if;

  select * into selected_quiz from public.quizzes
  where id = p_quiz_id and owner_id = auth.uid() and status = 'ready';
  if selected_quiz.id is null then raise exception 'Ready quiz not found or not owned by current host'; end if;

  select question_key into first_question_key from public.quiz_questions
  where quiz_id = p_quiz_id order by position limit 1;
  if first_question_key is null and not exists (
    select 1 from public.quiz_show_games
    where quiz_id = p_quiz_id and game_type <> 'in-show-tiebreaker'
      and case when settings->>'reward_type' = 'points' and coalesce(settings->>'reward_points', '') ~ '^[0-9]+$'
        then least(100, greatest(1, (settings->>'reward_points')::integer)) else 0 end > 0
  ) then raise exception 'This show needs at least one scored question or points game'; end if;

  for code_attempt in 1..20 loop
    generated_code := (floor(random() * 900000) + 100000)::integer::text;
    insert into public.games (code, title, status, current_screen, answer_phase,
      current_question_key, current_content_screen_key, quiz_id, settings)
    values (generated_code, selected_quiz.title, 'lobby', 'lobby', 'open',
      first_question_key, null, selected_quiz.id, p_settings)
    on conflict (code) do nothing returning id into created_game_id;
    exit when created_game_id is not null;
  end loop;
  if created_game_id is null then raise exception 'Could not generate a unique game code'; end if;

  insert into public.game_questions (
    game_id, question_key, position, item_position, round_number, round_position,
    round_question_count, round_title, prompt, category, difficulty, question_type,
    correct_answer, accepted_answers, options, tags, image_url, points_max, notes,
    metadata_snapshot, source_question_id, source_revision
  )
  select created_game_id, question_key, position, item_position, round_number, round_position,
    round_question_count, round_title, prompt, category, difficulty, question_type,
    correct_answer, accepted_answers, options, tags, image_url, points_max, notes,
    metadata_snapshot, source_question_id, source_revision
  from public.quiz_questions where quiz_id = selected_quiz.id order by position;

  insert into public.game_content_screens (
    game_id, screen_key, item_position, round_number, round_title, title, body, image_url
  ) select created_game_id, screen_key, item_position, round_number, round_title, title, body, image_url
    from public.quiz_content_screens where quiz_id = selected_quiz.id order by item_position;

  insert into public.game_tiebreakers (
    game_id, tiebreaker_key, position, prompt, correct_value, answer_unit, notes
  ) select created_game_id, tiebreaker_key, position, prompt, correct_value, answer_unit, notes
    from public.quiz_tiebreakers where quiz_id = selected_quiz.id order by position;

  return query select created_game_id, generated_code, selected_quiz.title;
end;
$$;

revoke all on function public.create_game_from_quiz(uuid, jsonb) from public;
grant execute on function public.create_game_from_quiz(uuid, jsonb) to authenticated;

comment on function public.create_game_from_quiz(uuid, jsonb) is
  'Atomically creates a ready owned quiz lobby and preserves source provenance for analytics.';

commit;
