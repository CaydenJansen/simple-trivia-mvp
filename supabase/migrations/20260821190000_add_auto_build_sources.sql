create table if not exists public.source_tiebreakers (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (length(btrim(prompt)) > 0),
  correct_value numeric not null,
  answer_unit text,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'active', 'archived')),
  is_verified boolean not null default false,
  last_reviewed_at timestamptz,
  import_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_tiebreakers_status_idx
  on public.source_tiebreakers (status, updated_at desc);

create or replace function public.touch_source_tiebreaker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists source_tiebreakers_touch_before_update
on public.source_tiebreakers;

create trigger source_tiebreakers_touch_before_update
before update on public.source_tiebreakers
for each row execute function public.touch_source_tiebreaker();

alter table public.source_tiebreakers enable row level security;

revoke all on table public.source_tiebreakers from anon;
grant select, insert, update, delete on table public.source_tiebreakers to authenticated;
grant all on table public.source_tiebreakers to service_role;

drop policy if exists "Hosts read active tiebreaker sources"
on public.source_tiebreakers;

create policy "Hosts read active tiebreaker sources"
on public.source_tiebreakers
for select
to authenticated
using (
  status = 'active'
  or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
);

drop policy if exists "Editors manage tiebreaker sources"
on public.source_tiebreakers;

create policy "Editors manage tiebreaker sources"
on public.source_tiebreakers
for all
to authenticated
using (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
)
with check (
  coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '')
    in ('admin', 'question_editor')
);

insert into public.source_questions (
  origin, owner_id, question_type, prompt, correct_answer, accepted_answers,
  category, difficulty, tags, status, is_verified, verified_at,
  last_reviewed_at, import_key
)
values
  ('platform', null, 'single-answer', 'What is the capital city of Australia?', '"Canberra"', '["Canberra"]', 'General Knowledge', 'Easy', array['countries', 'capitals'], 'active', true, now(), now(), 'starter-general-01'),
  ('platform', null, 'single-answer', 'How many sides does a hexagon have?', '"6"', '["six"]', 'General Knowledge', 'Easy', array['shapes', 'numbers'], 'active', true, now(), now(), 'starter-general-02'),
  ('platform', null, 'single-answer', 'Who wrote Romeo and Juliet?', '"William Shakespeare"', '["Shakespeare"]', 'General Knowledge', 'Easy', array['literature', 'authors'], 'active', true, now(), now(), 'starter-general-03'),
  ('platform', null, 'single-answer', 'What is the largest ocean on Earth?', '"Pacific Ocean"', '["Pacific", "the Pacific"]', 'General Knowledge', 'Easy', array['geography', 'oceans'], 'active', true, now(), now(), 'starter-general-04'),
  ('platform', null, 'single-answer', 'What is the chemical symbol for gold?', '"Au"', '["AU"]', 'General Knowledge', 'Medium', array['science', 'chemistry'], 'active', true, now(), now(), 'starter-general-05'),
  ('platform', null, 'single-answer', 'What is the smallest prime number?', '"2"', '["two"]', 'General Knowledge', 'Easy', array['maths', 'numbers'], 'active', true, now(), now(), 'starter-general-06'),
  ('platform', null, 'single-answer', 'What is the official language of Brazil?', '"Portuguese"', '["Brazilian Portuguese"]', 'General Knowledge', 'Easy', array['countries', 'languages'], 'active', true, now(), now(), 'starter-general-07'),
  ('platform', null, 'single-answer', 'What currency is used in Japan?', '"Japanese yen"', '["yen", "JPY"]', 'General Knowledge', 'Easy', array['countries', 'currency'], 'active', true, now(), now(), 'starter-general-08'),

  ('platform', null, 'single-answer', 'What was the highest-grossing film worldwide released in 1997?', '"Titanic"', '["Titanic"]', 'Movies', 'Easy', array['films', '1990s'], 'active', true, now(), now(), 'starter-movies-01'),
  ('platform', null, 'single-answer', 'Who directed Schindler''s List?', '"Steven Spielberg"', '["Spielberg"]', 'Movies', 'Medium', array['directors', 'awards'], 'active', true, now(), now(), 'starter-movies-02'),
  ('platform', null, 'single-answer', 'In what year was the first Star Wars film released?', '"1977"', '["1977"]', 'Movies', 'Easy', array['films', 'science fiction'], 'active', true, now(), now(), 'starter-movies-03'),
  ('platform', null, 'single-answer', 'Who plays Tony Stark in the Marvel Cinematic Universe?', '"Robert Downey Jr."', '["Robert Downey Junior", "RDJ"]', 'Movies', 'Easy', array['actors', 'Marvel'], 'active', true, now(), now(), 'starter-movies-04'),
  ('platform', null, 'single-answer', 'Which film features the line “You had me at hello”?', '"Jerry Maguire"', '["Jerry Maguire"]', 'Movies', 'Medium', array['quotes', '1990s'], 'active', true, now(), now(), 'starter-movies-05'),
  ('platform', null, 'single-answer', 'Which actor plays Indiana Jones in the original film series?', '"Harrison Ford"', '["Harrison Ford"]', 'Movies', 'Easy', array['actors', 'adventure'], 'active', true, now(), now(), 'starter-movies-06'),
  ('platform', null, 'single-answer', 'Who directed the animated film Spirited Away?', '"Hayao Miyazaki"', '["Miyazaki"]', 'Movies', 'Medium', array['animation', 'directors'], 'active', true, now(), now(), 'starter-movies-07'),
  ('platform', null, 'single-answer', 'The film Parasite was produced in which country?', '"South Korea"', '["Republic of Korea", "Korea"]', 'Movies', 'Medium', array['international cinema', 'awards'], 'active', true, now(), now(), 'starter-movies-08'),

  ('platform', null, 'single-answer', 'How many players from one basketball team are on the court at a time?', '"5"', '["five"]', 'Sport', 'Easy', array['basketball', 'rules'], 'active', true, now(), now(), 'starter-sport-01'),
  ('platform', null, 'single-answer', 'Which country won the 2018 FIFA World Cup?', '"France"', '["France"]', 'Sport', 'Medium', array['football', 'World Cup'], 'active', true, now(), now(), 'starter-sport-02'),
  ('platform', null, 'single-answer', 'In tennis, what is a score of 40–40 called?', '"Deuce"', '["deuce"]', 'Sport', 'Easy', array['tennis', 'scoring'], 'active', true, now(), now(), 'starter-sport-03'),
  ('platform', null, 'single-answer', 'What sport is played at Wimbledon?', '"Tennis"', '["tennis"]', 'Sport', 'Easy', array['tennis', 'events'], 'active', true, now(), now(), 'starter-sport-04'),
  ('platform', null, 'single-answer', 'How many rings are in the Olympic symbol?', '"5"', '["five"]', 'Sport', 'Easy', array['Olympics', 'symbols'], 'active', true, now(), now(), 'starter-sport-05'),
  ('platform', null, 'single-answer', 'How many points is a try worth in rugby union?', '"5"', '["five"]', 'Sport', 'Medium', array['rugby union', 'scoring'], 'active', true, now(), now(), 'starter-sport-06'),
  ('platform', null, 'single-answer', 'The Tour de France is contested in which sport?', '"Cycling"', '["road cycling", "bicycle racing"]', 'Sport', 'Easy', array['cycling', 'events'], 'active', true, now(), now(), 'starter-sport-07'),
  ('platform', null, 'single-answer', 'In cricket, how many wickets in three consecutive deliveries make a hat-trick?', '"3"', '["three"]', 'Sport', 'Medium', array['cricket', 'rules'], 'active', true, now(), now(), 'starter-sport-08'),

  ('platform', null, 'single-answer', 'Which band released Bohemian Rhapsody?', '"Queen"', '["Queen"]', 'Music', 'Easy', array['bands', 'songs'], 'active', true, now(), now(), 'starter-music-01'),
  ('platform', null, 'single-answer', 'How many strings does a standard guitar have?', '"6"', '["six"]', 'Music', 'Easy', array['instruments', 'guitar'], 'active', true, now(), now(), 'starter-music-02'),
  ('platform', null, 'single-answer', 'Who is widely known as the King of Pop?', '"Michael Jackson"', '["Jackson", "MJ"]', 'Music', 'Easy', array['artists', 'pop'], 'active', true, now(), now(), 'starter-music-03'),
  ('platform', null, 'single-answer', 'In what decade did hip-hop emerge as a genre?', '"1970s"', '["the 1970s", "seventies"]', 'Music', 'Medium', array['genres', 'history'], 'active', true, now(), now(), 'starter-music-04'),
  ('platform', null, 'single-answer', 'Which composer wrote The Four Seasons?', '"Antonio Vivaldi"', '["Vivaldi"]', 'Music', 'Medium', array['classical', 'composers'], 'active', true, now(), now(), 'starter-music-05'),
  ('platform', null, 'single-answer', 'How many keys does a standard piano have?', '"88"', '["eighty-eight", "eighty eight"]', 'Music', 'Easy', array['instruments', 'piano'], 'active', true, now(), now(), 'starter-music-06'),
  ('platform', null, 'single-answer', 'Which English city were the Beatles formed in?', '"Liverpool"', '["Liverpool"]', 'Music', 'Easy', array['bands', 'cities'], 'active', true, now(), now(), 'starter-music-07'),
  ('platform', null, 'single-answer', 'What is another name for the treble clef?', '"G clef"', '["G-clef", "the G clef"]', 'Music', 'Medium', array['notation', 'theory'], 'active', true, now(), now(), 'starter-music-08')
on conflict (origin, import_key) where import_key is not null do nothing;

insert into public.source_tiebreakers (
  prompt, correct_value, answer_unit, notes, status, is_verified,
  last_reviewed_at, import_key
)
values
  ('Approximately how many kilometres long is the Great Wall of China?', 21196, 'kilometres', 'Use the total length reported by China’s State Administration of Cultural Heritage.', 'active', true, now(), 'starter-tie-01'),
  ('What is the average distance from Earth to the Moon in kilometres?', 384400, 'kilometres', 'Use the commonly cited average centre-to-centre distance.', 'active', true, now(), 'starter-tie-02'),
  ('Approximately what is the total area of Australia in square kilometres?', 7692024, 'square kilometres', 'Use the total area published by Geoscience Australia.', 'active', true, now(), 'starter-tie-03'),
  ('What is the official height of Mount Everest in metres?', 8848.86, 'metres', 'Use the 2020 jointly announced Nepal–China height.', 'active', true, now(), 'starter-tie-04'),
  ('How many keys are on a standard modern piano?', 88, 'keys', null, 'active', true, now(), 'starter-tie-05'),
  ('How many bones are typically in an adult human skeleton?', 206, 'bones', null, 'active', true, now(), 'starter-tie-06')
on conflict (import_key) do nothing;

comment on table public.source_tiebreakers is
  'Platform-owned prepared closest-answer source records used by Auto-Build. Quiz and game copies remain independent snapshots.';
