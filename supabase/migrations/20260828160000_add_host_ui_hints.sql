begin;

alter table public.host_preferences
  add column if not exists ui_hints jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ui_hints) = 'object');

comment on column public.host_preferences.ui_hints is
  'Owner-scoped durable acknowledgements for one-time host guidance; kept separate from game defaults.';

commit;
