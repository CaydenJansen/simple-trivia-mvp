begin;

create table public.personal_question_create_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  source_question_id uuid not null references public.source_questions(id) on delete cascade,
  payload_hash text not null,
  primary key(owner_id,operation_id)
);
alter table public.personal_question_create_requests enable row level security;
revoke all on public.personal_question_create_requests from public,anon,authenticated;
grant select,insert on public.personal_question_create_requests to authenticated;
create policy "Owners read personal question save receipts" on public.personal_question_create_requests for select to authenticated using(owner_id=auth.uid());
create policy "Owners create personal question save receipts" on public.personal_question_create_requests for insert to authenticated with check(owner_id=auth.uid() and exists(select 1 from public.source_questions sq where sq.id=source_question_id and sq.owner_id=auth.uid()));

create or replace function public.save_my_question_with_inherited_metadata(
  p_question_id uuid,
  p_question jsonb,
  p_primary_category_id uuid default null,
  p_secondary_category_ids uuid[] default '{}'::uuid[],
  p_tag_ids uuid[] default '{}'::uuid[],
  p_bonus jsonb default '{"preserve_existing": true}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_question_id uuid;
  previous public.source_questions%rowtype;
  operation uuid;
  fingerprint text;
  prior public.personal_question_create_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_question_id is not null then
    select * into previous from public.source_questions where id=p_question_id and origin='user' and owner_id=auth.uid() for update;
    if not found then raise exception 'Question not found or not owned by current host'; end if;
    if nullif(p_question->>'_expected_revision','')::integer is distinct from previous.revision then
      raise exception 'This question changed in another tab. Reload it before saving.';
    end if;
    p_question:=to_jsonb(previous)||p_question;
  else
    operation:=nullif(p_question->>'_operation_id','')::uuid;
    if operation is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||operation::text,0));
      fingerprint:=md5(jsonb_build_object('question',p_question-'_operation_id','primary',p_primary_category_id,'secondary',p_secondary_category_ids,'tags',p_tag_ids,'bonus',p_bonus)::text);
      select * into prior from public.personal_question_create_requests where owner_id=auth.uid() and operation_id=operation;
      if found then
        if prior.payload_hash<>fingerprint then raise exception 'The previous save succeeded. Reopen that question from My Questions to edit it.'; end if;
        return prior.source_question_id;
      end if;
    end if;
  end if;
  saved_question_id := public.save_my_question_with_metadata(
    p_question_id, p_question, p_primary_category_id,
    p_secondary_category_ids, p_tag_ids, p_bonus
  );

  update public.source_questions
  set audience_suitability = coalesce(nullif(p_question->>'audience_suitability', ''), 'general'),
      audience_scope = coalesce(nullif(p_question->>'audience_scope', ''), 'global'),
      audience_locale = case
        when coalesce(nullif(p_question->>'audience_scope', ''), 'global') = 'country_specific'
          then nullif(btrim(p_question->>'audience_locale'), '')
        else null
      end,
      content_flags = coalesce(array(
        select jsonb_array_elements_text(coalesce(p_question->'content_flags', '[]'::jsonb))
      ), '{}'::text[])
  where id = saved_question_id;

  if p_bonus is not null
    and jsonb_typeof(p_bonus) = 'object'
    and not coalesce((p_bonus->>'preserve_existing')::boolean, false) then
    update public.source_question_bonuses
    set stability = nullif(p_bonus->>'stability', ''),
        audience_suitability = nullif(p_bonus->>'audience_suitability', ''),
        audience_scope = nullif(p_bonus->>'audience_scope', ''),
        audience_locale = case
          when p_bonus->>'audience_scope' = 'country_specific'
            then nullif(btrim(p_bonus->>'audience_locale'), '')
          else null
        end,
        content_flags = case
          when p_bonus->'content_flags' is null or jsonb_typeof(p_bonus->'content_flags') = 'null' then null
          else array(select jsonb_array_elements_text(p_bonus->'content_flags'))
        end
    where source_question_id = saved_question_id;
  end if;

  if p_question_id is null and operation is not null then
    insert into public.personal_question_create_requests(owner_id,operation_id,source_question_id,payload_hash)
    values(auth.uid(),operation,saved_question_id,fingerprint);
  end if;
  return saved_question_id;
end;
$$;

commit;

