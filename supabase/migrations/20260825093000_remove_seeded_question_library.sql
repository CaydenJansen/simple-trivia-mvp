begin;

-- The production Question Library is now supplied by the reviewed archive.
-- Remove the early demonstration records while preserving independent quiz
-- snapshots; quiz_questions.source_question_id uses ON DELETE SET NULL.
delete from public.source_questions
where origin = 'platform'
  and (
    import_key like 'library-v2-%'
    or import_key like 'starter-%'
  );

commit;
