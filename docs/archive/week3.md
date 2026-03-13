
> Archived document. This file preserves an earlier week-by-week implementation plan and is no longer authoritative for the current codebase.

# Week 3 — Live Test Arena, Submission Pipeline & Real-Time Events

**Duration:** Days 15–21  
**Goal:** Students can start a test, answer questions with auto-save, submit with instant grading, and receive real-time event notifications via SSE. Server-authoritative timer prevents cheating.

---

## Day 15: Arena Start & Question Delivery

### Submission Service (Core)
- [ ] Create `lib/services/submission-service.ts`:
  - `startTestSession(studentId, testId)`:
    - Verify test is PUBLISHED and student is assigned → 403 if not
    - Check for existing IN_PROGRESS session → resume if exists
    - Check test hasn't been completed already by this student → 409 if so
    - Create `TestSession` with:
      - `status: IN_PROGRESS`
      - `startedAt: new Date()`
      - `serverDeadline: new Date(now + test.durationMinutes * 60 * 1000)`
      - `answers: []` (empty JSON array)
      - `tabSwitchCount: 0`
    - Fetch all questions for this test (shuffled if `settings.shuffleQuestions`)
    - **CRITICAL: Strip `isCorrect` from options and `explanation` before sending to client**
    - Return `{sessionId, questions: [{id, order, stem, options: [{id, text}]}], serverDeadline, durationMinutes}`

### Arena Start API
- [ ] Create `app/api/arena/start/route.ts`:
  - `POST {testId}` → `withAuth(handler, ["STUDENT"])` + `withValidation(StartTestSchema)`
  - Calls `submissionService.startTestSession(userId, testId)`
  - Returns questions **without correct answers**

### Arena Status API
- [ ] Create `app/api/arena/[sessionId]/status/route.ts`:
  - `GET` → `withAuth`
  - Verify session belongs to authenticated student
  - Calculate `timeRemaining = serverDeadline - now()` (in seconds)
  - Return `{timeRemaining, answeredCount, totalQuestions, tabSwitchCount, status}`

---

## Day 16: Answer Auto-Save & Anti-Cheat

### Per-Question Auto-Save
- [ ] Add to `lib/services/submission-service.ts`:
  - `saveAnswer(studentId, sessionId, questionId, optionId)`:
    - Verify session belongs to student and status = IN_PROGRESS
    - Verify `serverDeadline > now()` → reject late answers
    - Update `answers` JSON array: upsert by questionId (add or replace)
    - Set `answeredAt: new Date()` on the answer entry
    - Return `{saved: true, answeredCount}`

### Answer API
- [ ] Create `app/api/arena/[sessionId]/answer/route.ts`:
  - `POST {questionId, optionId}` → `withAuth` + `withValidation(AnswerSchema)`
  - Rate limit: 2 answers/second per session (prevent scripted spam)
  - Return `{saved: true}`

### Anti-Cheat Flag API
- [ ] Add to `lib/services/submission-service.ts`:
  - `flagViolation(studentId, sessionId, type)`:
    - Increment `tabSwitchCount` in DB
    - If count >= 3 → auto-submit the test (call `submitTest`)
    - Log to AuditLog with violation type
    - Return `{warningCount, autoSubmitted}`

- [ ] Create `app/api/arena/[sessionId]/flag/route.ts`:
  - `POST {type}` → `withAuth` + `withValidation(FlagSchema)`
  - Return `{warningCount, autoSubmitted: boolean}`

---

## Day 17: Test Submission & Instant Grading

### Grading Logic
- [ ] Add to `lib/services/submission-service.ts`:
  - `submitTest(studentId, sessionId, force?: boolean)`:
    - Verify session belongs to student and status = IN_PROGRESS
    - If not `force`: verify `serverDeadline > now()` (grace period: +30 seconds for network latency)
    - Fetch all questions for the test with correct answers
    - Grade each answer:
      ```
      for each answer in session.answers:
        find matching question
        if answer.optionId matches the isCorrect option → score += 1
      ```
    - Calculate `percentage = (score / totalQuestions) * 100`
    - Update TestSession:
      - `status: force ? FORCE_SUBMITTED : SUBMITTED`
      - `submittedAt: new Date()`
      - `score`, `totalMarks`, `percentage`
    - Return `{score, totalMarks, percentage, timeTaken}`

### Submit API
- [ ] Create `app/api/arena/[sessionId]/submit/route.ts`:
  - `POST` → `withAuth`
  - Calls `submissionService.submitTest(userId, sessionId)`
  - **Enqueues AI feedback job** (async, non-blocking)
  - Returns instant `{score, totalMarks, percentage}` — student sees score IMMEDIATELY

### Server Timer Enforcement
- [ ] Add scheduled check (via BullMQ repeatable job):
  - Every 60 seconds: scan `TestSession` where `status = IN_PROGRESS AND serverDeadline < now()`
  - Force-submit each expired session: `submitTest(studentId, sessionId, true)`
  - Set status = `TIMED_OUT`
  - Emit SSE event: `session:force-submit`

---

## Day 18: BullMQ Submission Queue (Concurrency Handling)

### Queue Setup
- [ ] Install `bullmq`
- [ ] Create `lib/queue/submission-queue.ts`:
  - Queue name: `test-submissions`
  - Job data: `{sessionId, studentId}`
  - Concurrency: 10 workers (handles 400 submissions by processing in batches)
  - Retry policy: 3 attempts, exponential backoff (1s, 4s, 16s)
  - Job completion event → log metrics (processing time, queue depth)

### AI Feedback Queue
- [ ] Create `lib/queue/ai-feedback-queue.ts`:
  - Queue name: `ai-feedback`
  - Job data: `{sessionId}`
  - Concurrency: 3 workers (respects OpenAI API rate limits)
  - Priority: lower than submission queue
  - On completion: emit `feedback:ready` via SSE

### Worker Process
- [ ] Create `lib/queue/workers.ts`:
  - Initialize both workers
  - Submission worker:
    1. Fetch session from DB
    2. Grade answers
    3. Update session with score
    4. Enqueue AI feedback job
  - AI feedback worker:
    1. Fetch session + questions + student answers
    2. Call `aiService.generatePersonalizedFeedback()`
    3. Store `AIFeedback` record
    4. Emit SSE: `feedback:ready` to student
  - Dead-letter queue for permanently failed jobs
  - Health check: expose queue metrics via admin API

### Update Submit API to Use Queue
- [ ] Modify `app/api/arena/[sessionId]/submit/route.ts`:
  - **Instant grading stays synchronous** (fast, ~50ms) — student gets score immediately
  - **AI feedback is enqueued** asynchronously via BullMQ
  - This ensures the submit response is fast even under 400 concurrent requests

---

## Day 19: Server-Sent Events (SSE)

### Redis Pub/Sub Setup
- [ ] Create `lib/services/event-service.ts`:
  - `createPublisher()` → dedicated Redis connection for publishing
  - `emitToUser(userId, event)`:
    - Publishes to `channel:user:{userId}`
    - Event format: `{type, data, timestamp}`
  - `emitToBatch(batchId, event)`:
    - Lookups all student IDs in batch
    - Publishes to each student's channel
  - Event types:
    - `test:started` — when teacher publishes a test
    - `test:ending-soon` — 5 minutes before deadline
    - `feedback:ready` — when AI feedback is generated
    - `session:force-submit` — when server force-submits

### SSE Endpoint
- [ ] Create `app/api/events/stream/route.ts`:
  - `GET` handler → `withAuth` (any role)
  - Returns `ReadableStream` with headers:
    - `Content-Type: text/event-stream`
    - `Cache-Control: no-cache`
    - `Connection: keep-alive`
  - Creates new Redis subscriber for `channel:user:{userId}`
  - On message: encode as SSE format `data: {json}\n\n`
  - Heartbeat: send `:ping\n\n` every 30 seconds
  - Clean up: unsubscribe + close Redis connection on stream cancel/close

### Frontend SSE Client
- [ ] Create `lib/hooks/use-events.ts`:
  - Custom React hook: `useEvents(onEvent: (event) => void)`
  - Creates `EventSource('/api/events/stream')`
  - Auto-reconnect on error (with exponential backoff)
  - Returns `{connected, lastEvent}`

---

## Day 20: Connect Arena Frontend to Real APIs

### Update TestInterfaceClient.tsx
- [ ] On mount: call `POST /api/arena/start` with `testId` from URL params
- [ ] Render real questions from API response (not hardcoded mock)
- [ ] Remove all static question/option data
- [ ] Timer: use `serverDeadline` from API instead of local countdown
  - Sync with `GET /api/arena/:id/status` every 60s as drift correction
- [ ] On answer selection: call `POST /api/arena/:id/answer` (debounced, 500ms)
- [ ] On "Clear": call `POST /api/arena/:id/answer` with `optionId: null`
- [ ] On "Mark for Review": store locally (add to answer with `markedForReview: true`)
- [ ] On "Save & Next": save answer + advance to next question
- [ ] On "Finish Test": call `POST /api/arena/:id/submit`
  - Show instant score in a modal/overlay
  - Redirect to `/student/results/:sessionId` after 2 seconds
- [ ] Tab switch detection: call `POST /api/arena/:id/flag` on blur event

### Update Student Results Page
- [ ] On mount: call `GET /api/student/results/:sessionId`
- [ ] Show instant score data immediately
- [ ] Listen for `feedback:ready` SSE event
- [ ] When event received: re-fetch results → show AI feedback section
- [ ] Animate the AI section appearing (fade-in transition)

---

## Day 21: Arena Integration Testing

### Functional Tests
- [ ] Start test → verify questions received (no correct answers in payload)
- [ ] Answer question → verify saved (check DB)
- [ ] Clear answer → verify removed
- [ ] Submit test → verify instant score returned
- [ ] Wait for AI feedback → verify SSE notification received
- [ ] Tab switch 3 times → verify auto-submit triggered
- [ ] Let timer expire → verify server force-submits
- [ ] Try to answer after submit → verify 400 rejection
- [ ] Try to start same test twice → verify resume (not duplicate)

### Concurrency Stress Test
- [ ] Write a simple load test script (using `k6` or `autocannon`):
  - Simulate 50 students starting a test simultaneously
  - Each answers 10 questions, then submits
  - Verify all scores recorded correctly, no data loss
  - Monitor queue depth and processing time

### Security Tests
- [ ] Try accessing questions API directly → verify correct answers stripped
- [ ] Try submitting for another student's session → verify 403
- [ ] Try submitting after deadline → verify rejection
- [ ] Inspect network tab → verify no `isCorrect` or `explanation` in question payloads

---

## Week 3 Deliverables Checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | Arena start API → returns questions WITHOUT correct answers | [ ] |
| 2 | Per-question auto-save API (debounced) | [ ] |
| 3 | Anti-cheat flag API (tab switch tracking, auto-submit at 3) | [ ] |
| 4 | Instant grading on submit (~50ms response) | [ ] |
| 5 | Server-authoritative timer with force-submit on expiry | [ ] |
| 6 | BullMQ submission queue (10 concurrency, retry, DLQ) | [ ] |
| 7 | BullMQ AI feedback queue (3 concurrency) | [ ] |
| 8 | SSE endpoint with Redis Pub/Sub | [ ] |
| 9 | Frontend arena connected to real APIs (no mock data) | [ ] |
| 10 | Results page shows instant score + async AI feedback | [ ] |
| 11 | Concurrency test passing (50 simultaneous users) | [ ] |
