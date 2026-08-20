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

  return query
  select created_game_id, generated_code, selected_quiz.title;
end;
$$;

revoke all on function public.create_game_from_quiz(uuid, jsonb) from public;
grant execute on function public.create_game_from_quiz(uuid, jsonb) to authenticated;

comment on function public.create_game_from_quiz(uuid, jsonb) is
  'Atomically creates a fresh lobby and frozen question/content-screen snapshots from one ready owned quiz.';

create or replace function public.reveal_and_score_question(
  p_game_id uuid,
  p_question_key text,
  p_results jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_phase text;
  current_question_key text;
  question_points_max integer;
  unresolved_count integer;
  result_item jsonb;
  result_submission_id uuid;
  submission_team_id uuid;
  submission_is_correct boolean;
  awarded_points integer;
  total_awarded integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Scoring results must be a JSON array';
  end if;

  select games.answer_phase, games.current_question_key
    into current_phase, current_question_key
  from public.games
  join public.quizzes on quizzes.id = games.quiz_id
  where games.id = p_game_id
    and quizzes.owner_id = auth.uid()
  for update of games;

  if current_phase is null then
    raise exception 'Game not found or not owned by current host';
  end if;

  if current_question_key is distinct from p_question_key then
    raise exception 'Question is not current for this game';
  end if;

  if current_phase = 'revealed' then
    return 0;
  end if;

  if current_phase <> 'closed' then
    raise exception 'Answers must be closed before reveal';
  end if;

  select game_questions.points_max
    into question_points_max
  from public.game_questions
  where game_questions.game_id = p_game_id
    and game_questions.question_key = p_question_key;

  if question_points_max is null then
    raise exception 'Question snapshot not found';
  end if;

  select count(*)
    into unresolved_count
  from public.submissions
  where submissions.game_id = p_game_id
    and submissions.question_key = p_question_key
    and submissions.is_correct is null;

  if jsonb_array_length(p_results) <> unresolved_count then
    raise exception 'Scoring results must include every unresolved submission exactly once';
  end if;

  for result_item in select value from jsonb_array_elements(p_results)
  loop
    result_submission_id := nullif(result_item->>'submission_id', '')::uuid;
    awarded_points := (result_item->>'points_awarded')::integer;

    if result_submission_id is null
      or awarded_points is null
      or awarded_points < 0
      or awarded_points > question_points_max
      or jsonb_typeof(result_item->'is_correct') <> 'boolean'
      or jsonb_typeof(result_item->'grading_json') <> 'object' then
      raise exception 'Invalid scoring result';
    end if;

    select submissions.team_id, submissions.is_correct
      into submission_team_id, submission_is_correct
    from public.submissions
    where submissions.id = result_submission_id
      and submissions.game_id = p_game_id
      and submissions.question_key = p_question_key
    for update;

    if submission_team_id is null or submission_is_correct is not null then
      raise exception 'Submission is missing, already scored, or duplicated';
    end if;

    update public.submissions
    set is_correct = (result_item->>'is_correct')::boolean,
        points_awarded = awarded_points,
        grading_json = result_item->'grading_json',
        updated_at = now()
    where submissions.id = result_submission_id;

    if awarded_points > 0 then
      update public.teams
      set score = score + awarded_points
      where teams.id = submission_team_id
        and teams.game_id = p_game_id;
    end if;

    total_awarded := total_awarded + awarded_points;
  end loop;

  update public.games
  set answer_phase = 'revealed'
  where games.id = p_game_id;

  return total_awarded;
end;
$$;

revoke all on function public.reveal_and_score_question(uuid, text, jsonb) from public;
grant execute on function public.reveal_and_score_question(uuid, text, jsonb) to authenticated;

comment on function public.reveal_and_score_question(uuid, text, jsonb) is
  'Atomically stores final grading, increments team scores once, and reveals the current question.';
