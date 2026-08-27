# Question Library spreadsheet imports

The workbook is a human-friendly import/edit format. It deliberately does not mirror the normalized database.

## Workbook sheets

### Questions

Use these columns:

`Question ID | Row Type | Label | Prompt / Clue | Answer | Accepted Answers | Correct Choice? | Category | Difficulty | Tags | Audience Fit | Adult Content? | Scope | Locale | Notes`

Supported Row Types are `Question`, `Choice`, `Answer`, `Part`, `Ranking`, and `Bonus`.

- A simple question is one `Question` row.
- Complex child rows repeat the same stable Question ID and remain directly beneath their parent.
- The importer infers the mechanic from child rows. Contradictory child structures are rejected.
- `Accepted Answers` and `Tags` use semicolon-separated values.
- Blank Part/Bonus classification fields inherit the parent.
- Part tags add to parent tags.
- Blank Bonus tags inherit; populated Bonus tags replace the parent tags.
- Choice, Answer, and Ranking rows do not have independent classification metadata.
- Imports enter editorial review as `needs_review`; importing never publishes content directly.

Normal parent defaults are `Audience Fit = Broad`, `Adult Content? = No`, and `Scope = Global`.

### Tiebreakers

Use these columns:

`Tiebreaker ID | Prompt | Correct Numeric Answer | Unit | Category | Difficulty | Audience Fit | Adult Content? | Scope | Locale | Notes`

Tiebreakers remain separate numeric closest-answer content. They are never ordinary scored questions.

## Controlled tags

The platform starts with a controlled vocabulary and aliases. Exact canonical names and known aliases attach automatically. Unknown phrases never invalidate an otherwise-valid question: they are retained as unresolved assignments and grouped for bulk review.

A bulk decision can map a phrase to an existing tag, create a canonical tag, or ignore it. Map/create decisions backfill every affected question already imported. Ignored normalized phrases do not repeatedly return in later reports.

## Safe workflow

1. Download the complete Google Sheet as Microsoft Excel (`.xlsx`).
2. Dry-run locally:

   ```sh
   npm run questions:import -- "/path/to/question-library.xlsx"
   ```

3. Correct every error. Warnings—including proposed tags—do not block the import but should be reviewed.
4. Apply the validated workbook:

   ```sh
   npm run questions:import -- "/path/to/question-library.xlsx" --apply
   ```

### Replace the complete live library

When a workbook is the new complete platform library, use the dedicated replacement command. It validates first and writes nothing:

```sh
npm run questions:replace -- "/path/to/question-library.xlsx"
```

After reviewing the clean dry run, apply it:

```sh
npm run questions:replace -- "/path/to/question-library.xlsx" --apply
```

If the local environment does not have the server-only service-role key, generate one already-validated SQL file for the Supabase SQL editor:

```sh
npm run questions:replace -- "/path/to/question-library.xlsx" --sql-output "/tmp/replace-question-library.sql"
```

Replacement activates the incoming questions and tiebreakers and archives platform source rows omitted from the workbook. It never changes the independent copies already saved in quizzes or frozen into games.

Applying requires the server-only `SUPABASE_SERVICE_ROLE_KEY`. Never place it in browser code, source control, the workbook, or a `NEXT_PUBLIC_` variable.

## Safety guarantees

- Dry-run is the default and performs no database writes.
- The complete batch is applied atomically; database errors roll back everything.
- Question ID and Tiebreaker ID are stable external import identifiers. Database rows retain UUID primary keys.
- Reapplying identical file bytes is a no-op.
- Complete-library replacement is atomic: import, activation, and retirement of omitted source rows succeed or roll back together.
- Updated imports never mutate existing quiz-question or game-question snapshots.
- Removed freshness and human-entered provenance fields remain non-destructively deprecated in the database during migration.
