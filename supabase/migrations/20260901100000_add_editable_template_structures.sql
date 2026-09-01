begin;

alter table public.quiz_templates
  add column if not exists structure jsonb;

comment on column public.quiz_templates.structure is
  'Independent editable show blueprint. Ordinary questions are stored as typed slots; content, games and tiebreakers remain concrete.';

commit;
