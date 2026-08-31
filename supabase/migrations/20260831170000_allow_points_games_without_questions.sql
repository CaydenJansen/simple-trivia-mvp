begin;

-- A show can be entirely game-based, provided at least one game awards trivia
-- points. The builder already applies this readiness rule; keep lobby creation
-- aligned with it instead of requiring an ordinary question unconditionally.
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

  if first_question_key is null and not exists (
    select 1
    from public.quiz_show_games
    where quiz_show_games.quiz_id = p_quiz_id
      and quiz_show_games.game_type <> 'in-show-tiebreaker'
      and case
        when quiz_show_games.settings->>'reward_type' = 'points'
          and coalesce(quiz_show_games.settings->>'reward_points', '') ~ '^[0-9]+$'
          then least(100, greatest(1, (quiz_show_games.settings->>'reward_points')::integer))
        else 0
      end > 0
  ) then
    raise exception 'This show needs at least one scored question or points game';
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
  'Atomically creates a fresh lobby from a ready owned quiz that contains a scored question or a points-awarding show game.';

commit;
