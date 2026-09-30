# Player feedback and game polish — 30 September 2026

## Changes

- Bomb instructions focus on arming, when to cut, and winning, without overtime details. In-show tiebreaker and audience instructions use player-facing language.
- Eliminated SPR participants can see remaining matchups and live choices. Active players still cannot inspect opponents' choices through the protected API.
- Image dialogs offer 100–400% zoom and a scrollable/swipeable image area, preserving intrinsic proportions and answer drafts.
- Result rows wrap complete submitted and correct answers. Accuracy sits underneath each answer, and SVG tick/cross marks center consistently.
- Editable answer forms show persistent saved feedback and green text-entry fields while their contents match the acknowledged server answer; edits return them to unsaved appearance.
- Player result routing and result details refresh without depending on private-submission Realtime notifications. Bonus correctness is independent of whether score visibility masks points.
- Rock finals already reject occupied lanes on the server; the UI now disables those lanes and explains the final showdown.
- Deal chooses a hidden ceiling once per game, with unique assignments and swaps. The lower bound is max(25, team count + 9); the upper bound is max(100, that lower bound). Nine spare numbers ensure a free amount exists outside the current value's ±4 neighborhood. All swaps change by at least $5; the old duplicate-amount fallback is removed. Existing sessions retain their original bank size.
- Numeric mismatches are excluded from fuzzy spelling review, including decimal and negative differences. Explicit aliases still apply.
- Shared Cursor uses protected passive polling with retry/stale-response protection; controls precede the compact arena. Stamina refills continuously at one unit per second, including fractional carry between taps. Exhaustion retains a three-second lockout while its bar fills smoothly.
- The live host header wraps on phones instead of overflowing and triggering mobile viewport scaling; bonus controls remain directly clickable.

## Verification

- Unit tests cover numeric mismatch/alias behavior, continuous stamina and existing grading rules.
- Browser fixtures exercise host override updates in both directions, hidden-score bonus feedback, full answer text, persistent saved/edit states, SPR spectating, passive cursor movement/result updates, first-viewport tap visibility, and actual image zoom without losing drafts.
- Rollback-only SQL fixtures check normal and speed override idempotency/reversals, spectator capability checks, hidden Deal ceilings, unique 3/40/100-team assignment and three swap rounds, and fractional server stamina.
- Existing player access and audit SQL suites are rerun against the proposed migration in a transaction. No fixtures or test scores are retained.
- Browser coverage uses controlled API fixtures; it is not a substitute for a live venue/network load test.
