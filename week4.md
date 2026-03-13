
# Week 4 — AI Integration, Analytics, Testing & Deployment Prep

**Duration:** Days 22–28  
**Goal:** AI-powered test generation from Word docs, personalized post-test feedback, teacher/admin analytics dashboards connected to real data, full end-to-end testing, security hardening, and deployment preparation.

---

## Day 22: AI Service — OpenAI Integration

### Core AI Service
- [ ] Install `openai` package
- [ ] Create `lib/services/ai-service.ts`:
  - Initialize OpenAI client with `OPENAI_API_KEY`
  - **`generateQuestionsFromText(text, count, subject?)`**:
    - System prompt: strict MCQ generation rules (4 options, 1 correct, JSON output)
    - Model: `gpt-4o-mini` (default), temperature: 0.3
    - Response format: structured JSON matching `CreateQuestionSchema`
    - Input token limit check: if `text > 8000 tokens` → chunk into 4000-token segments
    - Per-chunk generation with deduplication across chunks
    - Zod validation of each generated question:
      - Exactly 4 options? ✓
      - Exactly 1 correct? ✓
      - Non-empty stem and option text? ✓
    - If validation fails → retry with `gpt-4o` (higher quality, higher cost)
    - If still fails → return partial results + error report
    - Return `{questions: Question[], failedCount, totalCost}`

  - **`generatePersonalizedFeedback(session, questions)`**:
    - Input: student's answers, correct answers, scores, time data
    - System prompt: educational feedback specialist role
    - Model: `gpt-4o-mini`, temperature: 0.7 (more creative)
    - Output structure:
      - `strengths: string[]` — 3 specific things the student did well
      - `weaknesses: string[]` — 3 areas needing improvement
      - `actionPlan: string[]` — 3 concrete study recommendations
      - `overallTag: string` — e.g., "Accurate but slow", "Fast but careless"
      - `questionExplanations: Record<questionId, string>` — per-question explanation of the correct answer
    - Zod validation of response
    - Return `AIFeedback` object

  - **Cost tracking**:
    - Log input tokens, output tokens, model used, cost per request
    - Store in AuditLog for billing visibility

---

## Day 23: Word-to-MCQ Pipeline (Document Upload)

### File Parsing
- [ ] Install `mammoth` package
- [ ] Add to `lib/services/ai-service.ts`:
  - `parseDocxToText(buffer: Buffer): Promise<string>`:
    - Use `mammoth.extractRawText()` to get plain text
    - Strip excessive whitespace, normalize formatting
    - Return clean text string

### Upload API
- [ ] Create `app/api/teacher/tests/generate-from-doc/route.ts`:
  - `POST` → `withAuth(handler, ["TEACHER"])` — FormData with `file` field
  - Rate limit: **5 uploads per hour per teacher**
  - Validations:
    - File type: `.docx` only (check MIME type + extension)
    - File size: max 5MB
    - Reject if teacher has a generation already in progress
  - Pipeline:
    1. Read file buffer from FormData
    2. `parseDocxToText(buffer)` → extract text
    3. `generateQuestionsFromText(text, count)` → AI generates MCQs
    4. Create new `Test` with `status: DRAFT`, `source: AI_GENERATED`
    5. Insert all generated `Question` records
    6. **Drop the raw file immediately** (never stored on disk/S3)
    7. Log: AuditLog (AI_GENERATE) with token count + cost
  - Return `{test: {id, title}, questionsGenerated, failedCount, cost}`
  - Teacher can then navigate to test editor → review/edit → publish

### Connect to Teacher Frontend
- [ ] Add "Import from Document" button to test creation page
- [ ] File upload modal:
  - Drag & drop or file picker (accept `.docx` only)
  - Upload progress indicator
  - On success: redirect to test editor with generated questions pre-filled
  - On partial success: show warning banner "X questions failed to generate"
  - On rate limit hit: show countdown until next allowed upload

---

## Day 24: AI Feedback Worker & Results Integration

### Connect AI Feedback Queue to AI Service
- [ ] Update `lib/queue/workers.ts` (AI feedback worker):
  - Fetch `TestSession` with answers + all `Question` records
  - Call `aiService.generatePersonalizedFeedback(session, questions)`
  - Insert `AIFeedback` record into database
  - Emit SSE event: `feedback:ready` → `{sessionId, overallTag}`
  - Error handling: if OpenAI fails, retry 3 times, then mark in DB as `feedback_failed`

### Update Student Results Page (Frontend)
- [ ] Modify `/student/results/[testAttemptId]/page.tsx`:
  - Fetch real data from `GET /api/student/results/:sessionId`
  - **Immediate render**: Show score, percentage, time taken, rank
  - **AI section**: 
    - If `AIFeedback` exists → render strengths/weaknesses/action plan cards
    - If not yet available → show loading shimmer with "AI is analyzing your performance..."
    - Listen for SSE `feedback:ready` event → re-fetch and animate reveal
  - **Question review accordion**:
    - For each question: show stem, student's answer, correct answer
    - Show AI explanation (from `questionExplanations` map)
    - Color-code: green for correct, red for incorrect
  - **Overall tag** in hero section (e.g., "Accurate but slow")

---

## Day 25: Teacher & Admin Analytics

### Teacher Analytics API
- [ ] Create `app/api/teacher/tests/[id]/analytics/route.ts`:
  - `GET` → `withAuth(handler, ["TEACHER"])`
  - Verify test belongs to authenticated teacher
  - Return from `analyticsService.getTestAnalytics(testId)`:
    - **Overview tab**: total submissions, avg score, median, pass rate, score distribution (10 buckets)
    - **Student list tab**: `{name, email, score, percentage, timeTaken, submittedAt}[]` sorted by score DESC
    - **Question analysis tab**: for each question:
      - Question stem (truncated)
      - Correct response rate
      - Option selection breakdown (how many chose A, B, C, D)
      - Difficulty tag (EASY/MEDIUM/HARD)
      - Most-selected wrong option

### Connect to Teacher Analytics Frontend
- [ ] Update `/teacher/tests/[testId]/analytics/page.tsx`:
  - Fetch from `GET /api/teacher/tests/:id/analytics`
  - Replace all mock data with real API data
  - Score distribution chart → real data from API
  - Student performance table → real data with search/sort
  - Question analysis table → real breakdown per question

### Connect Admin Dashboard
- [ ] Update admin dashboard page:
  - Fetch from `GET /api/admin/analytics/overview`
  - Replace mock stat cards with real: total users, tests, sessions, avg score
  - If time allows: add trend charts (last 7 days)

---

## Day 26: Security Hardening & Edge Cases

### Input Sanitization
- [ ] Review all API routes for XSS prevention:
  - Zod `.trim()` on all string inputs
  - HTML entity encoding for user-submitted text displayed on frontend
  - SQL injection: already prevented by Prisma (parameterized queries) — verify

### Authentication Hardening
- [ ] Password policy enforcement:
  - Min 8 chars, at least 1 uppercase, 1 lowercase, 1 number
  - Add Zod regex validation to `ChangePasswordSchema` and `ResetPasswordSchema`
- [ ] Account lockout: after 5 failed login attempts → lock account for 15 minutes (Redis counter)
- [ ] Refresh token rotation: ensure old refresh tokens are invalidated after use
- [ ] Session invalidation: on password change, destroy ALL sessions across devices

### Arena Security
- [ ] Verify correct answers NEVER appear in any API response during test
- [ ] Verify `serverDeadline` is authoritative — client timer is decorative only
- [ ] Verify late submissions are rejected (with 30s grace period for network latency)
- [ ] Verify `answers` JSON can't be tampered (validated against question IDs)
- [ ] Rate limit answer saves: max 2/second per session

### API Security
- [ ] CORS configuration: only allow `NEXT_PUBLIC_APP_URL` origin
- [ ] Helmet-equivalent headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`
- [ ] Request size limits: 5MB for file uploads, 100KB for JSON bodies
- [ ] Log all admin actions (user create/delete, impersonation) to AuditLog

### Data Scoping Audit
- [ ] Verify every teacher API scopes queries with `WHERE teacherId = :userId`
- [ ] Verify every student API scopes queries with `WHERE studentId = :userId`
- [ ] Write test cases: student tries to access another student's results → 403
- [ ] Write test cases: teacher tries to access another teacher's test → 403

---

## Day 27: End-to-End Testing & Performance

### Full Flow Tests (Manual)
- [ ] **Admin flow**: Login → create teacher → create student → create batch → enroll student → verify
- [ ] **Teacher flow**: Login → create test → add 10 questions → publish → assign to batch → view analytics after submissions
- [ ] **Student flow**: Login → see dashboard with upcoming test → enter arena → answer all questions → submit → see instant score → wait for AI feedback → review results
- [ ] **Password reset flow**: Forgot password → receive email → reset → login with new password
- [ ] **Impersonation flow**: Admin → impersonate student → see student dashboard → stop impersonation → back to admin
- [ ] **AI generation flow**: Teacher → upload .docx → review generated questions → edit → publish

### Performance Testing
- [ ] Install `k6` for load testing
- [ ] Write load test scripts:
  - **Login storm**: 100 concurrent logins → expect all under 500ms
  - **Arena submit storm**: 400 concurrent submits → expect all graded within 10s
  - **Dashboard load**: 200 concurrent dashboard fetches → expect all under 1s
- [ ] Run tests, analyze results:
  - P95 response time for each endpoint
  - Redis queue depth during submit storm
  - PostgreSQL connection count (verify pooling works)
  - Memory usage on Node process

### Fix Any Issues Found
- [ ] Address any failures from testing
- [ ] Optimize slow queries (add indexes if needed):
  - `User.email` — unique index (already from Prisma)
  - `Batch.code` — unique index
  - `TestSession(testId, studentId)` — composite index
  - `TestAssignment(testId, batchId)` — composite index
  - `AuditLog(userId, createdAt)` — for admin audit trail queries

---

## Day 28: Deployment Preparation & Documentation

### Environment & Config
- [ ] Create production `.env.production` template
- [ ] Configure `next.config.ts` for production:
  - Enable `output: 'standalone'` for Docker deployment
  - Configure allowed image domains if any
  - Set security headers
- [ ] Create production `docker-compose.prod.yml`:
  - PostgreSQL with backup volume
  - Redis with persistence (AOF)
  - Next.js app container
  - BullMQ worker container (separate process)
  - Nginx reverse proxy (optional)

### Database
- [ ] Switch from `db push` to proper migrations: `npx prisma migrate dev`
- [ ] Export final migration set for production
- [ ] Document rollback procedures for each migration

### Documentation
- [ ] Update `Backend_system_design.md` with any changes made during implementation
- [ ] Create `API_README.md` with:
  - How to run locally (Docker setup)
  - Environment variables reference
  - API endpoint documentation (or link to auto-generated docs)
  - Authentication flow explanation
  - Common error codes and meanings
- [ ] Create `DEPLOYMENT.md` with:
  - Prerequisites (Node 20+, Docker, PostgreSQL, Redis)
  - Step-by-step deployment instructions
  - Monitoring & logging setup
  - Backup strategy

### Final Verification
- [ ] `npx next build` — zero errors
- [ ] `npx prisma migrate deploy` — runs cleanly
- [ ] All API routes respond correctly
- [ ] SSE connections stable over 5 minutes
- [ ] AI generation works with sample documents
- [ ] Queue workers process and complete jobs
- [ ] Rate limiting works correctly
- [ ] All role guards enforced
- [ ] Run full E2E flow one more time

---

## Week 4 Deliverables Checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | AI service: `generateQuestionsFromText()` with Zod validation | [ ] |
| 2 | AI service: `generatePersonalizedFeedback()` with cost tracking | [ ] |
| 3 | Word-to-MCQ upload endpoint (5MB, docx, 5/hour limit) | [ ] |
| 4 | AI feedback worker connected to queue + SSE | [ ] |
| 5 | Student results page showing real scores + AI feedback | [ ] |
| 6 | Teacher analytics connected to real data | [ ] |
| 7 | Admin dashboard connected to real data | [ ] |
| 8 | Security hardening: password policy, lockout, CORS, headers | [ ] |
| 9 | Data scoping audit: every query verified for role isolation | [ ] |
| 10 | Performance testing: 400 concurrent submits pass | [ ] |
| 11 | Docker production config ready | [ ] |
| 12 | Prisma migrations exported for production | [ ] |
| 13 | Documentation: API_README.md, DEPLOYMENT.md | [ ] |
| 14 | Full E2E flow passing (admin → teacher → student → results) | [ ] |

---

## Month-End Summary

By the end of 4 weeks, the platform will have:

| Layer | What's Complete |
|---|---|
| **Database** | 9 PostgreSQL tables, seed data, production migrations |
| **Auth** | JWT + refresh tokens, httpOnly cookies, password reset, account lockout |
| **Middleware** | Rate limiting, auth guards, Zod validation, error handling, audit logging |
| **Admin APIs** | Users CRUD, batches CRUD, enrollment, analytics, impersonation |
| **Teacher APIs** | Tests CRUD, questions CRUD, assignment, analytics, AI doc-upload |
| **Student APIs** | Dashboard, assigned tests, results with AI feedback |
| **Arena** | Start, auto-save answers, submit, server timer, anti-cheat, force-submit |
| **Queues** | BullMQ submission (10 concurrency) + AI feedback (3 concurrency) |
| **Real-time** | SSE via Redis Pub/Sub (test events, feedback ready) |
| **AI** | Word→MCQ generation, personalized feedback, cost tracking |
| **Security** | Role isolation, data scoping, no answer leakage, rate limits, lockout |
| **Deployment** | Docker configs, Prisma migrations, documentation |
# Archived planning note: this file reflects an earlier implementation plan and may mention services that are no longer used in the current codebase.
