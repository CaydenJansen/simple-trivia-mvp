alter table public.games
  add column if not exists current_content_screen_key text;

comment on column public.games.current_content_screen_key is
  'Identifies the frozen game content screen shown when current_screen is content-screen.';
