-- The production Question Library now uses the reviewed archive tiebreakers.
-- Remove only the six original development seeds; reusable quiz and live-game
-- tiebreaker snapshots are stored independently and are intentionally retained.
delete from public.source_tiebreakers
where import_key in (
  'starter-tie-01',
  'starter-tie-02',
  'starter-tie-03',
  'starter-tie-04',
  'starter-tie-05',
  'starter-tie-06'
);
