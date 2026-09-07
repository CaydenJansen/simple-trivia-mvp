drop function if exists public.get_shared_quiz_preview(uuid);

create function public.get_shared_quiz_preview(p_share_token uuid)
returns table (
  quiz_title text,
  round_count integer,
  question_count integer,
  content_screen_count integer,
  show_game_count integer,
  tiebreaker_count integer,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    quizzes.title,
    quizzes.round_count,
    (select count(*)::integer from public.quiz_questions where quiz_id = quizzes.id),
    (select count(*)::integer from public.quiz_content_screens where quiz_id = quizzes.id),
    (select count(*)::integer from public.quiz_show_games where quiz_id = quizzes.id),
    (select count(*)::integer from public.quiz_tiebreakers where quiz_id = quizzes.id),
    links.expires_at
  from public.quiz_share_links as links
  join public.quizzes as quizzes on quizzes.id = links.quiz_id
  where auth.uid() is not null
    and links.share_token = p_share_token
    and links.revoked_at is null
    and (links.expires_at is null or links.expires_at > now())
  limit 1;
$$;

revoke all on function public.get_shared_quiz_preview(uuid) from public;
grant execute on function public.get_shared_quiz_preview(uuid) to authenticated;

comment on function public.get_shared_quiz_preview(uuid) is
  'Previews the complete shared show, including counts for questions, content screens, games, and tiebreakers.';

comment on function public.claim_shared_quiz(uuid) is
  'Idempotently deep-copies the complete shared show—including questions, content screens, games with settings, and tiebreakers—into the authenticated recipient account.';
