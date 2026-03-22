# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API routes. Route groups such as `app/(auth)` and `app/(public)` separate authenticated and public experiences.
- `components/`: Reusable UI and marketing components. Keep route-specific UI close to its feature when possible.
- `lib/`: Core application logic: services, auth/session helpers, validations, env handling, Redis/Prisma clients, and shared config.
- `prisma/`: Database schema, migrations, and seed script.
- `__tests__/`: Vitest suites for services, validations, and config.
- `public/`: Static assets used by the app.

## Build, Test, and Development Commands
- `npm run dev`: Start the Next.js dev server.
- `npm run build`: Create a production build.
- `npm run typecheck`: Run TypeScript checks with `tsc --noEmit`.
- `npm run test:ci`: Run the full Vitest suite.
- `npm run db:migrate:deploy`: Apply committed Prisma migrations.
- `npm run db:seed`: Seed the local database.

Example local flow:
```bash
docker compose up -d postgres redis
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

## Coding Style & Naming Conventions
- TypeScript-first codebase; use the `@/` path alias for internal imports.
- Follow existing file style: server code is typically 4-space indented; client components use clear, typed props and concise state.
- Use `PascalCase` for React components, `camelCase` for functions/variables, and `kebab-case` only where framework conventions require it.
- Keep API route handlers thin; business logic belongs in `lib/services/`.
- Validate request payloads with Zod in `lib/validations/`.

## Testing Guidelines
- Tests use **Vitest** and live under `__tests__/`.
- Name files `*.test.ts` and group them by feature, for example `__tests__/lib/services/test-service.test.ts`.
- Add targeted tests for any service, validation, or config change. Run `npm run test:ci` before opening a PR.

## Commit & Pull Request Guidelines
- Prefer concise Conventional Commit style: `feat:`, `fix:`, `docs:`, `refactor:`.
- Keep commits focused and explain the user-facing or operational impact.
- PRs should include: summary, risk/rollback notes, migration impact (if any), and screenshots for UI changes.

## Security & Configuration Tips
- Never commit `.env` or secrets.
- Use Prisma migrations for persistent environments; avoid `db push` for deployable databases.
- Production cron requires `CRON_SECRET`, and AI features require a valid `OPENAI_API_KEY`.
