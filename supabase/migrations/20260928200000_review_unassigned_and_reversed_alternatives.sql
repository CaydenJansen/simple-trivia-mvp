begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
alter table public.question_answer_suggestions drop constraint question_answer_suggestions_answer_slot_check;
alter table public.question_answer_suggestions add constraint question_answer_suggestions_answer_slot_check check (answer_slot >= -1);
create or replace function public.record_host_answer_override(
  p_submission_id uuid,
  p_answer_slot integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_submission public.submissions%rowtype;
  selected_question public.game_questions%rowtype;
  selected_source public.source_questions%rowtype;
  grading_item jsonb;
  proposed text;
  expected text;
  resolved_answer_slot integer;
  normalized text;
  recorded_suggestion_id uuid;
  host_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_answer_slot < 0 then raise exception 'Answer slot must be zero or greater'; end if;

  select submissions.* into selected_submission
  from public.submissions
  join public.games on games.id = submissions.game_id
  join public.quizzes on quizzes.id = games.quiz_id
  where submissions.id = p_submission_id
    and quizzes.owner_id = auth.uid();
  if selected_submission.id is null then raise exception 'Submission not found or not owned by current host'; end if;

  select * into selected_question from public.game_questions
  where game_id = selected_submission.game_id
    and question_key = selected_submission.question_key;
  if selected_question.source_question_id is null
     or not public.question_snapshot_matches_source(selected_submission.game_id, selected_submission.question_key) then
    return null;
  end if;

  select * into selected_source from public.source_questions
  where id = selected_question.source_question_id and origin = 'platform';
  if selected_source.id is null
     or selected_question.question_type not in ('single-answer', 'image-question', 'multi-answer', 'multi-part') then
    return null;
  end if;

  grading_item := selected_submission.grading_json->'items'->p_answer_slot;
  if grading_item is null or grading_item->>'status' <> 'correct' then return null; end if;
  proposed := btrim(coalesce(grading_item->>'submitted', ''));
  expected := nullif(btrim(coalesce(grading_item->>'expected', '')), '');
  normalized := public.normalise_answer_signal(proposed);
  if normalized = '' then return null; end if;

  if selected_question.question_type = 'multi-answer' then
    -- -1 is an explicitly unassigned alternative; an admin must choose its slot.
    select answer.ordinality::integer - 1 into resolved_answer_slot
    from jsonb_array_elements_text(selected_source.correct_answer)
      with ordinality as answer(value, ordinality)
    where public.normalise_answer_signal(answer.value) = public.normalise_answer_signal(expected)
    order by answer.ordinality
    limit 1;
    resolved_answer_slot := coalesce(resolved_answer_slot, -1);
  elsif selected_question.question_type = 'multi-part' then
    resolved_answer_slot := p_answer_slot;
  else
    resolved_answer_slot := 0;
  end if;

  -- Exact answers and already-approved aliases do not need editorial review.
  if normalized = public.normalise_answer_signal(coalesce(expected, selected_source.correct_answer #>> '{}'))
     or exists (
       select 1 from jsonb_array_elements_text(
         case
           when selected_question.question_type in ('multi-part', 'multi-answer')
             then coalesce(selected_source.accepted_answers->resolved_answer_slot, '[]'::jsonb)
           else selected_source.accepted_answers
         end
       ) alias
       where public.normalise_answer_signal(alias) = normalized
     ) then
    return null;
  end if;

  insert into public.question_answer_suggestions (
    source_question_id, source_revision, answer_slot,
    proposed_answer, normalized_answer, expected_answer
  ) values (
    selected_source.id, selected_source.revision, resolved_answer_slot,
    proposed, normalized, expected
  )
  on conflict (source_question_id, source_revision, answer_slot, normalized_answer)
  do update set proposed_answer = excluded.proposed_answer, updated_at = now()
  returning id into recorded_suggestion_id;

  insert into public.question_answer_suggestion_signals (
    suggestion_id, host_id, game_id, submission_id
  ) values (recorded_suggestion_id, auth.uid(), selected_submission.game_id, selected_submission.id)
  on conflict (suggestion_id, host_id) do update set
    game_id = excluded.game_id,
    submission_id = excluded.submission_id,
    last_seen_at = now();

  select count(distinct host_id)::integer into host_count
  from public.question_answer_suggestion_signals
  where question_answer_suggestion_signals.suggestion_id = recorded_suggestion_id;

  update public.question_answer_suggestions
  set status = case when host_count >= 3 and status = 'collecting' then 'pending' else status end,
      updated_at = now()
  where id = recorded_suggestion_id;

  return recorded_suggestion_id;
end;
$$;
create or replace function public.review_answer_suggestion_with_slot(p_suggestion_id uuid, p_decision text, p_note text default null, p_answer_slot integer default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  suggestion public.question_answer_suggestions%rowtype;
  source public.source_questions%rowtype;
  aliases jsonb;
  slot_aliases jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into suggestion from public.question_answer_suggestions where id = p_suggestion_id for update;
  if suggestion.id is null then raise exception 'Suggestion not found'; end if;
  if suggestion.status not in ('pending', 'collecting') then raise exception 'Suggestion has already been reviewed'; end if;
  select * into source from public.source_questions where id = suggestion.source_question_id for update;
  if source.id is null or source.revision <> suggestion.source_revision then
    update public.question_answer_suggestions set status = 'stale', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note, updated_at = now() where id = suggestion.id;
    return 'stale';
  end if;
  if p_decision = 'approved' and suggestion.answer_slot=-1 then
    if p_answer_slot is null then raise exception 'Choose the matching answer before approving this alternative'; end if;
    suggestion.answer_slot:=p_answer_slot;
  end if;
  if p_decision = 'approved' then
    aliases := case when jsonb_typeof(source.accepted_answers) = 'array' then source.accepted_answers else '[]'::jsonb end;
    if source.question_type in ('single-answer', 'image-question') then
      if not exists(select 1 from jsonb_array_elements_text(aliases) alias where public.normalise_answer_signal(alias) = suggestion.normalized_answer) then
        aliases := aliases || to_jsonb(suggestion.proposed_answer);
      end if;
    elsif source.question_type in ('multi-answer', 'multi-part') then
      if suggestion.answer_slot < 0 or jsonb_typeof(source.correct_answer) <> 'array'
        or suggestion.answer_slot >= jsonb_array_length(source.correct_answer) then
        raise exception 'Answer slot is outside this question';
      end if;
      while jsonb_array_length(aliases) <= suggestion.answer_slot loop
        aliases := aliases || jsonb_build_array('[]'::jsonb);
      end loop;
      slot_aliases := aliases->suggestion.answer_slot;
      if jsonb_typeof(slot_aliases) <> 'array' then slot_aliases := '[]'::jsonb; end if;
      if not exists(select 1 from jsonb_array_elements_text(slot_aliases) alias where public.normalise_answer_signal(alias) = suggestion.normalized_answer) then
        slot_aliases := slot_aliases || to_jsonb(suggestion.proposed_answer);
      end if;
      aliases := jsonb_set(aliases, array[suggestion.answer_slot::text], slot_aliases, true);
      if source.question_type = 'multi-part' then
        update public.source_question_parts set accepted_answers = slot_aliases
        where source_question_id = source.id and position = suggestion.answer_slot + 1;
      end if;
    else
      raise exception 'This question type does not support accepted-answer alternatives';
    end if;
    update public.source_questions set accepted_answers = aliases where id = source.id;
  end if;
  update public.question_answer_suggestions set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid(),
    review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = suggestion.id;
  insert into public.platform_admin_audit_log(admin_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'answer_suggestion_' || p_decision, 'question_answer_suggestion', suggestion.id,
    jsonb_build_object('source_question_id', source.id, 'proposed_answer', suggestion.proposed_answer, 'answer_slot', suggestion.answer_slot));
  return p_decision;
end;
$$;
revoke all on function public.review_answer_suggestion_with_slot(uuid,text,text,integer) from public,anon;
grant execute on function public.review_answer_suggestion_with_slot(uuid,text,text,integer) to authenticated;

create or replace function public.review_answer_suggestion(p_suggestion_id uuid,p_decision text,p_note text default null)
returns text language sql security invoker set search_path='' as $$
  select public.review_answer_suggestion_with_slot(p_suggestion_id,p_decision,p_note,null);
$$;

create or replace function public.retract_reversed_answer_signals()
returns trigger language plpgsql security definer set search_path='' as $$
declare suggestion_id_value uuid;
begin
  for suggestion_id_value in
    delete from public.question_answer_suggestion_signals signals
    using public.question_answer_suggestions suggestions
    where signals.suggestion_id=suggestions.id and signals.submission_id=new.id
      and not exists(select 1 from jsonb_array_elements(coalesce(new.grading_json->'items','[]'::jsonb)) item
        where item->>'status'='correct' and public.normalise_answer_signal(item->>'submitted')=suggestions.normalized_answer)
    returning signals.suggestion_id
  loop
    update public.question_answer_suggestions set status='collecting',updated_at=now()
    where id=suggestion_id_value and status='pending'
      and (select count(distinct host_id) from public.question_answer_suggestion_signals where suggestion_id=suggestion_id_value)<3;
  end loop;
  return new;
end;
$$;
revoke all on function public.retract_reversed_answer_signals() from public,anon,authenticated;
create trigger retract_reversed_answer_signals after update of grading_json on public.submissions
for each row execute function public.retract_reversed_answer_signals();
commit;
