# Simple Trivia Engineering Guide

## Repository Safety

- Treat the current working tree as authoritative. Preserve all uncommitted work.
- Never discard, restore, overwrite, reset, or rewrite user changes without explicit approval.
- Inspect `git status` before significant changes.
- Do not commit secrets. Only browser-safe Supabase environment variables may use the `NEXT_PUBLIC_` prefix.
- Prefer small, behaviour-preserving changes over broad rewrites of the Figma-originated host and player components.
- Do not redesign the established UI unless explicitly requested.

## Architecture Invariants

- A **quiz** is a reusable definition. A **game** is one live session of a quiz.
- Maintain three distinct question layers: source question → independent quiz-question snapshot → frozen game-question snapshot.
- Source questions belong either to the platform-owned **Question Library** or the user-owned **My Questions** collection.
- Adding a source question to a quiz creates an independent copy. Editing a quiz copy must never mutate its source or another quiz that previously used it.
- A question written inside the Quiz Builder must be saved to My Questions and independently copied into the quiz. Later synchronization with its source must always be explicit.
- Hosting a quiz must create a fresh game with its own six-digit code, teams, submissions, scores, state, and question snapshot.
- Never regress to using `728461` or another hard-coded code as the normal hosting path.
- Preserve the `quiz_questions` → `game_questions` snapshot boundary so later quiz edits cannot alter an active or completed game.
- Preserve explicit provenance across every snapshot: source question ID/revision on quiz copies, and quiz-question plus source provenance on game copies. Never infer reuse by comparing prompt text.
- Preserve the separate `quiz_tiebreakers` → `game_tiebreakers` snapshot boundary. Prepared tiebreakers are not ordinary scored questions.
- Auto-Build draws from platform-owned `source_questions` and `source_tiebreakers`, then creates independent quiz snapshots through the same atomic save boundary as manual authoring.
- Supabase is the source of truth for live game state. Do not replace working database or Realtime behaviour with fake local state.
- Players follow host progression automatically; players do not advance questions themselves.
- Auto-Run is a pre-game rule, not a mid-game configuration toggle. MVP Auto-Run advances only the current round and always stops at a host-controlled round checkpoint.
- On player answer-entry screens, Return submits a valid current answer. Shift+Return remains available for a newline in multi-line text fields.
- Correct answers must not be exposed to players before reveal.
- Content authored by a host must remain distinct from live session data.
- Host-owned reusable content requires an authenticated host identity so ownership can be enforced with RLS. Player teams remain account-free.
- Keep browser-only code and Supabase publishable credentials client-safe. Never expose a service-role key.

## Product Invariants

- The primary flow is:
  - Builder saves a reusable quiz.
  - Host launches a fresh lobby from that quiz.
  - Teams join one phone per team.
  - Host controls open, close, review, reveal, scoring, rounds, and completion.
  - The game finishes with the appropriate leaderboard.
- Preserve optional team PIN behaviour; do not require player accounts.
- The dashboard navigation label is **Questions**, with **My Questions** and **Question Library** inside it.
- Quiz Builder add-question choices are **Write New**, **My Questions**, and **Question Library**.
- Always call the platform question bank **Question Library**. “Verified” may be question metadata or a badge, not part of the product name.
- Normal hosts may read but never edit platform Question Library records. My Questions records are user-owned and editable by their owner.
- Platform Question Library administration is private and permission-enforced; hidden customer UI alone is not an access-control boundary.
- Keep broad subject category, controlled topic tags, mechanic, prompt pattern, answer type, editorial difficulty, editorial status, verification, media, Part metadata, and Bonus metadata as distinct concepts. Keep any retained legacy freshness/provenance fields separate too; do not collapse these concepts into a generic tags field.
- Broad source categories are: Geography; History; Science & Nature; Sport; Music; Film & Television; Arts & Literature; Food & Drink; Society & Culture; Language & Words; Technology & Inventions; Games & Leisure; Business & Brands; Politics & Government.
- **General Knowledge** is a varied quiz/round composition mode, never a source category. Do not store **Mixed** as a source category; derive mixed summaries from part/category metadata.
- Topic tags are optional controlled canonical entities with conservative aliases. Unknown imported phrases never block an otherwise-valid question: retain their component assignments for bulk map/create/ignore review, and backfill resolved tags onto already-imported content.
- Use numeric editorial difficulty `1..5` (`Very Easy` through `Very Hard`). Keep future observed difficulty and gameplay metrics separate; never overwrite editorial judgment with performance data.
- Keep editorial workflow (`draft`, `needs_review`, `active`, `archived`) and verification independent. The permanent MVP library is evergreen; leave existing factual-stability/freshness fields safely deprecated rather than requiring them in normal authoring.
- Media is optional content, not a grading mechanic. The durable mechanics are `single-answer`, `multiple-choice`, `multi-answer`, `multi-part`, and `ranking`; image content may accompany any suitable mechanic.
- An ordinary scored question may have at most one attached bonus for MVP. Bonuses own their prompt, answer, aliases, points, media, and metadata; they affect maximum score, estimated time, and diversity, but not the displayed normal question count.
- Live bonuses use two distinct answer stages within their parent question: the host closes the main answers before opening the bonus, then closes the bonus answers separately. Store bonus submissions and grading separately from ordinary submissions, then reveal and score both together exactly once.
- On the live host review screen, show an attached bonus as a labelled part within the same team row as the main answer. Use the normal purple visual language for bonus identity throughout builder, host, and player surfaces; reserve amber answer-row treatment for items that genuinely need host review.
- Quiz Builder tiebreaker cards follow the same interaction and styling conventions as ordinary question cards, including drag-to-reorder and hover-only edit affordances. Answer preview panels stay visually neutral; green is a compact answer/correctness cue, not a full-panel background.
- Multi-part source questions store category, tags, and difficulty on their individual parts. Derive the parent category union and difficulty range instead of inventing a single mixed category or average difficulty.
- Keep manual question classification lightweight: parent questions default to Audience Fit `broad`, Adult Content `false`, and Scope `global`; tags, prompt pattern, answer type, and review dates remain optional enrichment.
- Audience Fit is `broad`, `kids`, `young_adults`, or `older_adults` and is a soft selection preference. Auto-Build defaults to all audience fits with no preference; a host may deliberately prioritise one fit. Adult Content is an independent hard family-safety flag. Scope is `global` or `country_specific` with a locale; a question about a country is not automatically country-specific.
- Adult Content means the content must not be automatically selected for children, school, or family-safe quizzes, including substantial alcohol, gambling, recreational-drug, explicit sexual, strongly mature, or particularly graphic material.
- Multi-part Parts and Bonuses inherit parent category, difficulty, audience, and locality when their override is absent. Part tags are additive. Blank Bonus tags inherit; populated Bonus tags replace, and replacement intent must survive even while every supplied tag is unresolved.
- Effective package Adult Content is true when any content shown to players is adult. Any country-specific child makes the package not fully international-friendly.
- Prevent duplicate team names within a game.
- Every fresh team join requires an explicit host approval or denial before a real game team is created. Keep pending/denied requests out of teams, scoring, submissions, leaderboards, and joined-team counts.
- During live play, pending team requests appear in a separate approval panel beside the host leaderboard. Keep approval controls out of the QR/join-code dialog so that dialog remains compact and easy to dismiss on short screens.
- Player-facing denial copy stays neutral and does not assume why the host denied entry; the host handles any explanation in the room.
- Games accept new zero-score teams, after host approval, while they are in the lobby or actively running. Finished and cancelled games are never joinable.
- Host live controls and question content must remain usable on small laptop screens.
- Player live screens use a compact two-line mobile header: brand with Leave Game, then round/question with team/score. Present question prompts as clear, prominent reading surfaces without centering long question text.
- Quiz readiness is derived automatically when saving: complete quizzes become Ready, incomplete quizzes remain Draft with specific blockers. Do not reintroduce a manual readiness step or preparation progress wizard.
- Saving and hosting are separate deliberate actions. Any edit disables hosting until the current quiz version is saved; saving must never automatically enter the hosting flow.
- Leaving Quiz Builder with unsaved changes must offer Save & Leave, Discard Changes, and Keep Editing. Closing or reloading the browser must also warn while builder changes are unsaved.
- My Quizzes supports direct renaming and independent duplication. A duplicated quiz copies its question, content-screen, bonus, provenance, and prepared-tiebreaker snapshots without linking future edits between the two quizzes.
- Quiz Preview supports Space or Right Arrow to advance and Left Arrow to go back, while keeping the visible Previous and Next controls.
- Quiz Builder overview cards expose the complete question and answer information needed for review, including accepted alternatives, choices, multi-part clues, ranking order, and bonuses. Omit absent optional category/difficulty metadata instead of showing placeholder labels such as Uncategorised or Unrated.
- Prepared tiebreakers are optional for manually built quizzes; recommend at least two without blocking save or hosting. Automatically built quizzes must prepare exactly three.
- Auto-Build must fail clearly when active source content cannot satisfy the requested count, topics, difficulty range, or three-tiebreaker requirement. Never silently duplicate questions or reduce the requested quiz.
- Auto-Build is conceptually two-stage: select an eligible candidate set using hard requirements, then sequence it with soft diversity penalties. Its diversity fingerprint includes part and bonus metadata.
- Explicit round themes discount their own broad category/tag repetition, but not repeated specific subtopics. Check whole-quiz saturation as well as adjacent repetition.
- Tiebreakers are numeric closest-answer questions used only to resolve a consequential final-placement tie. Normal round and in-game ties are allowed.
- Do not include tiebreakers in normal question counts, running-time estimates, or game points. Resolving a tie must never change a team's trivia score.
- Tiebreaker resolution choices require an explicit host selection and confirmation. Player numeric submissions lock immediately after submission and cannot be edited.
- Calculate tiebreaker distance as each answer is submitted so the host can see the current closest team live. Keep distances and outcomes hidden from players until reveal; the revealed player screen shows whether they won, lost, or remain tied together with the correct answer, their submitted answer, and its distance from correct.
- A future final-results resolution must offer tiebreaker, allowed-tie, and manual ordering methods, and store the decision and placement separately from score.
- Never expose a prepared tiebreaker's correct numeric value to players before the relevant tiebreaker reveal.
- The host must be able to reopen answers after closing them but before reveal.
- Reopening answers must return submitted teams to an editable form with their previous response preserved; resubmission replaces the existing response rather than creating a duplicate.
- Do not add post-reveal undo without safely reversing awarded points.
- Review-required answers sort first, then graded submissions, then waiting teams. Keep ordering stable within each group.
- Leaderboard visibility rules must not leak prohibited team names, scores, or ranks. A team sees point totals only when the host enables player score visibility; this setting is independent from leaderboard visibility.
- Player score visibility is fixed before play as `live`, `round`, `final`, or `hidden`. Auto-Run defaults to round-finalized scores. Never expose provisional in-round scores when round-finalized visibility is selected.
- Auto-Run timing is workload-based: 30 seconds for the first point/ranking item and 15 seconds for each additional point/item; content screens default to 30 seconds and simple reveals to 15 seconds. Compound reveals may be slightly longer.
- Auto-Run must preserve host intervention: pause/resume preserves remaining time, +15 seconds extends the current state, Close Now closes safely, and manual control stops progression without changing pre-game rules.
- Ambiguous answers never stop Auto-Run and never silently become incorrect. Leave them pending and neutral to players until the host resolves them or explicitly marks all remaining pending answers incorrect at the round checkpoint.
- Auto-Run round scores remain provisional until explicit host finalization. The next round and final results must not proceed from an Auto-Run checkpoint before finalization.
- **After every question** leaderboard mode inserts a dedicated standings screen between scored questions; it must never become a persistent overlay on question or answer screens.
- Preserve the established visual language: purple brand surfaces, light builder UI, dark host console, rounded cards, Plus Jakarta Sans, and restrained SaaS styling.
- Every host screen shown while a game is actively running, including round breaks and in-game leaderboards, uses the dark host-console treatment. Light surfaces are reserved for building/setup and post-game results.
- Live host screens describe player-visible state once, keep answer status with the answer controls, and expose contextual previous/next show controls persistently. Do not bury the safe back action in the utility menu or duplicate the same state across banners and helper copy.

## Question and Grading Semantics

Supported question concepts are:

- `single-answer`: one typed response.
- `multiple-choice`: one supplied option; selection still requires explicit submission.
- `multi-answer`: an unordered set of responses.
- `multi-part`: slot-specific clues and responses.
- `ranking`: ordered items where position matters.

Legacy `image-question` records may remain during compatibility migrations, but normalize them to their actual mechanic plus optional media. Do not create new grading semantics around `image-question`.

Normalize typed answers case-insensitively and ignore non-semantic punctuation and spacing. Fuzzy or ambiguous matches must remain reviewable by the host. Players see only final grading, never matching confidence, automation, or host-review details.

- Configured accepted aliases grade as correct for their specific answer or part.
- Conservative near-match signals such as plausible spelling slips, reordered identical characters, article-only differences, and very close phrases may flag an answer for host review.
- A near-match signal must never award points automatically. The host decides whether every reviewable answer is correct or incorrect.

### Multi-answer

- Treat correct answers as an unordered set.
- Consume each correct answer at most once.
- Duplicate submissions cannot score the same expected answer twice.
- Display each submitted response independently.
- List unsubmitted correct responses separately as missing.
- Never pair an incorrect submission with an arbitrary missing answer.
- Do not number multi-answer rows.

Example:

```text
Expected: Belgium, Netherlands, Luxembourg
Submitted: Netherlands, Belgium, France
Score: 2/3
Missing: Luxembourg
```

Submitting `Belgium, Belgium, Netherlands` also scores `2/3`.

### Multi-part

- Responses are tied to their A/B/C clue.
- Preserve part labels.
- An incorrect row may display `submitted → expected`.

### Ranking

- Responses are tied to numeric positions.
- Preserve position numbers.
- An incorrect row may display `submitted → expected`.
- Preserve the player reorder animation.

### Grading Visual Language

- Correct submitted answer: green text and green tick.
- Incorrect submitted answer: neutral text and red cross.
- Corrected or expected answer: green text.
- Needs review: neutral answer with amber controls/treatment.
- Waiting: muted grey.
- Do not make the full incorrect answer or row red.
- For a correct single answer, show one compact correct row rather than duplicate “your answer” and “correct answer” boxes.

## Live Game Behaviours That Must Not Regress

Preserve and verify:

- Supabase game-code lookup.
- Fresh six-digit game creation.
- Host approval/denial before team creation, including neutral denied-player recovery and live-game late joins.
- Team creation and duplicate-name prevention.
- Realtime teams appearing in the host lobby.
- Host start automatically advancing player screens.
- Realtime submissions and answer counts.
- Submission locking when answers close.
- Reopen before reveal.
- Host review of ambiguous answers.
- Auto-Run pause/resume, timer extension, close-now, manual takeover, pending-review accumulation, and explicit round finalization.
- Reveal and points application.
- Multiple questions and rounds.
- Intermission and content-screen progression where supported.
- Host and player leaderboards.
- Final results.
- Host visibility of full question details, supplied options, ranking items, clues, answers, and notes.
- Multiple-choice explicit submission.
- Ranking reorder animation.
- Multi-answer uniqueness and missing-answer semantics.

## Persistence and Data Integrity

- Prefer atomic database operations for multi-step writes such as saving a quiz, creating a game snapshot, and applying scores.
- Enforce important uniqueness rules in PostgreSQL as well as in UI code.
- Avoid destructive replace operations unless failure recovery is safe.
- Maintain migrations or an equivalent checked-in schema definition for database changes.
- Keep database types synchronized with the deployed schema.
- Preserve ordering explicitly with stable round and item positions.
- Recalculate cached quiz counts and duration metadata when quiz content changes.
- Store accepted aliases explicitly; do not hide them in display text.
- Model content screens explicitly rather than pretending they are scored questions.
- Model prepared tiebreakers explicitly rather than assigning special point values to ordinary questions.
- Keep source metadata relational where it must be searched and controlled. Quiz/game snapshots may deliberately denormalize structured metadata so they remain independent of later taxonomy edits.
- Treat current flat `category`, `difficulty`, `tags`, `image_url`, and mechanic-specific JSON columns as compatibility projections while the normalized model is adopted. Do not remove them until every deployed reader and writer has migrated.
- External bulk imports must pass through separate staging, validation, normalization, and review. Never shape production tables around a historical import format.
- The human spreadsheet uses one long-format Questions sheet plus a separate Tiebreakers sheet. Infer mechanics from grouped child Row Types and reject contradictory structures rather than guessing.
- Consider Supabase RLS and Realtime publication requirements for every new table or operation.

## Testing Expectations

Before handing off a meaningful change:

1. Run `git status` and confirm unrelated changes remain intact.
2. Run the production build.
3. Run TypeScript checking.
4. Run lint.
5. Run relevant automated tests.
6. Smoke-test `/`, `/host`, and `/play`.
7. Manually exercise the affected host and player flow against Supabase when live behaviour changes.

At minimum, grading tests must cover:

- Single answer exact match, incorrect answer, and reviewable typo such as `Cannada`.
- Multi-answer unordered matching.
- Multi-answer duplicate prevention.
- Multi-answer missing-answer display without arbitrary correction pairing.
- Multi-part slot-specific grading.
- Ranking position-specific grading.
- Case, punctuation, and whitespace normalization.
- Host review override.
- Scoring idempotency: reveal or retries must not award points twice.
- Prepared tiebreaker numeric validation, optional manual recommendation, and the exact auto-build count of three.
- Auto-Run timing by points and ranking workload, stable pre-game mode parsing, pending-review exclusion from provisional scoring, and score visibility at round/final checkpoints.

For live-session changes, verify with at least three teams where practical:

- Join fresh lobby.
- Start game.
- Submit, close, reopen, resubmit where allowed, close, review, and reveal.
- Advance across a round boundary.
- Finish and confirm final scores.
- Confirm an older game and its question snapshot remain unchanged.

Report checks that could not run and distinguish environment failures from application failures.

## Refactoring Guidance

- Do not refactor large host/player files solely because they are large.
- Protect behaviour with tests before extracting logic.
- Prefer gradual extraction in this order:
  1. Pure grading and normalization logic.
  2. Shared TypeScript/database types.
  3. Supabase game and quiz operations.
  4. Hooks and UI components.
- Preserve working behaviour and visual design during every extraction.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js-specific code. Heed deprecation notices.

This block is managed by Next.js. Removing it may cause it to be recreated.

<!-- END:nextjs-agent-rules -->
