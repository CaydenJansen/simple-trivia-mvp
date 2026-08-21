begin;

with additions (
  prompt,
  answer,
  accepted_answers,
  category,
  difficulty,
  tags,
  import_key
) as (
  values
    -- General Knowledge: Very Easy
    ('Which planet is known as the Red Planet?', 'Mars', array['Mars'], 'General Knowledge', 'Very Easy', array['space', 'planets'], 'library-v2-general-ve-01'),
    ('What is the largest planet in our Solar System?', 'Jupiter', array['Jupiter'], 'General Knowledge', 'Very Easy', array['space', 'planets'], 'library-v2-general-ve-02'),
    ('At what temperature does water freeze on the Celsius scale?', '0 degrees Celsius', array['0', 'zero', '0 degrees', '0°C', 'zero degrees Celsius'], 'General Knowledge', 'Very Easy', array['science', 'temperature'], 'library-v2-general-ve-03'),
    ('How many continents are there?', '7', array['7', 'seven'], 'General Knowledge', 'Very Easy', array['geography', 'continents'], 'library-v2-general-ve-04'),
    ('What currency is used in the United Kingdom?', 'Pound sterling', array['pound sterling', 'British pound', 'pounds', 'GBP'], 'General Knowledge', 'Very Easy', array['countries', 'currency'], 'library-v2-general-ve-05'),
    ('Who wrote the Harry Potter book series?', 'J. K. Rowling', array['J. K. Rowling', 'JK Rowling', 'J K Rowling', 'Rowling'], 'General Knowledge', 'Very Easy', array['books', 'authors'], 'library-v2-general-ve-06'),

    -- General Knowledge: Hard
    ('What is the capital of Slovenia?', 'Ljubljana', array['Ljubljana'], 'General Knowledge', 'Hard', array['countries', 'capitals'], 'library-v2-general-hard-01'),
    ('Which chemical element has the symbol W?', 'Tungsten', array['Tungsten', 'Wolfram'], 'General Knowledge', 'Hard', array['science', 'chemistry'], 'library-v2-general-hard-02'),
    ('Who painted The Night Watch?', 'Rembrandt', array['Rembrandt', 'Rembrandt van Rijn'], 'General Knowledge', 'Hard', array['art', 'painters'], 'library-v2-general-hard-03'),
    ('What is the deepest lake in the world?', 'Lake Baikal', array['Lake Baikal', 'Baikal'], 'General Knowledge', 'Hard', array['geography', 'lakes'], 'library-v2-general-hard-04'),
    ('In what year was the Treaty of Versailles signed?', '1919', array['1919'], 'General Knowledge', 'Hard', array['history', 'treaties'], 'library-v2-general-hard-05'),
    ('What is the smallest bone in the human body?', 'The stapes', array['stapes', 'the stapes', 'stirrup bone'], 'General Knowledge', 'Hard', array['science', 'anatomy'], 'library-v2-general-hard-06'),

    -- General Knowledge: Very Hard
    ('What is the capital of Burkina Faso?', 'Ouagadougou', array['Ouagadougou'], 'General Knowledge', 'Very Hard', array['countries', 'capitals'], 'library-v2-general-vh-01'),
    ('What is the currency of Madagascar?', 'Ariary', array['ariary', 'Malagasy ariary'], 'General Knowledge', 'Very Hard', array['countries', 'currency'], 'library-v2-general-vh-02'),
    ('Which modern country was formerly known as Abyssinia?', 'Ethiopia', array['Ethiopia'], 'General Knowledge', 'Very Hard', array['countries', 'history'], 'library-v2-general-vh-03'),
    ('What is the largest desert on Earth?', 'Antarctica', array['Antarctica', 'Antarctic Desert', 'the Antarctic'], 'General Knowledge', 'Very Hard', array['geography', 'deserts'], 'library-v2-general-vh-04'),
    ('Which element has atomic number 92?', 'Uranium', array['Uranium'], 'General Knowledge', 'Very Hard', array['science', 'chemistry'], 'library-v2-general-vh-05'),
    ('Which sea has no land boundaries?', 'Sargasso Sea', array['Sargasso Sea', 'the Sargasso Sea'], 'General Knowledge', 'Very Hard', array['geography', 'oceans'], 'library-v2-general-vh-06'),

    -- Movies: Very Easy
    ('What is the name of the snowman in Frozen?', 'Olaf', array['Olaf'], 'Movies', 'Very Easy', array['animation', 'Disney'], 'library-v2-movies-ve-01'),
    ('Which sport does Rocky Balboa compete in?', 'Boxing', array['Boxing'], 'Movies', 'Very Easy', array['films', 'sport'], 'library-v2-movies-ve-02'),
    ('What kind of creature is Shrek?', 'An ogre', array['ogre', 'an ogre'], 'Movies', 'Very Easy', array['animation', 'characters'], 'library-v2-movies-ve-03'),
    ('What colour is the brick road in The Wizard of Oz?', 'Yellow', array['Yellow'], 'Movies', 'Very Easy', array['classic films', 'fantasy'], 'library-v2-movies-ve-04'),
    ('What animals are brought back to life in Jurassic Park?', 'Dinosaurs', array['Dinosaurs'], 'Movies', 'Very Easy', array['films', 'science fiction'], 'library-v2-movies-ve-05'),
    ('What type of fish is Nemo in Finding Nemo?', 'A clownfish', array['clownfish', 'a clownfish'], 'Movies', 'Very Easy', array['animation', 'characters'], 'library-v2-movies-ve-06'),

    -- Movies: Hard
    ('Most of 12 Angry Men takes place in what kind of room?', 'A jury room', array['jury room', 'a jury room', 'jury deliberation room'], 'Movies', 'Hard', array['classic films', 'settings'], 'library-v2-movies-hard-01'),
    ('Who directed Seven Samurai?', 'Akira Kurosawa', array['Akira Kurosawa', 'Kurosawa'], 'Movies', 'Hard', array['directors', 'Japanese cinema'], 'library-v2-movies-hard-02'),
    ('Which film won the first Academy Award for Best Picture?', 'Wings', array['Wings'], 'Movies', 'Hard', array['awards', 'classic films'], 'library-v2-movies-hard-03'),
    ('Blade Runner is based on which Philip K. Dick novel?', 'Do Androids Dream of Electric Sheep?', array['Do Androids Dream of Electric Sheep?', 'Do Androids Dream of Electric Sheep'], 'Movies', 'Hard', array['adaptations', 'science fiction'], 'library-v2-movies-hard-04'),
    ('Who directed This Is Spinal Tap?', 'Rob Reiner', array['Rob Reiner', 'Reiner'], 'Movies', 'Hard', array['directors', 'comedy'], 'library-v2-movies-hard-05'),
    ('What fictional island town is terrorised by the shark in Jaws?', 'Amity Island', array['Amity Island', 'Amity'], 'Movies', 'Hard', array['films', 'settings'], 'library-v2-movies-hard-06'),

    -- Movies: Very Hard
    ('What is the name of Charles Foster Kane''s estate in Citizen Kane?', 'Xanadu', array['Xanadu'], 'Movies', 'Very Hard', array['classic films', 'settings'], 'library-v2-movies-vh-01'),
    ('Who directed The 400 Blows?', 'François Truffaut', array['François Truffaut', 'Francois Truffaut', 'Truffaut'], 'Movies', 'Very Hard', array['directors', 'French cinema'], 'library-v2-movies-vh-02'),
    ('Who directed the 1966 film Persona?', 'Ingmar Bergman', array['Ingmar Bergman', 'Bergman'], 'Movies', 'Very Hard', array['directors', 'Swedish cinema'], 'library-v2-movies-vh-03'),
    ('Who directed the 1927 film Metropolis?', 'Fritz Lang', array['Fritz Lang', 'Lang'], 'Movies', 'Very Hard', array['directors', 'silent film'], 'library-v2-movies-vh-04'),
    ('Who directed Bicycle Thieves?', 'Vittorio De Sica', array['Vittorio De Sica', 'De Sica'], 'Movies', 'Very Hard', array['directors', 'Italian cinema'], 'library-v2-movies-vh-05'),
    ('Who directed Battleship Potemkin?', 'Sergei Eisenstein', array['Sergei Eisenstein', 'Eisenstein'], 'Movies', 'Very Hard', array['directors', 'silent film'], 'library-v2-movies-vh-06'),

    -- Sport: Very Easy
    ('How many players are on the field for each team when a soccer match begins at full strength?', '11', array['11', 'eleven'], 'Sport', 'Very Easy', array['football', 'rules'], 'library-v2-sport-ve-01'),
    ('How many points is a successful free throw worth in basketball?', '1', array['1', 'one', 'one point'], 'Sport', 'Very Easy', array['basketball', 'scoring'], 'library-v2-sport-ve-02'),
    ('In golf, what is the term for one stroke under par on a hole?', 'Birdie', array['Birdie'], 'Sport', 'Very Easy', array['golf', 'scoring'], 'library-v2-sport-ve-03'),
    ('What is the official marathon distance in kilometres?', '42.195 kilometres', array['42.195', '42.195 kilometres', '42.195 km'], 'Sport', 'Very Easy', array['athletics', 'distance'], 'library-v2-sport-ve-04'),
    ('What piece of equipment does a cricket batter use to hit the ball?', 'A bat', array['bat', 'a bat', 'cricket bat'], 'Sport', 'Very Easy', array['cricket', 'equipment'], 'library-v2-sport-ve-05'),
    ('In baseball, what is it called when a batter hits the ball out of the park in fair territory?', 'Home run', array['home run', 'a home run', 'homer'], 'Sport', 'Very Easy', array['baseball', 'scoring'], 'library-v2-sport-ve-06'),

    -- Sport: Hard
    ('Which sport awards the Webb Ellis Cup to its world champions?', 'Rugby union', array['rugby union', 'rugby'], 'Sport', 'Hard', array['rugby union', 'trophies'], 'library-v2-sport-hard-01'),
    ('What colour jersey is worn by the overall leader of the Tour de France?', 'Yellow', array['Yellow', 'yellow jersey', 'maillot jaune'], 'Sport', 'Hard', array['cycling', 'Tour de France'], 'library-v2-sport-hard-02'),
    ('The Davis Cup is an international team competition in which sport?', 'Tennis', array['Tennis'], 'Sport', 'Hard', array['tennis', 'competitions'], 'library-v2-sport-hard-03'),
    ('Which two countries contest cricket''s Ashes series?', 'England and Australia', array['England and Australia', 'Australia and England'], 'Sport', 'Hard', array['cricket', 'competitions'], 'library-v2-sport-hard-04'),
    ('What is the name of the street circuit used for the Monaco Grand Prix?', 'Circuit de Monaco', array['Circuit de Monaco', 'Monaco Circuit', 'Monte Carlo circuit'], 'Sport', 'Hard', array['motorsport', 'Formula One'], 'library-v2-sport-hard-05'),
    ('What is the regulation distance from a Major League Baseball pitching rubber to home plate?', '60 feet 6 inches', array['60 feet 6 inches', '60 ft 6 in', '60''6"'], 'Sport', 'Hard', array['baseball', 'dimensions'], 'library-v2-sport-hard-06'),

    -- Sport: Very Hard
    ('What is the maximum standard break in snooker?', '147', array['147', 'one hundred and forty-seven'], 'Sport', 'Very Hard', array['snooker', 'scoring'], 'library-v2-sport-vh-01'),
    ('The Claret Jug is awarded to the winner of which golf tournament?', 'The Open Championship', array['The Open Championship', 'The Open', 'British Open'], 'Sport', 'Very Hard', array['golf', 'trophies'], 'library-v2-sport-vh-02'),
    ('The Fosbury Flop is a technique used in which athletics event?', 'High jump', array['high jump', 'the high jump'], 'Sport', 'Very Hard', array['athletics', 'technique'], 'library-v2-sport-vh-03'),
    ('Which one-day cycling race is nicknamed the Hell of the North?', 'Paris–Roubaix', array['Paris–Roubaix', 'Paris-Roubaix'], 'Sport', 'Very Hard', array['cycling', 'races'], 'library-v2-sport-vh-04'),
    ('Which method is used to revise targets in rain-affected limited-overs cricket matches?', 'Duckworth–Lewis–Stern method', array['Duckworth–Lewis–Stern method', 'Duckworth-Lewis-Stern', 'DLS method', 'DLS'], 'Sport', 'Very Hard', array['cricket', 'rules'], 'library-v2-sport-vh-05'),
    ('What is the men''s singles trophy at the French Open called?', 'Coupe des Mousquetaires', array['Coupe des Mousquetaires', 'Musketeers Cup'], 'Sport', 'Very Hard', array['tennis', 'trophies'], 'library-v2-sport-vh-06'),

    -- Music: Very Easy
    ('How many strings does a standard violin have?', '4', array['4', 'four'], 'Music', 'Very Easy', array['instruments', 'violin'], 'library-v2-music-ve-01'),
    ('Reggae music originated in which country?', 'Jamaica', array['Jamaica'], 'Music', 'Very Easy', array['genres', 'countries'], 'library-v2-music-ve-02'),
    ('Who composed Für Elise?', 'Ludwig van Beethoven', array['Ludwig van Beethoven', 'Beethoven'], 'Music', 'Very Easy', array['classical', 'composers'], 'library-v2-music-ve-03'),
    ('Beyoncé was a member of which girl group?', 'Destiny''s Child', array['Destiny''s Child', 'Destinys Child'], 'Music', 'Very Easy', array['artists', 'groups'], 'library-v2-music-ve-04'),
    ('Which instrument has black and white keys and is played using a keyboard?', 'Piano', array['Piano', 'a piano'], 'Music', 'Very Easy', array['instruments', 'piano'], 'library-v2-music-ve-05'),
    ('Who sang Rolling in the Deep?', 'Adele', array['Adele'], 'Music', 'Very Easy', array['artists', 'songs'], 'library-v2-music-ve-06'),

    -- Music: Hard
    ('Which band released the album Rumours?', 'Fleetwood Mac', array['Fleetwood Mac'], 'Music', 'Hard', array['albums', 'bands'], 'library-v2-music-hard-01'),
    ('Who released the album Purple Rain?', 'Prince', array['Prince'], 'Music', 'Hard', array['albums', 'artists'], 'library-v2-music-hard-02'),
    ('Which jazz trumpeter released Kind of Blue?', 'Miles Davis', array['Miles Davis', 'Davis'], 'Music', 'Hard', array['jazz', 'albums'], 'library-v2-music-hard-03'),
    ('Which band released the album London Calling?', 'The Clash', array['The Clash', 'Clash'], 'Music', 'Hard', array['albums', 'bands'], 'library-v2-music-hard-04'),
    ('Who recorded the song Superstition?', 'Stevie Wonder', array['Stevie Wonder', 'Wonder'], 'Music', 'Hard', array['artists', 'songs'], 'library-v2-music-hard-05'),
    ('Who released the 1971 album Blue?', 'Joni Mitchell', array['Joni Mitchell', 'Mitchell'], 'Music', 'Hard', array['albums', 'artists'], 'library-v2-music-hard-06'),

    -- Music: Very Hard
    ('The catalogue abbreviation BWV is used for the works of which composer?', 'Johann Sebastian Bach', array['Johann Sebastian Bach', 'J. S. Bach', 'JS Bach', 'Bach'], 'Music', 'Very Hard', array['classical', 'catalogues'], 'library-v2-music-vh-01'),
    ('The Köchel catalogue lists the works of which composer?', 'Wolfgang Amadeus Mozart', array['Wolfgang Amadeus Mozart', 'Mozart'], 'Music', 'Very Hard', array['classical', 'catalogues'], 'library-v2-music-vh-02'),
    ('Who composed The Rite of Spring?', 'Igor Stravinsky', array['Igor Stravinsky', 'Stravinsky'], 'Music', 'Very Hard', array['classical', 'composers'], 'library-v2-music-vh-03'),
    ('Who composed the opera Wozzeck?', 'Alban Berg', array['Alban Berg', 'Berg'], 'Music', 'Very Hard', array['opera', 'composers'], 'library-v2-music-vh-04'),
    ('Which saxophonist recorded the album Giant Steps?', 'John Coltrane', array['John Coltrane', 'Coltrane'], 'Music', 'Very Hard', array['jazz', 'albums'], 'library-v2-music-vh-05'),
    ('Which band released the album Marquee Moon?', 'Television', array['Television'], 'Music', 'Very Hard', array['albums', 'bands'], 'library-v2-music-vh-06')
)
insert into public.source_questions (
  origin,
  owner_id,
  question_type,
  prompt,
  correct_answer,
  accepted_answers,
  category,
  difficulty,
  tags,
  status,
  is_verified,
  verified_at,
  last_reviewed_at,
  import_key
)
select
  'platform',
  null,
  'single-answer',
  prompt,
  to_jsonb(answer),
  to_jsonb(accepted_answers),
  category,
  difficulty,
  tags,
  'active',
  true,
  now(),
  now(),
  import_key
from additions
on conflict (origin, import_key) where import_key is not null do update set
  prompt = excluded.prompt,
  correct_answer = excluded.correct_answer,
  accepted_answers = excluded.accepted_answers,
  category = excluded.category,
  difficulty = excluded.difficulty,
  tags = excluded.tags,
  status = excluded.status,
  is_verified = excluded.is_verified,
  verified_at = excluded.verified_at,
  last_reviewed_at = excluded.last_reviewed_at;

commit;
