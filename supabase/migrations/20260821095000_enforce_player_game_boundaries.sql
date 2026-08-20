create or replace function public.join_live_game(
  p_game_id uuid,
  p_team_name text
)
returns table (
  id uuid,
  name text,
  score integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(p_team_name);
begin
  if normalized_name = '' then
    raise exception 'Team name is required';
  end if;

  if not exists (
    select 1
    from public.games
    where games.id = p_game_id
      and games.status = 'lobby'
      and games.current_screen = 'lobby'
  ) then
    raise exception 'Game is not accepting new teams';
  end if;

  return query
  insert into public.teams (game_id, name, score)
  values (p_game_id, normalized_name, 0)
  returning teams.id, teams.name, teams.score;
end;
$$;

create or replace function public.submit_player_answer(
  p_game_id uuid,
  p_team_id uuid,
  p_answer_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_question_key text;
  submission_id uuid;
begin
  select games.current_question_key
    into active_question_key
  from public.games
  where games.id = p_game_id
    and games.status = 'live'
    and games.answer_phase = 'open'
    and games.current_screen in (
      'single-answer',
      'image-question',
      'multiple-choice',
      'multi-answer',
      'multi-part',
      'ranking'
    )
  for update;

  if active_question_key is null then
    raise exception 'Answers are not open';
  end if;

  if not exists (
    select 1
    from public.teams
    where teams.id = p_team_id
      and teams.game_id = p_game_id
  ) then
    raise exception 'Team is not part of this game';
  end if;

  insert into public.submissions (
    game_id,
    team_id,
    question_key,
    answer_text,
    is_correct,
    points_awarded,
    grading_json
  )
  values (
    p_game_id,
    p_team_id,
    active_question_key,
    btrim(p_answer_text),
    null,
    0,
    null
  )
  on conflict (game_id, team_id, question_key)
  do update set
    answer_text = excluded.answer_text,
    is_correct = null,
    points_awarded = 0,
    grading_json = null,
    updated_at = now()
  returning submissions.id into submission_id;

  return submission_id;
end;
$$;

create or replace function public.get_player_game_question(
  p_game_id uuid,
  p_question_key text
)
returns table (
  question_key text,
  "position" integer,
  round_number integer,
  round_position integer,
  round_question_count integer,
  round_title text,
  prompt text,
  category text,
  difficulty text,
  question_type text,
  correct_answer jsonb,
  options jsonb,
  image_url text,
  points_max integer,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    game_questions.question_key,
    game_questions.position,
    game_questions.round_number,
    game_questions.round_position,
    game_questions.round_question_count,
    game_questions.round_title,
    game_questions.prompt,
    game_questions.category,
    game_questions.difficulty,
    game_questions.question_type,
    case
      when games.answer_phase = 'revealed' then game_questions.correct_answer
      else null
    end as correct_answer,
    game_questions.options,
    game_questions.image_url,
    game_questions.points_max,
    case
      when games.answer_phase = 'revealed' then game_questions.notes
      else null
    end as notes
  from public.games
  join public.game_questions
    on game_questions.game_id = games.id
  where games.id = p_game_id
    and games.current_question_key = p_question_key
    and game_questions.question_key = p_question_key;
$$;

revoke all on function public.join_live_game(uuid, text) from public;
revoke all on function public.submit_player_answer(uuid, uuid, text) from public;
revoke all on function public.get_player_game_question(uuid, text) from public;

grant execute on function public.join_live_game(uuid, text) to anon, authenticated;
grant execute on function public.submit_player_answer(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_game_question(uuid, text) to anon, authenticated;

revoke insert on table public.teams from anon;
revoke insert, update on table public.submissions from anon;
revoke select on table public.game_questions from anon;

comment on function public.join_live_game(uuid, text) is
  'Creates a team only while its game is in the joinable lobby.';

comment on function public.submit_player_answer(uuid, uuid, text) is
  'Creates or replaces a team answer only while the current question is open.';

comment on function public.get_player_game_question(uuid, text) is
  'Returns the current player-safe question, withholding the answer and host notes until reveal.';
