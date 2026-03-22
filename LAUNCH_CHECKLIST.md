# Unimonk Launch Checklist

Use this file as the final go-live checklist for the current Vercel deployment model.

## 1. Infrastructure

- Vercel project created
- Neon database created in the same region as Vercel Functions
- Upstash Redis primary created in the same region
- Upstash QStash configured
- Custom domain ready if required

## 2. Environment Variables

- `DATABASE_URL` uses the Neon pooled host
- `DIRECT_URL` uses the Neon direct host
- `UPSTASH_REDIS_REST_URL` is set
- `UPSTASH_REDIS_REST_TOKEN` is set
- `JWT_SECRET` is set
- `JWT_REFRESH_SECRET` is set
- `NEXT_PUBLIC_APP_URL` matches the deployed domain
- `GMAIL_USER` is set
- `GMAIL_APP_PASSWORD` is set
- `QSTASH_TOKEN` is set
- `QSTASH_CURRENT_SIGNING_KEY` is set
- `QSTASH_NEXT_SIGNING_KEY` is set
- `OPENAI_API_KEY` is set if AI features are enabled
- `CRON_SECRET` is set for production cron authorization

## 3. Database

- `npm run db:migrate:deploy` completed successfully against production
- Seed data is not being used as production data
- One manual DB connection test passed
- No persistent environment has been updated via `db push`

## 4. Core Product Flows

- OTP send works
- OTP verify works
- logout clears the session
- admin can create users and batches
- owner admin can create a sub-admin
- sub-admin cannot manage the owner admin account
- admin/sub-admin can create a manual test
- admin/sub-admin can import a test from `.docx` or text-based `.pdf`
- admin/sub-admin can assign a test to free, paid, and mixed audiences correctly
- free user can start a free mock after lead capture
- enrolled student can start a paid mock and reattempt up to 4 total times
- autosave works
- submit works
- results page loads
- AI feedback flow works if enabled

## 5. Operational Checks

- `/api/health` returns `200`
- Vercel cron routes are enabled
- QStash webhooks are reachable
- reconcile job runs
- no critical build warnings are blocking deployment

## 6. Rehearsal

- Preview deployment tested end-to-end
- Production deployment smoke tested
- At least one rehearsal with real-like users completed
- Exam-day support plan is known: who watches logs, who can restart jobs, who can handle SMTP/OpenAI issues

## 7. Go/No-Go Rule

Go live only if:

- lint passes
- typecheck passes
- production build passes
- smoke tests pass
- OTP delivery works with real credentials
- the deployed environment matches the documented region and env setup
