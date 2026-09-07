begin;

do $publish$
declare
  batch_payload jsonb;
  published_questions integer;
  published_tiebreakers integer;
begin
  select normalized_payload
  into batch_payload
  from public.question_library_import_batches
  where file_sha256 = 'f7acafcaa14367cd0ee765297539fcac1c4ec78a8109fb0d00633549c1c0532e';

  if batch_payload is null then
    raise exception 'Batch 4 import is missing; publication aborted';
  end if;

  update public.source_questions
  set
    status = 'active',
    is_verified = true,
    verified_at = coalesce(verified_at, now()),
    last_reviewed_at = now(),
    updated_at = now()
  where origin = 'platform'
    and exists (
      select 1
      from jsonb_array_elements(batch_payload->'questions') as incoming(value)
      where incoming.value->>'importKey' = source_questions.import_key
    );
  get diagnostics published_questions = row_count;

  update public.source_tiebreakers
  set
    status = 'active',
    is_verified = true,
    last_reviewed_at = now(),
    updated_at = now()
  where exists (
    select 1
    from jsonb_array_elements(batch_payload->'tiebreakers') as incoming(value)
    where incoming.value->>'importKey' = source_tiebreakers.import_key
  );
  get diagnostics published_tiebreakers = row_count;

  if published_questions <> 500 or published_tiebreakers <> 20 then
    raise exception
      'Batch 4 publication count mismatch: % questions, % tiebreakers',
      published_questions,
      published_tiebreakers;
  end if;
end;
$publish$;

commit;
