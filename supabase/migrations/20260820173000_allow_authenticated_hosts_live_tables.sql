grant select, insert, update, delete
  on table public.games, public.game_questions, public.teams, public.submissions
  to authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('games', 'game_questions', 'teams', 'submissions')
      and roles = array['anon']::name[]
  loop
    execute format(
      'alter policy %I on %I.%I to anon, authenticated',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

comment on table public.games is
  'Live game state. Existing live policies apply equally to anonymous players and authenticated hosts.';
