begin;

create or replace function public.replace_question_library_batch(
  p_file_name text,
  p_file_sha256 text,
  p_payload jsonb,
  p_activate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_result jsonb;
  archived_questions integer := 0;
  archived_tiebreakers integer := 0;
  current_questions integer := 0;
  current_tiebreakers integer := 0;
begin
  import_result := public.import_question_library_batch(
    p_file_name,
    p_file_sha256,
    p_payload
  );

  update public.source_questions
  set status = 'archived'
  where origin = 'platform'
    and (
      import_key is null
      or not exists (
        select 1
        from jsonb_array_elements(p_payload->'questions') as incoming(value)
        where incoming.value->>'importKey' = source_questions.import_key
      )
    )
    and status <> 'archived';
  get diagnostics archived_questions = row_count;

  update public.source_tiebreakers
  set status = 'archived'
  where status <> 'archived'
    and (
      import_key is null
      or not exists (
      select 1
      from jsonb_array_elements(p_payload->'tiebreakers') as incoming(value)
      where incoming.value->>'importKey' = source_tiebreakers.import_key
      )
    );
  get diagnostics archived_tiebreakers = row_count;

  if p_activate then
    update public.source_questions
    set
      status = 'active',
      is_verified = true,
      verified_at = coalesce(verified_at, now()),
      last_reviewed_at = now()
    where origin = 'platform'
      and exists (
        select 1
        from jsonb_array_elements(p_payload->'questions') as incoming(value)
        where incoming.value->>'importKey' = source_questions.import_key
      );

    update public.source_tiebreakers
    set
      status = 'active',
      is_verified = true,
      last_reviewed_at = now()
    where exists (
      select 1
      from jsonb_array_elements(p_payload->'tiebreakers') as incoming(value)
      where incoming.value->>'importKey' = source_tiebreakers.import_key
    );
  end if;

  select count(*)::integer into current_questions
  from public.source_questions
  where origin = 'platform' and status = 'active';

  select count(*)::integer into current_tiebreakers
  from public.source_tiebreakers
  where status = 'active';

  return import_result || jsonb_build_object(
    'replacement', true,
    'archived_questions', archived_questions,
    'archived_tiebreakers', archived_tiebreakers,
    'active_questions', current_questions,
    'active_tiebreakers', current_tiebreakers
  );
end;
$$;

revoke all on function public.replace_question_library_batch(text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.replace_question_library_batch(text, text, jsonb, boolean)
  to service_role;

comment on function public.replace_question_library_batch(text, text, jsonb, boolean) is
  'Atomically imports one validated workbook as the complete platform library, archives omitted source rows, and optionally activates the incoming set without changing quiz or game snapshots.';

commit;
