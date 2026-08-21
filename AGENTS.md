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
- Keep broad subject category, controlled topic tags, mechanic, prompt pattern, answer type, editorial difficulty, factual stability, editorial status, verification, media, part metadata, bonus metadata, and provenance as distinct concepts. Do not collapse them into a generic tags field.
- Broad source categories are: Geography; History; Science & Nature; Sport; Music; Film & Television; Arts & Literature; Food & Drink; Society & Culture; Language & Words; Technology & Inventions; Games & Leisure; Business & Brands; Politics & Government.
- **General Knowledge** is a varied quiz/round composition mode, never a source category. Do not store **Mixed** as a source category; derive mixed summaries from part/category metadata.
- Topic tags are controlled canonical entities with aliases and specificity/diversity meaning. Do not reintroduce arbitrary comma-separated tags as the long-term source of truth.
- Use numeric editorial difficulty `1..5` (`Very Easy` through `Very Hard`). Keep future observed difficulty and gameplay metrics separate; never overwrite editorial judgment with performance data.
- Keep editorial workflow (`draft`, `needs_review`, `active`, `archived`), verification, and factual stability (`stable`, `review_periodically`, `volatile`) independent.
- Media is optional content, not a grading mechanic. The durable mechanics are `single-answer`, `multiple-choice`, `multi-answer`, `multi-part`, and `ranking`; image content may accompany any suitable mechanic.
- An ordinary scored question may have at most one attached bonus for MVP. Bonuses own their prompt, answer, aliases, points, media, and metadata; they affect maximum score, estimated time, and diversity, but not the displayed normal question count.
- Multi-part source questions store category, tags, and difficulty on their individual parts. Derive the parent category union and difficulty range instead of inventing a single mixed category or average difficulty.
- Prevent duplicate team names within a game.
- Only joinable lobby games should accept new teams.
- Host live controls and question content must remain usable on small laptop screens.
- Prepared tiebreakers are optional for manually built quizzes; recommend at least two without blocking save or hosting. Automatically built quizzes must prepare exactly three.
- Auto-Build must fail clearly when active source content cannot satisfy the requested count, topics, difficulty range, or three-tiebreaker requirement. Never silently duplicate questions or reduce the requested quiz.
- Auto-Build is conceptually two-stage: select an eligible candidate set using hard requirements, then sequence it with soft diversity penalties. Its diversity fingerprint includes part and bonus metadata.
- Explicit round themes discount their own broad category/tag repetition, but not repeated specific subtopics. Check whole-quiz saturation as well as adjacent repetition.
- Tiebreakers are numeric closest-answer questions used only to resolve a consequential final-placement tie. Normal round and in-game ties are allowed.
- Do not include tiebreakers in normal question counts, running-time estimates, or game points. Resolving a tie must never change a team's trivia score.
- A future final-results resolution must offer tiebreaker, allowed-tie, and manual ordering methods, and store the decision and placement separately from score.
- Never expose a prepared tiebreaker's correct numeric value to players before the relevant tiebreaker reveal.
- The host must be able to reopen answers after closing them but before reveal.
- Do not add post-reveal undo without safely reversing awarded points.
- Review-required answers sort first, then graded submissions, then waiting teams. Keep ordering stable within each group.
- Leaderboard visibility rules must not leak prohibited team names, scores, or ranks. A team may still see its own score.
- Preserve the established visual language: purple brand surfaces, light builder UI, dark host console, rounded cards, Plus Jakarta Sans, and restrained SaaS styling.

## Question and Grading Semantics

Supported question concepts are:

- `single-answer`: one typed response.
- `multiple-choice`: one supplied option; selection still requires explicit submission.
- `multi-answer`: an unordered set of responses.
- `multi-part`: slot-specific clues and responses.
- `ranking`: ordered items where position matters.

Legacy `image-question` records may remain during compatibility migrations, but normalize them to their actual mechanic plus optional media. Do not create new grading semantics around `image-question`.

Normalize typed answers case-insensitively and ignore non-semantic punctuation and spacing. Fuzzy or ambiguous matches must remain reviewable by the host. Players see only final grading, never matching confidence, automation, or host-review details.

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
- Team creation and duplicate-name prevention.
- Realtime teams appearing in the host lobby.
- Host start automatically advancing player screens.
- Realtime submissions and answer counts.
- Submission locking when answers close.
- Reopen before reveal.
- Host review of ambiguous answers.
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
