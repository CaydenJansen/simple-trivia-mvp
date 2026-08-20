alter table public.quizzes
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists quizzes_owner_updated_idx
  on public.quizzes (owner_id, updated_at desc);

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;

revoke all on table public.quizzes from anon;
revoke all on table public.quiz_questions from anon;
grant select, insert, update, delete on table public.quizzes to authenticated;
grant select, insert, update, delete on table public.quiz_questions to authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('quizzes', 'quiz_questions')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

create policy "Hosts manage their quizzes"
on public.quizzes
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Hosts manage questions in their quizzes"
on public.quiz_questions
for all
to authenticated
using (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_questions.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_questions.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
);

create or replace function public.save_quiz_with_questions(
  p_quiz_id uuid,
  p_title text,
  p_status text,
  p_estimated_minutes integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_quiz_id uuid;
  saved_question_count integer;
  saved_round_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if length(btrim(p_title)) = 0 then
    raise exception 'Quiz title is required';
  end if;

  if p_status not in ('draft', 'ready') then
    raise exception 'Invalid quiz status';
  end if;

  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a JSON array';
  end if;

  saved_question_count := jsonb_array_length(p_questions);
  select count(distinct (question->>'round_number')::integer)
    into saved_round_count
  from jsonb_array_elements(p_questions) as question;

  if p_quiz_id is null then
    insert into public.quizzes (
      owner_id,
      title,
      status,
      round_count,
      question_count,
      estimated_minutes
    ) values (
      auth.uid(),
      btrim(p_title),
      p_status,
      coalesce(saved_round_count, 0),
      saved_question_count,
      greatest(0, p_estimated_minutes)
    )
    returning id into saved_quiz_id;
  else
    update public.quizzes
    set title = btrim(p_title),
        status = p_status,
        round_count = coalesce(saved_round_count, 0),
        question_count = saved_question_count,
        estimated_minutes = greatest(0, p_estimated_minutes),
        updated_at = now()
    where id = p_quiz_id
      and owner_id = auth.uid()
    returning id into saved_quiz_id;

    if saved_quiz_id is null then
      raise exception 'Quiz not found or not owned by current host';
    end if;
  end if;

  delete from public.quiz_questions
  where quiz_id = saved_quiz_id;

  insert into public.quiz_questions (
    quiz_id,
    question_key,
    position,
    round_number,
    round_position,
    round_question_count,
    round_title,
    prompt,
    category,
    difficulty,
    question_type,
    correct_answer,
    accepted_answers,
    options,
    tags,
    image_url,
    points_max,
    notes,
    source_question_id,
    source_revision
  )
  select
    saved_quiz_id,
    question->>'question_key',
    (question->>'position')::integer,
    (question->>'round_number')::integer,
    (question->>'round_position')::integer,
    (question->>'round_question_count')::integer,
    question->>'round_title',
    question->>'prompt',
    nullif(question->>'category', ''),
    nullif(question->>'difficulty', ''),
    question->>'question_type',
    question->'correct_answer',
    coalesce(question->'accepted_answers', '[]'::jsonb),
    question->'options',
    coalesce(
      array(
        select jsonb_array_elements_text(coalesce(question->'tags', '[]'::jsonb))
      ),
      '{}'::text[]
    ),
    nullif(question->>'image_url', ''),
    greatest(1, (question->>'points_max')::integer),
    nullif(question->>'notes', ''),
    nullif(question->>'source_question_id', '')::uuid,
    nullif(question->>'source_revision', '')::integer
  from jsonb_array_elements(p_questions) as question;

  return saved_quiz_id;
end;
$$;

revoke all on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb) from public;
grant execute on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb) to authenticated;

comment on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb) is
  'Atomically creates or updates one owned quiz and replaces its independent question snapshots.';
