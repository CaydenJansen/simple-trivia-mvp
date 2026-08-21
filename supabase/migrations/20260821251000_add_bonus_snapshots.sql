begin;

alter table public.quiz_questions
  add column if not exists bonus jsonb,
  add constraint quiz_questions_bonus_object_check
    check (bonus is null or jsonb_typeof(bonus) = 'object');

alter table public.game_questions
  add column if not exists bonus jsonb,
  add constraint game_questions_bonus_object_check
    check (bonus is null or jsonb_typeof(bonus) = 'object');

create or replace function public.save_quiz_with_bonus_snapshots(
  p_quiz_id uuid,
  p_title text,
  p_status text,
  p_estimated_minutes integer,
  p_questions jsonb,
  p_content_screens jsonb default '[]'::jsonb,
  p_tiebreakers jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_quiz_id uuid;
begin
  saved_quiz_id := public.save_quiz_with_questions(
    p_quiz_id,
    p_title,
    p_status,
    p_estimated_minutes,
    p_questions,
    p_content_screens,
    p_tiebreakers
  );

  update public.quiz_questions
  set bonus = nullif(question.value->'bonus', 'null'::jsonb)
  from jsonb_array_elements(p_questions) as question(value)
  where quiz_questions.quiz_id = saved_quiz_id
    and quiz_questions.question_key = question.value->>'question_key';

  return saved_quiz_id;
end;
$$;

revoke all on function public.save_quiz_with_bonus_snapshots(uuid, text, text, integer, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_quiz_with_bonus_snapshots(uuid, text, text, integer, jsonb, jsonb, jsonb) to authenticated;

comment on function public.save_quiz_with_bonus_snapshots(uuid, text, text, integer, jsonb, jsonb, jsonb) is
  'Atomically saves a quiz through the established boundary and attaches independent structured bonus snapshots without counting them as ordinary questions.';

create or replace function public.snapshot_game_question_bonus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bonus is null then
    select quiz_questions.bonus
      into new.bonus
    from public.games
    join public.quiz_questions
      on quiz_questions.quiz_id = games.quiz_id
     and quiz_questions.question_key = new.question_key
    where games.id = new.game_id;
  end if;

  return new;
end;
$$;

create trigger game_questions_snapshot_bonus_before_insert
before insert on public.game_questions
for each row execute function public.snapshot_game_question_bonus();

comment on column public.quiz_questions.bonus is
  'Independent structured snapshot of an optional source bonus. Not an ordinary quiz question.';

comment on column public.game_questions.bonus is
  'Frozen game snapshot of the optional quiz-question bonus. Not an ordinary game question.';

commit;
