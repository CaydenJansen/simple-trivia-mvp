begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
-- Views expand SELECT * at creation. The historical catalogue predates these
-- telemetry columns, so expose them without changing its existing column order.
do $catalogue$
declare definition text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='source_question_catalog' and column_name='observed_difficulty') then
    select regexp_replace(pg_get_viewdef('public.source_question_catalog'::regclass,true),';\s*$','') into definition;
    execute format('create or replace view public.source_question_catalog with (security_invoker=true) as select catalog.*,sq.observed_difficulty,sq.observed_sample_size,sq.observed_correct_rate,sq.observed_updated_at from (%s) catalog join public.source_questions sq on sq.id=catalog.id',definition);
  end if;
end;
$catalogue$;
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
        select categories.name as category_name, count(distinct sq.id)::integer as question_count
        from public.categories
        left join public.source_question_categories sqc on sqc.category_id=categories.id and sqc.role='primary'
        left join public.source_questions sq on sq.id=sqc.source_question_id
          and sq.origin='platform' and sq.status='active' and sq.is_verified
        where categories.is_active
        group by categories.id,categories.name
        union all
        select 'Uncategorised',count(*)::integer from public.source_questions sq
        where sq.origin='platform' and sq.status='active' and sq.is_verified
          and not exists(select 1 from public.source_question_categories sqc where sqc.source_question_id=sq.id and sqc.role='primary')
      ) row_data
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;
commit;
