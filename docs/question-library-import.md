# Question Library spreadsheet imports

The **Simple Trivia — Question Library Master Template** is the supported authoring workbook. Keep its tab names and header rows unchanged.

## Safe workflow

1. Keep the master in Google Sheets.
2. Replace the yellow example rows before the first real import.
3. Download the complete workbook with **File → Download → Microsoft Excel (.xlsx)**.
4. Dry-run it locally:

   ```sh
   npm run questions:import -- "/path/to/question-library.xlsx"
   ```

5. Correct every error. Warnings should be reviewed but do not block an import.
6. Apply the validated batch:

   ```sh
   npm run questions:import -- "/path/to/question-library.xlsx" --apply
   ```

The apply step requires the server-only `SUPABASE_SERVICE_ROLE_KEY`. Never put that value in browser code, a `NEXT_PUBLIC_` variable, source control, Vercel client settings, or the workbook.

## Safety guarantees

- Dry-run is the default and performs no database writes.
- The database revalidates controlled references and applies the whole workbook in one transaction.
- Any database error rolls back the entire batch.
- `import_key` is the permanent identity for repeatable updates.
- Reapplying identical file bytes is a no-op.
- Updated workbook rows replace the imported question’s child items, category/tag links, optional bonus and media references as one unit.
- Spreadsheet imports may only create `draft` or `needs_review` content. Publishing remains a separate editorial decision.
- Existing quiz and game snapshots are never changed by a library import.

## Workbook relationships

- `Questions.import_key` identifies an ordinary reusable question.
- `Question Items.question_import_key` attaches choices, unordered answers, multi-part clues, or ranking items to that question.
- `Bonuses.question_import_key` attaches zero or one bonus to that question.
- `Tiebreakers.import_key` identifies a separate numeric closest-answer question.
- `Tags.slug` creates or updates a controlled tag. Question, part, and bonus tag fields use those slugs.

Rows can be maintained in one large workbook. Smaller review batches are safer in practice: validate and import a coherent set, fix any editorial issues, and then continue. There is no requirement to split the library into CSV files.

## Fast metadata entry and inheritance

The normal authoring defaults are `audience_suitability = general`, `audience_scope = global`, `stability = stable`, and no content flags. Add these optional columns to **Questions**, **Question Items**, and **Bonuses** when needed:

- `audience_suitability` — `family`, `general`, or `adult`
- `audience_scope` — `global` or `country_specific`
- `audience_locale` — required only for `country_specific`, for example `Australia`
- `content_flags` — optional pipe-separated flags such as `alcohol|gambling`

Blank metadata cells on a Multi-Part item or Bonus inherit the parent question. Only enter a child category, difficulty, audience value, stability, prompt pattern, answer type, or tags when that child genuinely differs. Effective package categories, difficulty range and audience restrictions are derived from the main content, parts and Bonus; never enter `Mixed` or `General Knowledge` as a source category.
