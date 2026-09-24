begin;

-- Telemetry-only updates must not create editorial revisions, while a child
-- metadata trigger that touches only updated_at still must.
create or replace function public.touch_source_question()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editorial_changed boolean;
  observed_changed boolean;
begin
  editorial_changed := (
    to_jsonb(new) - array[
      'revision', 'updated_at', 'observed_difficulty', 'observed_sample_size',
      'observed_correct_rate', 'observed_updated_at'
    ]
  ) is distinct from (
    to_jsonb(old) - array[
      'revision', 'updated_at', 'observed_difficulty', 'observed_sample_size',
      'observed_correct_rate', 'observed_updated_at'
    ]
  );

  observed_changed := row(
    new.observed_difficulty,
    new.observed_sample_size,
    new.observed_correct_rate,
    new.observed_updated_at
  ) is distinct from row(
    old.observed_difficulty,
    old.observed_sample_size,
    old.observed_correct_rate,
    old.observed_updated_at
  );

  if editorial_changed
     or (not observed_changed and new.updated_at is distinct from old.updated_at) then
    new.revision := greatest(coalesce(new.revision, old.revision), old.revision + 1);
  else
    new.revision := old.revision;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- An image is part of an image-question's meaning, so changing it must make the
-- live snapshot ineligible for aggregate learning and answer suggestions.
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
      and coalesce(gq.image_url, '') = coalesce(sq.image_url, '')
  );
$$;

revoke all on function public.question_snapshot_matches_source(uuid, text) from public, anon, authenticated;

-- Correctness difficulty is based on answer parts, not the number of points a
-- question awards. Missing multi-answer entries count as incorrect parts.
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
  missing_count integer;
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

  missing_count := case
    when jsonb_typeof(new.grading_json->'missing') = 'array'
      then jsonb_array_length(new.grading_json->'missing')
    else 0
  end;
  item_count := coalesce(item_count, 0) + missing_count;

  if item_count = 0 then
    item_count := 1;
    correct_count := case when new.is_correct then 1 else 0 end;
  else
    correct_count := least(coalesce(correct_count, 0), item_count);
  end if;

  select source_question_id into prior_source_id
  from public.question_performance_events
  where submission_id = new.id;

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

-- Repair any events created between the initial analytics deployment and this
-- correction, then recalculate their source aggregates.
with grading_counts as (
  select
    submissions.id as submission_id,
    submissions.is_correct,
    (
      select count(*) filter (where item->>'status' = 'correct')::integer
      from jsonb_array_elements(coalesce(submissions.grading_json->'items', '[]'::jsonb)) item
    ) as correct_count,
    (
      select count(*)::integer
      from jsonb_array_elements(coalesce(submissions.grading_json->'items', '[]'::jsonb))
    ) + case
      when jsonb_typeof(submissions.grading_json->'missing') = 'array'
        then jsonb_array_length(submissions.grading_json->'missing')
      else 0
    end as item_count
  from public.submissions
  join public.question_performance_events
    on question_performance_events.submission_id = submissions.id
)
update public.question_performance_events events
set correct_items = case
      when grading_counts.item_count = 0 and grading_counts.is_correct then 1
      when grading_counts.item_count = 0 then 0
      else least(coalesce(grading_counts.correct_count, 0), grading_counts.item_count)
    end,
    total_items = greatest(grading_counts.item_count, 1),
    updated_at = now()
from grading_counts
where events.submission_id = grading_counts.submission_id;

do $$
declare
  source_id uuid;
begin
  for source_id in
    select distinct source_question_id from public.question_performance_events
  loop
    perform public.refresh_question_observed_difficulty(source_id);
  end loop;
end;
$$;

commit;
