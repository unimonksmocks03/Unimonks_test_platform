# Unimonk Test Platform — Vercel Deployment Guide

This project is designed to run on:

- Vercel
- Neon Postgres
- Upstash Redis
- Upstash QStash

Before going live, use [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) as the final gate.

## 1. Choose One Region First

Keep Vercel Functions, Neon, and the Upstash **primary** in the same region for launch. The repo is currently configured for `iad1` in [vercel.json](./vercel.json). Change that before deployment if your database primary is elsewhere.

## 2. Provision Services

### Neon

Create a Neon database and collect:

- a **pooled** connection string for `DATABASE_URL`
- a **direct** connection string for `DIRECT_URL`

Recommended runtime query params for Neon:

- `sslmode=require`
- `connect_timeout=15`
- `pool_timeout=15` on the pooled URL if needed

### Upstash Redis

Create a Redis database and collect:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

For local development you can keep using `REDIS_URL`.

### Upstash QStash

Create a QStash project and collect:

- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

For local development use:

- `QSTASH_URL=http://localhost:8080`

### SMTP

Set real SMTP credentials before launch:

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

If the client later provides a dedicated mail service, replace these env values without changing the auth flow.

### OpenAI

AI features are optional for launch, but if enabled set:

- `OPENAI_API_KEY`

## 3. Configure Vercel Project

Import the repository into Vercel and define environment variables for **Preview** and **Production**.

Minimum required variables:

```env
DATABASE_URL=
DIRECT_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
JWT_SECRET=
JWT_REFRESH_SECRET=
NEXT_PUBLIC_APP_URL=
GMAIL_USER=
GMAIL_APP_PASSWORD=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

Optional but recommended:

```env
OPENAI_API_KEY=
```

Required for production cron authorization:

```env
CRON_SECRET=
```

Do not set `QSTASH_URL` in production.

## 4. Run Database Migration

Before first live use:

```bash
npm run db:migrate:deploy
```

Do not use `db push` for Preview or Production. This codebase relies on committed migrations, and schema drift can cause runtime role/enum mismatches even when the app still builds.

## 5. Deploy Preview First

Use Preview before Production and test these flows end-to-end:

- send OTP
- verify OTP
- logout
- create test
- import test from document
- assign test to batch
- publish a free mock to `FREE-Batch`
- publish a paid mock to a standard batch
- start test
- autosave answers
- submit test
- AI feedback generation
- admin analytics
- admin impersonation
- sub-admin creation and owner-only protections

## 6. Verify Background Jobs

The repo already includes:

- `/api/webhooks/ai-feedback`
- `/api/webhooks/force-submit`
- `/api/webhooks/qstash-dlq`
- `/api/cron/reconcile-jobs`

On Vercel, cron schedules come from [vercel.json](./vercel.json). After deploy, confirm that:

- expired `IN_PROGRESS` sessions get reconciled
- missing AI feedback gets re-enqueued

## 7. Verify Health

Use:

```txt
/api/health
```

Expected result:

- HTTP `200` when database and Redis are both reachable
- HTTP `503` when either dependency is degraded

## 8. Go Live Checklist

- Production env vars are set
- `DATABASE_URL` uses Neon pooled host
- `DIRECT_URL` uses Neon direct host
- OTP mail delivery works with real credentials
- OpenAI features are either enabled with a valid key or intentionally hidden
- Vercel cron jobs are enabled
- Preview smoke test passed
- One rehearsal with real-like users completed

## 9. Post-Deploy Monitoring

Watch these areas first:

- OTP delivery failures
- QStash webhook retries and DLQ
- Neon cold-start or connection timeout errors
- Redis rate limit failures
- AI generation latency and failures
- Arena submit and autosave errors

## Local Dev Reminder

For local development:

```bash
docker compose up -d postgres redis
npx @upstash/qstash-cli@latest dev
npm run db:migrate:deploy
npm run db:seed
npm run dev
```
