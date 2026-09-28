# All findings since the last push — remediation ledger

Scope: **every audit finding since the last pushed commit**, as clarified by the user. Baseline: `471bb9c` (333 unit tests), matching HEAD and the upstream branch when work started. Includes the earlier findings below as well as the five recent batches. Findings from older commits must be rechecked against this baseline and not counted as outstanding if already fixed. `[ ]` means not yet verified fixed; `[x]` requires code and a regression check. Deployment is tracked separately, never implied by a local fix.

## Earlier findings — revalidate against the pushed baseline

- [x] F1 Preserve edits made during a pending quiz save.
- [x] F2 Enforce team-owned submissions, private answers and host-only scoring at the database boundary.
- [x] F3 Discard stale initial player hydration.
- [x] F4 Retry failed deadline submissions safely.
- [x] F5 Do not expose result points when player scores are hidden.
- [x] F6 Preserve independent templates when the source quiz is deleted.
- [x] F7 Preserve host authorization for live games after source-quiz deletion (or prevent unsafe deletion).
- [x] F8 Prevent silent same-name template overwrites.
- [x] F9 Keep round numbers unique after deleting then adding rounds.
- [x] F10 Invalidate final tie resolutions when tied membership changes.
- [x] F11 Settle bomb overtime on the first cut atomically.
- [x] F12 Recover shared-cursor lock-on when its target team is removed.
- [x] F13 Force distinct lanes for a two-team rock final.
- [x] F14 Ignore random-picker responses after closing the picker.
- [x] F15 Align manual difficulty filtering with displayed effective difficulty.
- [x] F16 Retry permanent-QR polling after network failures.
- [x] F17 Ignore late answer submission navigation for an old question/stage.
- [x] F18 Retheme only library questions, preserving custom questions.
- [x] F19 Preserve configured point maxima when retheming.
- [x] F20 Preserve last_seen_at when refreshing teams during scoring.
- [x] F21 Persist backup-tiebreaker drafts across refresh.
- [x] F22 Allocate template topic pools without false exhaustion.
- [x] F23 Surface/recover duplicate-quiz folder assignment failure.
- [x] F24 Preserve semantic negative signs in ordinary answer grading.
- [x] F25 Preserve literal slash/or answers rather than splitting indiscriminately.
- [x] F26 Reserve exact multi-answer matches before assigning fuzzy matches.
- [x] F27 Prevent stale admin editor loads from replacing the selected question.
- [x] F28 Honor explicit per-item scoring on newly authored rankers.
- [x] F29 Recover pagination after deleting the last item on a later page.
- [x] F30 Require round grading before Auto-Run trailing-content completion.
- [x] F31 Visit games-only middle rounds.
- [x] F32 Clear incompatible answer keys when changing to multiple choice.
- [x] F33 Honor multipart all-or-nothing configuration.
- [x] F34 Handle concurrent folder move/delete without orphaned UI state.
- [x] F35 Make new-question creation retry-safe after a lost read/response.
- [x] F36 Protect unsaved template edits from backdrop dismissal.
- [x] F37 Reject single-item rankers in the existing-question editor.
- [x] F38 Renumber multipart labels after removal/addition.
- [x] F39 Treat a literal null text answer as text, not missing input.

## A — clocks, privacy and UI reliability

- [x] A1 Fail closed when leaderboard settings cannot load.
- [x] A2 Bind classic deadline submission to question and stage.
- [x] A3 Restore persisted Auto-Run pause and remaining time.
- [x] A4 Atomically patch clock/settings to prevent lost updates.
- [x] A5 Synchronize countdowns to server time.
- [x] A6 Discard stale leaderboard reads.
- [x] A7 Cancel and key-bind delayed Auto-Run actions.
- [x] A8 Derive host remaining time from the absolute deadline.
- [x] A9 Allow arrows from focused host navigation controls.
- [x] A10 Include empty categories in supply warnings.

## B — authoring and library integrity

- [x] B1 Validate multipart rows and tolerate malformed historical grading data.
- [x] B2 Exclude in-show sources when replacing backup tiebreakers.
- [x] B3 Prevent late preferences from overwriting hosting choices.
- [x] B4 Preserve generated tiebreaker metadata and provenance.
- [x] B5 Require verified platform questions in manual selection.
- [x] B6 Paginate replacement candidates instead of truncating at 200.
- [x] B7 Recover a claimed share when its follow-up read fails.
- [x] B8 Reject duplicate ranking items.
- [x] B9 Keep folder collapse usable if storage throws.
- [x] B10 Duplicate all quiz layers from one atomic snapshot.

## C — live play and admission

- [x] C1 Preserve outstanding grading through manual Auto-Run takeover.
- [x] C2 Hide scheduled bomb explosion times from players.
- [x] C3 Hide opponents' SPR choices until reveal.
- [x] C4 Clear and verify credentials when switching games.
- [x] C5 Recover removed-team sessions instead of waiting forever.
- [x] C6 Handle approval winning the change-name race.
- [x] C7 Make join retries idempotent after a lost response.
- [x] C8 Make host bonus award retries idempotent.
- [x] C9 Surface incomplete round-answer reads and block finalization.
- [x] C10 Atomically admit existing pending teams when Auto-Join is enabled.

## D — grading, learning and templates

- [x] D1 Preserve correct parts when marking remaining reviews incorrect.
- [x] D2 Count expected slots once in adaptive difficulty.
- [x] D3 Record unassigned accepted alternatives without guessing their slot.
- [x] D4 Retract learning signals when a verdict is reversed.
- [x] D5 Use consistent active-team correctness populations.
- [x] D6 Respect round topics through the Create Quiz template shortcut.
- [x] D7 Recompute generated template quiz readiness.
- [x] D8 Support template cross-round dragging, including empty rounds.
- [x] D9 Display save failures inside the template editor.
- [x] D10 Preserve Unicode minus signs and reject invalid numeric syntax.

## E — most recent ten

- [x] E1 Reject mini-game actions/resolution after cancellation.
- [x] E2 Support an explicit safe speed-question reopen policy.
- [x] E3 Calculate team-history correctness independently of speed points.
- [x] E4 Render optional media for every player question mechanic.
- [x] E5 Preserve omitted lifecycle metadata on personal-question edits.
- [x] E6 Allocate Auto-Build specialist pools before mixed rounds.
- [x] E7 Preview choices, multipart clues and numerical-game prompts.
- [x] E8 Reject stale personal-question revisions.
- [x] E9 Only deadline-submit ranker drafts after interaction/confirmation.
- [x] E10 Resolve closest prizes against occupied final rank groups.

## Release checks

- [x] Regression/unit tests — 410 passing across 62 files.
- [x] Database tests — both suites passed against the linked Supabase schema with all 11 migrations inside a rollback-only transaction. Synthetic fixtures only.
- [x] Typecheck and lint — passed.
- [x] Production build and public route smoke tests — passed locally.
- [x] Relevant host/player browser tests — 190 passing across desktop/mobile Chromium and WebKit; 48 additional targeted rerun checks passed after final privacy/clock integration.
- [ ] Push, required migration application and production deployment
- [ ] Production verification (report any unavailable checks explicitly)

## Evidence and limits

- Executed-handler/pure regressions: `lib/trivia/audit-remediation.test.ts`, `synchronized-clock.test.ts`, `difficulty.test.ts`, `template-allocation.test.ts`, `live-bonus-flow.test.ts`, plus existing suites. F22 uses the global template allocation regression; C4 uses session recovery unit tests and new/same QR browser cases.
- Database regressions: `supabase/tests/audit_scoring_and_game_edges.sql` and `player_access_boundaries.sql`. Include anonymous and unrelated authenticated users, positive host access, fresh/admitted teams, idempotent writes, partial grading, cancellation, game winners, and reopened speed clocks. All synthetic rows and migration effects were rolled back during preflight.
- F20/F21/F29/F38, A7/A8/A9, B3/B4/B5/B6, D6/D7, E4/E7/E9 additionally have structural wiring checks. These confirm alternate entry points use the intended guards/shared helpers; they are not full end-to-end reproductions of every race.
- Browser suite: four authenticated live-host tests require dedicated E2E credentials and were skipped; two mobile-layout cases intentionally skip desktop projects. Browser coverage uses controlled HTTP fixtures. A real three-phone live show has not been manually exercised in this release.
- Extra integration fixes: protect the Lowest Bidder field as soon as it is focused; classify hidden-score correctness independently of masked points; refresh own-answer snapshots after successful protected submissions without relying on private-table Realtime.
- Rollout: protected player RPCs intentionally replace unrestricted legacy answer calls. Hosts and players with older open tabs should refresh after deployment. Deploy the matching frontend and database changes together.
