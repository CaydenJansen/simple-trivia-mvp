# Hot Potato

## Rules

- A 90-second round with at least two active teams. Freeze participants and create one potato per five teams, rounded up, at the start. Late joiners can spectate.
- Each held potato earns one Hot Potato point per second into a shared pending balance. Passing the last held potato banks the entire balance; passing only some does not.
- Any held potato exploding wipes that team's pending balance, never its banked score. Remaining potatoes keep accruing. Unbanked points are lost at the final buzzer.
- A potato lasts a server-random 8–22 seconds from creation. Passing never resets its age. Shaking gets faster with age but does not disclose the secret deadline.
- An exploded potato is replaced on another team. New deliveries prefer teams that have received fewer potatoes, with random selection among equals. Player-chosen passes can stack potatoes on a team.
- A 600ms minimum catch-to-pass interval prevents instant ping-pong spam. Players select one held potato, then choose a recipient from the searchable team list.
- Only Hot Potato banked and pending scores are exposed in the pass list, not hidden quiz scores. Scores are displayed to one decimal place; a tie at that precision is settled by a disclosed random draw. If no points are banked, there is no winner.
- Hot Potato points decide the winner only. The existing frozen points/custom-prize reward is applied exactly once; speed mode scales that configured reward, not the mini-game counter.

## Architecture and safety

Private RLS-protected tables retain balances, exact explosion deadlines and pass operation IDs. No client table access or internal-function execution is granted. Public show-game settings contain only names, public mini-game scores, holders, age and sample timestamps.

All server activity serializes on the show-game row. Clock catch-up processes explosions chronologically, including after host/player disconnection. Players cannot keep credit beyond an explosion or the deadline. Approved passive player polls can advance a round when the host sleeps; writes are throttled under the same lock. Invalid/stale passes return the current safe state without rolling back a due explosion. Retries reuse an operation ID and cannot pass again if the same potato later returns.

Ordinary quiz snapshots, templates and sharing retain the new game through the existing show-game model. Automatic random-game selection and final tie-resolution options remain unchanged.

## Verification / release status

Production build, TypeScript and lint checks passed. All 447 unit tests passed. Combined Hot Potato, existing collaborative-game and public smoke browser tests passed 104 checks across desktop/mobile Chromium and WebKit, with four intentional device-specific skips. Coverage includes host start/continue, short-phone pass-button visibility, passive updates, multi-potato banking, refresh and operation-ID reuse after a network failure.

`supabase/tests/hot_potato.sql` is intended to run with the migration in a transaction ending in ROLLBACK. It covers snapshot preservation, stacked accrual, last-pass banking, retry idempotency, invalid authentication/self-passing, explosions/replacement, private deadlines, finalization, and normal/speed/custom reward behavior.

Database verification passed against the linked project in a transaction ending in ROLLBACK: the new Hot Potato suite plus `game_feedback_20260930.sql`, `audit_scoring_and_game_edges.sql` and `player_access_boundaries.sql`. Synthetic fixtures and the trial migration were rolled back. Migration `20261001100000_add_hot_potato.sql` was subsequently applied successfully to the linked production project; the dry run confirmed it was the only pending migration. Production UI release follows this commit.
