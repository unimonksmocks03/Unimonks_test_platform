# Unimonk Test Platform

Unimonk is a full-stack online test platform built with Next.js App Router, Prisma, PostgreSQL, Redis, and QStash. It supports admin, teacher, and student roles; timed test sessions with autosave; AI-assisted document import; and asynchronous post-submission feedback.

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

- OTP-based login for admin, teacher, and student users
- Teacher test builder with manual MCQ creation
- Hybrid document import for `.docx` and text-based `.pdf`
- Extraction-first flow for existing MCQ papers
- AI fallback generation for plain notes, with a minimum generation floor
- Timed arena with server-authoritative deadlines
- Autosave with batch sync and safe submit handling
- AI feedback generated asynchronously after submission
- Teacher analytics and admin overview dashboards
- Automatic finished-test retention cleanup

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
npx prisma db push
npx prisma db seed
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
npm run db:push
npm run db:seed
npm run db:migrate:deploy
```

## Environment Variables

Use [.env.example](./.env.example) as the source of truth.

Important variables:

- `DATABASE_URL`: pooled PostgreSQL URL for runtime
- `DIRECT_URL`: direct PostgreSQL URL for migrations and Prisma CLI
- `REDIS_URL`: local Redis TCP URL
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: production Upstash Redis REST credentials
- `JWT_SECRET` and `JWT_REFRESH_SECRET`: auth signing secrets
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: SMTP credentials for OTP delivery
- `OPENAI_API_KEY`: required only for AI generation and AI feedback
- `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`: production QStash credentials
- `QSTASH_URL`: local QStash dev server URL
- `NEXT_PUBLIC_APP_URL`: public app URL
- `CRON_SECRET`: optional manual authorization for cron endpoints outside Vercel Cron

## Documentation Map

Use these files first when regaining context:

- [README.md](./README.md): current architecture and local setup
- [DEPLOYMENT.md](./DEPLOYMENT.md): Vercel, Neon, Upstash deployment steps
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md): pre-launch and go-live checklist
- [API_README.md](./API_README.md): current API surface
- [docs/archive/README.md](./docs/archive/README.md): historical planning and design notes

## Deployment Notes

- The app is configured for Vercel in [vercel.json](./vercel.json).
- Cron routes are already defined for reconciliation and finished-test cleanup.
- `/api/health` provides a simple readiness check for database and Redis.
- Primary deployment instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Operational Limits

- Text-based PDFs are supported. Scanned PDFs still need OCR.
- The AI document import path is designed for teacher workflows, not bulk ingestion pipelines.
- Concurrency claims should be based on deployed load testing, not local dev runs.

## API Reference

See [API_README.md](./API_README.md) for the current API surface.
