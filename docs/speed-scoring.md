# Speed-based scoring

Choose **Speed-based points** under Scoring when hosting a fresh game. Classic
remains the default. The scoring mode and Fast/Normal/Slow pace are frozen when
the lobby is created; starting another game is required to change them.

## Rules

- A fully correct ordinary question earns `round(100 - 50 × elapsed / duration)`,
  clamped to 50–100. Incorrect answers earn zero.
- Partial credit is proportional to the question's original grading maximum,
  rounded once to a whole speed score. An attached bonus has its own timer and
  maximum of 100. Ranking keeps its existing all-or-nothing or per-position rule.
- Changing a submitted answer uses the new server arrival time. Retrying an
  unchanged answer and correcting its grading do not change its speed factor.
- Point-awarding show games award 100 per winner. Custom prizes and score-neutral
  tiebreakers are unchanged. Host-entered manual bonus points retain their entered
  value.
- Timers use the existing Auto-Run workload rules: 30 seconds plus 15 per
  additional original point; ranking adds five seconds per additional item.
  Normal multiplies this by 1.2 and Slow by 1.4.
- Timers apply even with Auto-Run off. Auto-Run still governs progression and
  round review. Question timers cannot be paused, extended, or reset by refreshing
  or reopening an answer stage. A reopened stage only has its original time left.

## Integrity and compatibility

Original question snapshots and grading maxima remain unchanged. Private server
clocks record the first opening of each core/bonus stage. The database stamps a
submission's speed factor, rejects answers after a 750 ms transport grace window,
and converts grading awards plus team totals in one transaction. Full correctness
and learning statistics remain independent from the number of speed points.

Player timers display the server deadline using the device clock; scoring itself
uses database time. As with other timed online games, network latency affects
arrival time. Partial drafts auto-submit just before the visible deadline, while
the app is active. An offline or suspended phone cannot guarantee delivery.

## Regression checks

- `supabase/tests/speed_scoring.sql`: synthetic fixtures, always rolled back;
  timing, answer edits, late rejection, scoring, corrections, permissions,
  bonuses, game awards, and Classic compatibility.
- `e2e/speed-scoring.spec.ts`: mocked transport; player countdown and partial
  submission, draft/clock recovery, correct-result routing, setup, and bonus
  transition without Realtime; desktop/mobile Chromium and WebKit.
- `lib/trivia/speed-scoring.test.ts`: calculation boundaries and mode persistence.

Browser fixtures do not replace a real multi-phone/network rehearsal.
