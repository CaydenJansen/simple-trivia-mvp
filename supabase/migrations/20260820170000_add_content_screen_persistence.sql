alter table public.quiz_questions
  add column if not exists item_position integer;

update public.quiz_questions
set item_position = position
where item_position is null;

alter table public.quiz_questions
  alter column item_position set not null;

alter table public.game_questions
  add column if not exists item_position integer;

update public.game_questions
set item_position = position
where item_position is null;

alter table public.game_questions
  alter column item_position set not null;

create table if not exists public.quiz_content_screens (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  screen_key text not null,
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, screen_key),
  unique (quiz_id, item_position)
);

create table if not exists public.game_content_screens (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  screen_key text not null,
  item_position integer not null check (item_position > 0),
  round_number integer not null check (round_number > 0),
  round_title text not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  image_url text,
  created_at timestamptz not null default now(),
  unique (game_id, screen_key),
  unique (game_id, item_position)
);

create index if not exists quiz_content_screens_quiz_order_idx
  on public.quiz_content_screens (quiz_id, item_position);

create index if not exists game_content_screens_game_order_idx
  on public.game_content_screens (game_id, item_position);

alter table public.quiz_content_screens enable row level security;
alter table public.game_content_screens enable row level security;

revoke all on table public.quiz_content_screens from anon;
grant select, insert, update, delete on table public.quiz_content_screens to authenticated;
grant select on table public.game_content_screens to anon, authenticated;
grant insert, update, delete on table public.game_content_screens to authenticated;

create policy "Hosts manage content screens in their quizzes"
on public.quiz_content_screens
for all
to authenticated
using (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_content_screens.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.quizzes
    where quizzes.id = quiz_content_screens.quiz_id
      and quizzes.owner_id = (select auth.uid())
  )
);

create policy "Players read game content screens"
on public.game_content_screens
for select
to anon, authenticated
using (true);

create policy "Hosts manage game content screens"
on public.game_content_screens
for all
to authenticated
using (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_content_screens.game_id
      and quizzes.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.games
    join public.quizzes on quizzes.id = games.quiz_id
    where games.id = game_content_screens.game_id
      and quizzes.owner_id = (select auth.uid())
  )
);

drop function if exists public.save_quiz_with_questions(uuid, text, text, integer, jsonb);

create function public.save_quiz_with_questions(
  p_quiz_id uuid,
  p_title text,
  p_status text,
  p_estimated_minutes integer,
  p_questions jsonb,
  p_content_screens jsonb default '[]'::jsonb
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
    or jsonb_typeof(p_content_screens) <> 'array' then
    raise exception 'Quiz items must be JSON arrays';
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

  return saved_quiz_id;
end;
$$;

revoke all on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb) from public;
grant execute on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb) to authenticated;

comment on function public.save_quiz_with_questions(uuid, text, text, integer, jsonb, jsonb) is
  'Atomically creates or updates one owned quiz and replaces its independent question and content-screen snapshots.';

comment on table public.quiz_content_screens is
  'Reusable quiz content screens stored separately from scored questions.';

comment on table public.game_content_screens is
  'Frozen content-screen snapshots belonging to one live game.';
