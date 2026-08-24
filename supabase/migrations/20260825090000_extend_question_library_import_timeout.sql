-- Question Library workbook imports are intentionally atomic and can contain
-- thousands of normalized question components. Give only this private import
-- RPC enough time to finish while leaving ordinary API timeouts unchanged.
alter function public.import_question_library_batch(text, text, jsonb)
  set statement_timeout = '60s';

comment on function public.import_question_library_batch(text, text, jsonb) is
  'Service-role-only atomic Question Library workbook import with a function-scoped 60-second timeout.';
