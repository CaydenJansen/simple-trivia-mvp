# Good Trivia Company

A Next.js and Supabase application for building and hosting live trivia games.

## Local development

Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key. Never use a service-role key in browser environment variables.

Then install dependencies and start the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production routes:

- `/host` — authenticated host dashboard and live console.
- `/play` — account-free player experience.

Prototype routes are available only during local development and return 404 in production.

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Browser regression tests cover Chromium, WebKit/Safari, and mobile layouts:

```bash
npx playwright install chromium webkit
npm run test:e2e
```

The public and prototype regression tests need only the normal local Supabase variables. The authenticated live-game test is skipped unless `E2E_HOST_EMAIL`, `E2E_HOST_PASSWORD`, and `E2E_QUIZ_TITLE` identify a dedicated test host and a disposable ready quiz.

## Production error visibility

Unexpected browser errors and React crashes are reported to the `/api/client-errors` endpoint. The endpoint records sanitized, query-string-free reports in the hosting provider's function logs under `[simple-trivia-client-error]`; it never includes player answers, team names, email addresses, or Supabase credentials. Error reporting is best-effort and never blocks a live game.

## Question Library imports

Question Library spreadsheets are validated with a no-write dry run before any database import. See [the importer guide](docs/question-library-import.md) for the workbook rules and commands.

## Deployment checklist

- Add both variables from `.env.example` to the hosting provider.
- Deploy the Next.js project from the repository root.
- Add the public site URL and `/host` redirect URL to Supabase Authentication URL Configuration.
- Verify host sign-in and email confirmation on the public domain.
- Run one complete host/player game using separate devices.

The app requires the checked-in Supabase migrations to be deployed before the matching application build goes live.
