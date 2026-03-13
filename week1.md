
# Week 1 — Foundation, Auth System & Middleware

**Duration:** Days 1–7  
**Goal:** Database up, auth fully working, all middleware in place. By end of week, a user can login, get JWT cookies, hit protected routes, and reset their password.

---

## Day 1: Project Infrastructure Setup

### Docker & Database
- [ ] Create `docker-compose.yml` with PostgreSQL 16 + Redis 7 containers
- [ ] Configure volumes, ports (`5432`, `6379`), health checks
- [ ] Add `.env` file with all environment variables:
  - `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
  - `OPENAI_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`
- [ ] Add `.env.example` with placeholder values
- [ ] Update `.gitignore` to exclude `.env`

### Prisma Setup
- [ ] Install `prisma` and `@prisma/client`
- [ ] Create `prisma/schema.prisma`:
  - Provider: `postgresql`
  - Connection pooling config
  - All **enums**: `Role`, `UserStatus`, `TestStatus`, `TestSource`, `SessionStatus`, `Difficulty`
  - **User** table: `id`, `email`, `name`, `passwordHash`, `role`, `status`, `mustChangePassword`, `resetToken`, `resetTokenExpiry`, `createdAt`, `updatedAt`
  - **Batch** table: `id`, `name`, `code`, `teacherId` (FK), `status`, `createdAt`
  - **BatchStudent** join table: `batchId`, `studentId` (composite PK)
  - **Test** table: `id`, `teacherId`, `title`, `description`, `durationMinutes`, `status`, `source`, `settings` (JSON), `scheduledAt`, `createdAt`, `updatedAt`
  - **Question** table: `id`, `testId`, `order`, `stem`, `options` (JSON), `explanation`, `difficulty`, `topic`
  - **TestAssignment** table: `id`, `testId`, `batchId?`, `studentId?`, `assignedAt`
  - **TestSession** table: `id`, `testId`, `studentId`, `status`, `startedAt`, `serverDeadline`, `submittedAt`, `answers` (JSON), `tabSwitchCount`, `score`, `totalMarks`, `percentage`
  - **AIFeedback** table: `id`, `testSessionId`, `strengths`, `weaknesses`, `actionPlan`, `questionExplanations` (all JSON), `overallTag`, `generatedAt`
  - **AuditLog** table: `id`, `userId`, `action`, `metadata` (JSON), `ipAddress`, `createdAt`
  - All relations with `@relation` annotations and cascading deletes
- [ ] Run `npx prisma db push` — verify schema applies cleanly
- [ ] Run `npx prisma generate` — generate the client

### Singleton Clients
- [ ] Create `lib/prisma.ts` — Prisma client singleton (with hot-reload guard for dev)
- [ ] Create `lib/redis.ts` — ioredis client singleton with connection error handling

---

## Day 2: Seed Data & Verify Database

### Seed Script
- [ ] Create `prisma/seed.ts`:
  - 1 Admin: `admin@unimonk.com` (password: `admin123`)
  - 2 Teachers: `sarah@unimonk.com`, `michael@unimonk.com`
  - 10 Students with realistic names/emails
  - 3 Batches: "Physics 101 Evening", "Chemistry Advanced", "Mathematics Fundamentals"
  - Enroll students into batches via `BatchStudent`
  - 2 sample Tests with 5 questions each (PUBLISHED status)
  - 1 sample TestSession with score + AIFeedback (for results page testing)
- [ ] Add seed script to `package.json`: `"prisma": { "seed": "ts-node prisma/seed.ts" }`
- [ ] Install `ts-node` as dev dependency
- [ ] Run `npx prisma db seed` — verify data inserted correctly
- [ ] Test queries in Prisma Studio: `npx prisma studio`

---

## Day 3: Auth Utilities

### Password Hashing
- [ ] Install `bcryptjs` + `@types/bcryptjs`
- [ ] Create `lib/auth.ts`:
  - `hashPassword(plain: string): Promise<string>` — bcrypt, 12 salt rounds
  - `verifyPassword(plain: string, hash: string): Promise<boolean>` — bcrypt compare

### JWT Token Management
- [ ] Install `jsonwebtoken` + `@types/jsonwebtoken`
- [ ] Add to `lib/auth.ts`:
  - `generateAccessToken(userId: string, role: Role): string` — signs with `JWT_SECRET`, 15 min expiry, payload: `{userId, role, iat, exp}`
  - `generateRefreshToken(): string` — `crypto.randomUUID()`
  - `verifyAccessToken(token: string): JWTPayload | null` — verifies + decodes, returns null on failure
  - `generateResetToken(): { token: string, hashedToken: string }` — raw UUID for email + SHA-256 hash for DB storage

### Session Management
- [ ] Create `lib/session.ts`:
  - `createSession(userId, role)` → generates access + refresh tokens, stores `refresh:{token}` → `userId` in Redis with 7-day TTL, returns both tokens
  - `refreshSession(refreshToken)` → validates against Redis, deletes old token, generates new pair (rotation), returns new access token
  - `destroySession(userId)` → scans and removes all `refresh:*` keys for this userId from Redis
  - `destroyAllSessions(userId)` → same but used for password reset (invalidate everywhere)
  - `setAuthCookies(response, accessToken, refreshToken)` → sets httpOnly, secure, sameSite=Strict cookies
  - `clearAuthCookies(response)` → clears both cookies
  - `getSessionFromRequest(request)` → reads `access_token` cookie, verifies JWT, returns `{userId, role}` or null

---

## Day 4: Auth API Routes

### Login
- [ ] Create `app/api/auth/login/route.ts`:
  - `POST` handler
  - Parse body: `{email, password}` (Zod validation)
  - Find user by email in DB
  - If not found or INACTIVE/SUSPENDED → generic "Invalid credentials" (no user enumeration)
  - `verifyPassword()` check
  - `createSession()` → get tokens
  - `setAuthCookies()` on response
  - Insert `AuditLog` entry (LOGIN action)
  - Return `{user: {id, name, email, role, mustChangePassword}}`

### Logout
- [ ] Create `app/api/auth/logout/route.ts`:
  - `POST` handler
  - Read userId from JWT
  - `destroySession(userId)` in Redis
  - `clearAuthCookies()` on response
  - Insert `AuditLog` entry (LOGOUT)
  - Return `{message: "Logged out"}`

### Token Refresh
- [ ] Create `app/api/auth/refresh/route.ts`:
  - `POST` handler
  - Read `refresh_token` from cookies
  - `refreshSession(refreshToken)` — validates + rotates
  - Set new `access_token` cookie
  - Return `{message: "Refreshed"}`

---

## Day 5: Password Reset & Change APIs

### Forgot Password
- [ ] Create `app/api/auth/forgot-password/route.ts`:
  - `POST {email}`
  - Find user — if not found, still return 200 (prevent user enumeration)
  - Generate reset token → store hashed version + 30-min expiry in `User` record
  - Send email via Resend with link: `{APP_URL}/reset-password?token={rawToken}`
  - Return `{message: "If an account exists, a reset link has been sent."}`

### Reset Password
- [ ] Create `app/api/auth/reset-password/route.ts`:
  - `POST {token, newPassword}`
  - Hash the incoming token with SHA-256
  - Find user where `resetToken = hashedToken AND resetTokenExpiry > now()`
  - If not found → 400 "Invalid or expired token"
  - Hash new password with bcrypt
  - Update user's `passwordHash`, clear `resetToken` + `resetTokenExpiry`, set `mustChangePassword = false`
  - `destroyAllSessions(userId)` — force re-login everywhere
  - Return `{message: "Password reset successfully"}`

### Change Password (First Login)
- [ ] Create `app/api/auth/change-password/route.ts`:
  - `POST {oldPassword, newPassword}` — requires auth
  - Verify old password matches current hash
  - Validate new password (min 8 chars, not same as old)
  - Update `passwordHash`, set `mustChangePassword = false`
  - Return `{message: "Password changed"}`

### Email Service
- [ ] Install `resend` package
- [ ] Create `lib/services/email-service.ts`:
  - `sendPasswordResetEmail(to, resetUrl)` → uses Resend API
  - `sendWelcomeEmail(to, name, tempPassword)` → sent when admin creates a user
  - Template: clean HTML email with Unimonk branding

---

## Day 6: Middleware Stack

### Auth Guard
- [ ] Create `lib/middleware/auth-guard.ts`:
  - `withAuth(handler, allowedRoles?: Role[])` — Higher-Order Function
  - Reads JWT from cookie, verifies, checks role against allowedRoles
  - Injects `userId` and `role` into handler context
  - Returns 401 if no/invalid token, 403 if wrong role

### Input Validation
- [ ] Install `zod`
- [ ] Create `lib/middleware/validate.ts`:
  - `withValidation(schema: ZodSchema, handler)` — parses `req.json()`, returns 400 with detailed errors on failure
- [ ] Create initial validation schemas:
  - `lib/validations/auth.schema.ts`: `LoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema`, `ChangePasswordSchema`

### Rate Limiter
- [ ] Create `lib/middleware/rate-limiter.ts`:
  - `withRateLimit(key, maxRequests, windowSeconds, handler)` — Redis sliding window
  - Config: login = 5/min per IP, forgot-password = 3/min per IP, AI generate = 5/hour per user

### Error Handler
- [ ] Create `lib/middleware/error-handler.ts`:
  - `AppError` class: `{ message, statusCode, code }`
  - `withErrorHandler(handler)` — wraps in try/catch, returns structured JSON: `{error: true, code, message, details?}`
  - Logs errors with timestamp + request ID

---

## Day 7: Root Middleware + Integration Testing

### Next.js Root Middleware
- [ ] Create `middleware.ts` at project root:
  - Matcher config: `/admin/:path*`, `/teacher/:path*`, `/student/:path*`, `/arena/:path*`, `/api/admin/:path*`, `/api/teacher/:path*`, `/api/student/:path*`, `/api/arena/:path*`
  - Read `access_token` cookie → verify JWT
  - Role-route enforcement:
    - `/admin/*` → ADMIN only
    - `/teacher/*` → TEACHER only
    - `/student/*` → STUDENT only
    - `/arena/*` → any authenticated
  - If `mustChangePassword = true` → redirect to `/change-password`
  - Public passthrough: `/login`, `/reset-password`, `/api/auth/*`
  - Inject `x-user-id` and `x-user-role` headers for API routes

### Integration Testing
- [ ] Manually test full login flow: email/password → cookies set → access protected page
- [ ] Test role guard: login as student → try `/admin/dashboard` → expect redirect
- [ ] Test token refresh: wait 15 min (or shorten for testing) → verify auto-refresh
- [ ] Test password reset: request → check email (or log) → reset → verify new password works
- [ ] Test rate limiting: hit login 6 times rapidly → expect 429
- [ ] Run `npx next build` — verify all routes compile

---

## Week 1 Deliverables Checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | Docker (PostgreSQL + Redis) running | [ ] |
| 2 | Prisma schema with all 9 tables applied | [ ] |
| 3 | Seed data (admin, teachers, students, batches, tests) | [ ] |
| 4 | `lib/auth.ts` — hash, verify, JWT sign/verify, reset tokens | [ ] |
| 5 | `lib/session.ts` — create, refresh, destroy, cookies | [ ] |
| 6 | 6 auth API routes (login, logout, refresh, forgot, reset, change) | [ ] |
| 7 | Email service (password reset + welcome emails) | [ ] |
| 8 | 4 middleware modules (auth guard, rate limiter, validation, error handler) | [ ] |
| 9 | Root `middleware.ts` with role-based route protection | [ ] |
| 10 | All routes compile (`next build` passes) | [ ] |
# Archived planning note: this file reflects an earlier implementation plan and may mention services that are no longer used in the current codebase.
