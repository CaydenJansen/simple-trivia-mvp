begin;

update public.host_preferences
set game_settings = game_settings - 'skip_unneeded_tiebreakers'
where game_settings ? 'skip_unneeded_tiebreakers';

update public.games
set settings = settings - 'skip_unneeded_tiebreakers'
where settings ? 'skip_unneeded_tiebreakers';

commit;
