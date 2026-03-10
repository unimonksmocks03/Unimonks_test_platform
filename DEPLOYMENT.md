# Unimonk Test Platform — Deployment Guide

## Prerequisites

| Dependency | Version |
|---|---|
| Node.js | 20+ |
| PostgreSQL | 14+ |
| Redis | 7+ |
| Docker & Docker Compose | Latest |
| npm | 9+ |

---

## Local Development

```bash
# 1. Clone & install
git clone <repo-url> && cd Unimonk_test_platform
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, JWT_SECRET, etc.

# 3. Push schema & seed
npx prisma db push
npx prisma db seed

# 4. Start dev server
npm run dev
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/unimonk` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret for signing JWTs (min 32 chars) | `your-secure-random-string-here` |
| `OPENAI_API_KEY` | OpenAI API key for AI features (optional) | `sk-...` |
| `RESEND_API_KEY` | Resend API key for email (optional) | `re_...` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app (CORS enforcement) | `https://unimonk.example.com` |
| `NODE_ENV` | Environment mode | `production` |

---

## Production Deployment

### Option 1: Docker Compose

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Run database migrations
docker compose exec app npx prisma migrate deploy

# View logs
docker compose logs -f app
```

### Option 2: Standalone Node.js

```bash
# Build
npm run build

# Run database migrations
npx prisma migrate deploy

# Start production server
npm start

# Start BullMQ workers (separate process)
npx ts-node lib/queue/workers.ts
```

---

## Database Migrations

```bash
# Create a migration from schema changes
npx prisma migrate dev --name <description>

# Apply migrations in production
npx prisma migrate deploy

# Rollback: Reset to a specific migration
npx prisma migrate resolve --rolled-back <migration-name>
```

---

## Monitoring & Health

- **Application logs**: `stdout` via Node.js console
- **Queue monitoring**: BullMQ dashboard (install `bull-board` if needed)
- **Database**: Use `pgAdmin` or `psql` for direct queries
- **Redis**: `redis-cli monitor` for real-time command tracking

---

## Backup Strategy

```bash
# PostgreSQL backup
pg_dump -Fc $DATABASE_URL > backup_$(date +%Y%m%d).dump

# Restore
pg_restore -d $DATABASE_URL backup.dump

# Redis: AOF persistence enabled by default in Docker config
```
