create table if not exists public.quiz_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  tiebreaker_key text not null,
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, tiebreaker_key),
  unique (quiz_id, position)
);

create table if not exists public.game_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  tiebreaker_key text not null,
  position integer not null check (position > 0),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id, tiebreaker_key),
  unique (game_id, position)
);

create index if not exists quiz_tiebreakers_quiz_order_idx
  on public.quiz_tiebreakers (quiz_id, position);

create index if not exists game_tiebreakers_game_order_idx
  on public.game_tiebreakers (game_id, position);

alter table public.quiz_tiebreakers enable row level security;
alter table public.game_tiebreakers enable row level security;

revoke all on table public.quiz_tiebreakers from anon;
revoke all on table public.game_tiebreakers from anon;
grant select, insert, update, delete on table public.quiz_tiebreakers to authenticated;
grant select, insert, update, delete on table public.game_tiebreakers to authenticated;

create policy "Hosts manage tiebreakers in their quizzes"
on public.quiz_tiebreakers
for all
to authenticated
using (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_tiebreakers.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_tiebreakers.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
);

create policy "Hosts manage tiebreakers in their games"
on public.game_tiebreakers
for all
to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreakers.game_id
      and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_tiebreakers.game_id
      and quizzes.owner_id = (select auth.uid())
  )
);

drop function if exists public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb);

create function public.save_quiz_with_questions(
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

  if jsonb_typeof(p_questions) <> 'array'
    or jsonb_typeof(p_content_screens) <> 'array'
    or jsonb_typeof(p_tiebreakers) <> 'array' then
    raise exception 'Quiz items must be JSON arrays';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tiebreakers) as tiebreaker
    where length(btrim(coalesce(tiebreaker->>'prompt', ''))) = 0
      or length(btrim(coalesce(tiebreaker->>'correct_value', ''))) = 0
  ) then
    raise exception 'Each tiebreaker requires a prompt and numeric answer';
  end if;

  saved_question_count := jsonb_array_length(p_questions);

  select count(distinct round_number)
    into saved_round_count
  from (
    select (question->>'round_number')::integer as round_number
    from jsonb_array_elements(p_questions) as question
    union all
    select (screen->>'round_number')::integer as round_number
    from jsonb_array_elements(p_content_screens) as screen
  ) as quiz_rounds;

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

  delete from public.quiz_content_screens
  where quiz_id = saved_quiz_id;

  delete from public.quiz_tiebreakers
  where quiz_id = saved_quiz_id;

  insert into public.quiz_questions (
    quiz_id,
    question_key,
    position,
    item_position,
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
    (question->>'item_position')::integer,
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

  insert into public.quiz_content_screens (
    quiz_id,
    screen_key,
    item_position,
    round_number,
    round_title,
    title,
    body,
    image_url
  )
  select
    saved_quiz_id,
    screen->>'screen_key',
    (screen->>'item_position')::integer,
    (screen->>'round_number')::integer,
    screen->>'round_title',
    btrim(screen->>'title'),
    nullif(screen->>'body', ''),
    nullif(screen->>'image_url', '')
  from jsonb_array_elements(p_content_screens) as screen;

  insert into public.quiz_tiebreakers (
    quiz_id,
    tiebreaker_key,
    position,
    prompt,
    correct_value,
    answer_unit,
    notes
  )
  select
    saved_quiz_id,
    tiebreaker->>'tiebreaker_key',
    (tiebreaker->>'position')::integer,
    btrim(tiebreaker->>'prompt'),
    btrim(tiebreaker->>'correct_value')::numeric,
    nullif(btrim(tiebreaker->>'answer_unit'), ''),
    nullif(btrim(tiebreaker->>'notes'), '')
  from jsonb_array_elements(p_tiebreakers) as tiebreaker;

  return saved_quiz_id;
end;
$$;

revoke all on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb, jsonb) to authenticated;

comment on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb, jsonb) is
  'Atomically creates or updates one owned quiz and replaces its independent question, content-screen, and prepared-tiebreaker snapshots.';

create or replace function public.create_game_from_quiz(
  p_quiz_id uuid,
  p_settings jsonb default '{}'::jsonb
)
returns table (
  game_id uuid,
  game_code text,
  game_title text
)
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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Game settings must be a JSON object';
  end if;

  select quizzes.*
    into selected_quiz
  from public.quizzes
  where quizzes.id = p_quiz_id
    and quizzes.owner_id = auth.uid()
    and quizzes.status = 'ready';

  if selected_quiz.id is null then
    raise exception 'Ready quiz not found or not owned by current host';
  end if;

  select quiz_questions.question_key
    into first_question_key
  from public.quiz_questions
  where quiz_questions.quiz_id = p_quiz_id
  order by quiz_questions.position
  limit 1;

  if first_question_key is null then
    raise exception 'This quiz has no questions yet';
  end if;

  for code_attempt in 1..20 loop
    generated_code := (floor(random() * 900000) + 100000)::integer::text;

    insert into public.games (
      code,
      title,
      status,
      current_screen,
      answer_phase,
      current_question_key,
      current_content_screen_key,
      quiz_id,
      settings
    ) values (
      generated_code,
      selected_quiz.title,
      'lobby',
      'lobby',
      'open',
      first_question_key,
      null,
      selected_quiz.id,
      p_settings
    )
    on conflict (code) do nothing
    returning games.id into created_game_id;

    exit when created_game_id is not null;
  end loop;

  if created_game_id is null then
    raise exception 'Could not generate a unique game code';
  end if;

  insert into public.game_questions (
    game_id,
    question_key,
    position,
    item_position,
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
    notes
  )
  select
    created_game_id,
    quiz_questions.question_key,
    quiz_questions.position,
    quiz_questions.item_position,
    quiz_questions.round_number,
    quiz_questions.round_position,
    quiz_questions.round_question_count,
    quiz_questions.round_title,
    quiz_questions.prompt,
    quiz_questions.category,
    quiz_questions.difficulty,
    quiz_questions.question_type,
    quiz_questions.correct_answer,
    quiz_questions.accepted_answers,
    quiz_questions.options,
    quiz_questions.tags,
    quiz_questions.image_url,
    quiz_questions.points_max,
    quiz_questions.notes
  from public.quiz_questions
  where quiz_questions.quiz_id = selected_quiz.id
  order by quiz_questions.position;

  insert into public.game_content_screens (
    game_id,
    screen_key,
    item_position,
    round_number,
    round_title,
    title,
    body,
    image_url
  )
  select
    created_game_id,
    quiz_content_screens.screen_key,
    quiz_content_screens.item_position,
    quiz_content_screens.round_number,
    quiz_content_screens.round_title,
    quiz_content_screens.title,
    quiz_content_screens.body,
    quiz_content_screens.image_url
  from public.quiz_content_screens
  where quiz_content_screens.quiz_id = selected_quiz.id
  order by quiz_content_screens.item_position;

  insert into public.game_tiebreakers (
    game_id,
    tiebreaker_key,
    position,
    prompt,
    correct_value,
    answer_unit,
    notes
  )
  select
    created_game_id,
    quiz_tiebreakers.tiebreaker_key,
    quiz_tiebreakers.position,
    quiz_tiebreakers.prompt,
    quiz_tiebreakers.correct_value,
    quiz_tiebreakers.answer_unit,
    quiz_tiebreakers.notes
  from public.quiz_tiebreakers
  where quiz_tiebreakers.quiz_id = selected_quiz.id
  order by quiz_tiebreakers.position;

  return query
  select created_game_id, generated_code, selected_quiz.title;
end;
$$;

revoke all on function public.create_game_from_quiz(uuid, jsonb) from public;
grant execute on function public.create_game_from_quiz(uuid, jsonb) to authenticated;

comment on function public.create_game_from_quiz(uuid, jsonb) is
  'Atomically creates a fresh lobby and frozen question, content-screen, and prepared-tiebreaker snapshots from one ready owned quiz.';

comment on table public.quiz_tiebreakers is
  'Optional prepared numeric closest-answer questions stored separately from ordinary scored quiz questions.';

comment on table public.game_tiebreakers is
  'Frozen prepared-tiebreaker snapshots for one game; correct values remain host-only until a future controlled reveal.';
