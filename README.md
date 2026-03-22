# Unimonk Test Platform

Unimonk is a full-stack online test platform built with Next.js App Router, Prisma, PostgreSQL, Redis, and QStash. It now ships as an admin-and-student product with a public landing page, free lead-capture mocks, paid batch-wise mocks, timed test sessions with autosave, AI-assisted document import, and asynchronous post-submission feedback.

The current production target is:

- Vercel for app hosting and cron execution
- Neon for PostgreSQL
- Upstash Redis for sessions, rate limiting, and event queues
- Upstash QStash for background webhook delivery

## Current Architecture

- **Frontend and API**: Next.js 16 App Router
- **Database**: PostgreSQL via Prisma
- **Serverless runtime path**: Prisma client JS engine with Neon adapter
- **Redis access**: `@upstash/redis` in production, `ioredis` fallback for local TCP Redis
- **Async jobs**: QStash webhooks for AI feedback and timeout force-submit
- **Realtime-ish updates**: short polling through `/api/events/poll` plus a lightweight feedback status endpoint
- **Email**: Nodemailer SMTP
- **AI**: OpenAI API for question generation and personalized feedback

## Core Product Features

- Public landing page at `/` with a login entry point for admin and enrolled students
- OTP-based login for admin and enrolled students only
- Free public mock tests with lead capture and a single attempt per lead
- Paid batch-wise mock tests with 1 initial attempt plus 3 reattempts
- Admin test builder with manual MCQ creation
- Hybrid document import for `.docx` and text-based `.pdf`
- Extraction-first flow for existing MCQ papers
- AI fallback generation for plain notes, with a minimum generation floor
- Timed arena with server-authoritative deadlines
- Autosave with batch sync and safe submit handling
- AI feedback generated asynchronously after submission
- Student results plus admin analytics, leads, and overview dashboards

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 7+
- npm 9+

### Setup

```bash
npm install
cp .env.example .env
npm run db:migrate:deploy
npm run db:seed
```

If you want local QStash delivery, run this in a separate terminal:

```bash
npx @upstash/qstash-cli@latest dev
```

Then start the app:

```bash
npm run dev
```

Useful scripts:

```bash
npm run typecheck
npm run lint
npm run build
npm run vercel-build
npm run db:migrate:deploy
npm run db:push
npm run db:seed
npm run db:bootstrap:owner-admin
```

## Environment Variables

Use [.env.example](./.env.example) as the source of truth.

Important variables:

- `DATABASE_URL`: pooled PostgreSQL URL for runtime
- `DIRECT_URL`: direct PostgreSQL URL for migrations and Prisma CLI
- `REDIS_URL`: local Redis TCP URL
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: production Upstash Redis REST credentials
- `JWT_SECRET` and `JWT_REFRESH_SECRET`: auth signing secrets
- `OWNER_ADMIN_EMAIL` and `OWNER_ADMIN_NAME`: owner account bootstrap values for fresh environments
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: SMTP credentials for OTP delivery
- `OPENAI_API_KEY`: required only for AI generation and AI feedback
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`: production QStash credentials
- `QSTASH_URL`: local QStash dev server URL
- `NEXT_PUBLIC_APP_URL`: public app URL
- `CRON_SECRET`: required in production so Vercel Cron can authorize scheduled requests

## Documentation Map

Use these files first when regaining context:

- [README.md](./README.md): current architecture and local setup
- [DEPLOYMENT.md](./DEPLOYMENT.md): Vercel, Neon, Upstash deployment steps
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md): pre-launch and go-live checklist
- [API_README.md](./API_README.md): current API surface

## Deployment Notes

- The app is configured for Vercel in [vercel.json](./vercel.json).
- Cron routes are already defined for reconciliation jobs.
- `/api/health` provides a simple readiness check for database and Redis.
- Primary deployment instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Operational Limits

- Text-based PDFs are supported. Scanned PDFs still need OCR.
- The AI document import path is designed for admin workflows, not bulk ingestion pipelines.
- Concurrency claims should be based on deployed load testing, not local dev runs.

## Migration Discipline

- Use `npm run db:migrate:deploy` for any persistent environment, including Preview and Production.
- Keep `npm run db:push` only for throwaway local experiments where schema history does not matter.
- Do not deploy from a database that was manually drifted away from the committed Prisma migrations.
- Use `npm run db:bootstrap:owner-admin` after the first migration on a brand-new persistent environment.
- Keep `npm run db:seed` for local/demo data only. It is intentionally blocked in production unless you explicitly override it.

## API Reference

See [API_README.md](./API_README.md) for the current API surface.
