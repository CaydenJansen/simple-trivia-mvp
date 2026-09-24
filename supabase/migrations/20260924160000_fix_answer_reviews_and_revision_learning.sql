begin;

-- Learning is revision-specific: new library content starts with editorial
-- difficulty until enough teams have played that version. Keep historical data.
create or replace function public.touch_source_question()
returns trigger language plpgsql set search_path = '' as $$
declare
  editorial_changed boolean;
  observed_changed boolean;
begin
  editorial_changed := (to_jsonb(new) - array['revision', 'updated_at', 'observed_difficulty', 'observed_sample_size', 'observed_correct_rate', 'observed_updated_at'])
    is distinct from (to_jsonb(old) - array['revision', 'updated_at', 'observed_difficulty', 'observed_sample_size', 'observed_correct_rate', 'observed_updated_at']);
  observed_changed := row(new.observed_difficulty, new.observed_sample_size, new.observed_correct_rate, new.observed_updated_at)
    is distinct from row(old.observed_difficulty, old.observed_sample_size, old.observed_correct_rate, old.observed_updated_at);
  if editorial_changed or (not observed_changed and new.updated_at is distinct from old.updated_at) then
    new.revision := greatest(coalesce(new.revision, old.revision), old.revision + 1);
    new.observed_difficulty := null;
    new.observed_sample_size := 0;
    new.observed_correct_rate := null;
    new.observed_updated_at := null;
  else
    new.revision := old.revision;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.refresh_question_observed_difficulty(p_source_question_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sample_count integer;
  correct_rate numeric;
  current_revision integer;
begin
  select revision into current_revision from public.source_questions where id = p_source_question_id for update;
  if not found then return; end if;
  select count(*)::integer, coalesce(sum(correct_items)::numeric / nullif(sum(total_items), 0), 0)
  into sample_count, correct_rate from public.question_performance_events
  where source_question_id = p_source_question_id and source_revision = current_revision;
  update public.source_questions set
    observed_sample_size = sample_count,
    observed_correct_rate = case when sample_count = 0 then null else correct_rate end,
    observed_difficulty = case when sample_count < 20 then null
      when correct_rate >= 0.80 then 1 when correct_rate >= 0.65 then 2
      when correct_rate >= 0.45 then 3 when correct_rate >= 0.30 then 4 else 5 end,
    observed_updated_at = clock_timestamp()
  where id = p_source_question_id;
end;
$$;

-- Empty arrays must be appended as elements, not concatenated (which appends
-- nothing and used to leave this loop running until the request timed out).
create or replace function public.review_answer_suggestion(p_suggestion_id uuid, p_decision text, p_note text default null)
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
    jsonb_build_object('source_question_id', source.id, 'proposed_answer', suggestion.proposed_answer));
  return p_decision;
end;
$$;

revoke all on function public.refresh_question_observed_difficulty(uuid) from public, anon, authenticated;
revoke all on function public.review_answer_suggestion(uuid, text, text) from public, anon;
grant execute on function public.review_answer_suggestion(uuid, text, text) to authenticated;

-- Repair any aggregates that currently mix old and new versions.
do $$ declare source_id uuid; begin
  for source_id in select id from public.source_questions where observed_sample_size > 0 loop
    perform public.refresh_question_observed_difficulty(source_id);
  end loop;
end $$;

commit;
