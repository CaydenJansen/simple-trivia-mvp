# Simple Trivia

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

## Deployment checklist

- Add both variables from `.env.example` to the hosting provider.
- Deploy the Next.js project from the repository root.
- Add the public site URL and `/host` redirect URL to Supabase Authentication URL Configuration.
- Verify host sign-in and email confirmation on the public domain.
- Run one complete host/player game using separate devices.

The app requires the checked-in Supabase migrations to be deployed before the matching application build goes live.
