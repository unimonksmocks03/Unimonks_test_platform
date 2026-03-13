> Archived document. This file preserves an earlier week-by-week implementation plan and is no longer authoritative for the current codebase.

# Week 2 — CRUD APIs, Zod Schemas & Role-Based Data Scoping

**Duration:** Days 8–14  
**Goal:** All admin, teacher, and student APIs fully working with proper validation, role guards, and data scoping. Frontend connected to real APIs replacing mock data.

---

## Day 8: Zod Validation Schemas (All Modules)

### User Schemas
- [ ] Create `lib/validations/user.schema.ts`:
  - `CreateUserSchema`: `{name: string (2-100), email: email, role: enum(STUDENT|TEACHER|ADMIN)}`
  - `UpdateUserSchema`: all fields optional, partial of CreateUser + `status: enum`
  - `UserQuerySchema`: `{search?: string, role?: enum, status?: enum, page?: number (min 1), limit?: number (max 100)}`

### Batch Schemas
- [ ] Create `lib/validations/batch.schema.ts`:
  - `CreateBatchSchema`: `{name: string (2-100), code: string (regex: uppercase+dash), teacherId: uuid}`
  - `UpdateBatchSchema`: partial of above + `status: enum`
  - `BatchQuerySchema`: `{search?: string, status?: enum, page, limit}`
  - `EnrollStudentsSchema`: `{studentIds: uuid[] (min 1, max 200)}`

### Test Schemas
- [ ] Create `lib/validations/test.schema.ts`:
  - `CreateTestSchema`: `{title: string (3-200), description?: string, durationMinutes: number (5-300), settings: {shuffleQuestions: boolean, showResult: boolean, passingScore: number (0-100)}}`
  - `UpdateTestSchema`: partial + `status: enum(DRAFT|PUBLISHED|ARCHIVED)`
  - `CreateQuestionSchema`: `{stem: string (min 10), options: array of exactly 4 {id: string, text: string (min 1), isCorrect: boolean} with exactly 1 correct, explanation: string, difficulty: enum, topic: string}`
  - `UpdateQuestionSchema`: partial of above (still validates 4 options + 1 correct if options provided)
  - `AssignTestSchema`: `{batchIds?: uuid[], studentIds?: uuid[]}` (at least one required)

### Arena Schemas
- [ ] Create `lib/validations/arena.schema.ts`:
  - `StartTestSchema`: `{testId: uuid}`
  - `AnswerSchema`: `{questionId: uuid, optionId: string}`
  - `FlagSchema`: `{type: enum("TAB_SWITCH"|"RIGHT_CLICK"|"COPY_ATTEMPT")}`

---

## Day 9: Admin User Management APIs

### User Service
- [ ] Create `lib/services/user-service.ts`:
  - `listUsers(query: UserQuery)` → paginated, filtered, returns `{users, total, page, totalPages}`
    - Search: `WHERE name ILIKE %search% OR email ILIKE %search%`
    - Filter: `AND role = ? AND status = ?`
    - Pagination: `OFFSET + LIMIT`
  - `createUser(data: CreateUser)`:
    - Check email uniqueness → 409 if duplicate
    - Generate temp password (8 chars, alphanumeric)
    - Hash password with bcrypt
    - Create user with `mustChangePassword = true`
    - Call `emailService.sendWelcomeEmail(email, name, tempPassword)`
    - Return `{user, tempPassword}` (tempPassword shown to admin once, never stored)
  - `updateUser(id, data: UpdateUser)` → partial update, return updated user
  - `deleteUser(id)` → soft delete: set `status = INACTIVE`, destroy all sessions

### Admin API Routes
- [ ] Create `app/api/admin/users/route.ts`:
  - `GET` → `withAuth(handler, ["ADMIN"])` + `withValidation(UserQuerySchema)` → `userService.listUsers()`
  - `POST` → `withAuth` + `withValidation(CreateUserSchema)` → `userService.createUser()` + AuditLog
- [ ] Create `app/api/admin/users/[id]/route.ts`:
  - `PATCH` → `withAuth` + `withValidation(UpdateUserSchema)` → `userService.updateUser()`
  - `DELETE` → `withAuth` → `userService.deleteUser()` + AuditLog

---

## Day 10: Admin Batch Management APIs

### Batch Service
- [ ] Create `lib/services/batch-service.ts`:
  - `listBatches(query)` → paginated, search by name/code, filter by status
  - `createBatch(data)`:
    - Validate unique code → 409 if duplicate
    - Validate teacherId exists and role is TEACHER → 400 if not
    - Create batch, return `{batch}`
  - `updateBatch(id, data)` → partial update
  - `deleteBatch(id)` → soft delete (status = COMPLETED, or hard delete if no students)
  - `enrollStudents(batchId, studentIds[])`:
    - Validate all studentIds exist and are STUDENT role
    - Skip already-enrolled (upsert with `skipDuplicates`)
    - Return `{added: number, skipped: number}`
  - `unenrollStudent(batchId, studentId)` → remove from BatchStudent
  - `getBatchStudents(batchId)` → list all enrolled students with basic info

### Admin Batch API Routes
- [ ] Create `app/api/admin/batches/route.ts`:
  - `GET` → list batches (paginated, filtered)
  - `POST` → create batch + AuditLog
- [ ] Create `app/api/admin/batches/[id]/route.ts`:
  - `GET` → single batch with student count
  - `PATCH` → update batch
  - `DELETE` → delete batch
- [ ] Create `app/api/admin/batches/[id]/students/route.ts`:
  - `POST` → bulk enroll students (body: `{studentIds[]}`)
  - `DELETE` → unenroll single student (query: `?studentId=xxx`)

---

## Day 11: Teacher Test & Question APIs

### Test Service
- [ ] Create `lib/services/test-service.ts`:
  - `listTests(teacherId, query)` → **scoped to teacher's own tests only**
  - `createTest(teacherId, data)` → creates DRAFT test, returns `{test}`
  - `updateTest(teacherId, testId, data)`:
    - Verify test belongs to teacher → 403 if not
    - If publishing (DRAFT → PUBLISHED): validate at least 1 question exists
    - If archiving: only PUBLISHED tests can be archived
  - `deleteTest(teacherId, testId)` → only DRAFT tests can be deleted
  - `getQuestions(teacherId, testId)` → returns ordered questions (verify ownership)
  - `addQuestion(teacherId, testId, data)`:
    - Verify test is DRAFT and belongs to teacher
    - Auto-set `order` to next available
    - Validate exactly 4 options, exactly 1 correct
  - `updateQuestion(teacherId, testId, questionId, data)` → verify ownership chain
  - `deleteQuestion(teacherId, testId, questionId)`:
    - Delete and reorder remaining questions
  - `assignTest(teacherId, testId, {batchIds, studentIds})`:
    - Test must be PUBLISHED
    - Create TestAssignment records
    - (Future: trigger SSE notification to assigned students)

### Teacher API Routes
- [ ] Create `app/api/teacher/tests/route.ts`:
  - `GET` → list own tests
  - `POST` → create draft test
- [ ] Create `app/api/teacher/tests/[id]/route.ts`:
  - `GET` → single test with question count
  - `PATCH` → update test (including publish)
  - `DELETE` → delete draft test
- [ ] Create `app/api/teacher/tests/[id]/questions/route.ts`:
  - `GET` → list questions for test
  - `POST` → add question
- [ ] Create `app/api/teacher/tests/[id]/questions/[qId]/route.ts`:
  - `PATCH` → update question
  - `DELETE` → delete question + reorder
- [ ] Create `app/api/teacher/tests/[id]/assign/route.ts`:
  - `POST` → assign test to batches/students

---

## Day 12: Student APIs

### Student Service
- [ ] Create `lib/services/student-service.ts`:
  - `getDashboard(studentId)`:
    - Upcoming tests: join `TestAssignment` → `Test` where `status = PUBLISHED` and `scheduledAt > now()`, **scoped to student's batches + direct assignments**
    - Recent results: join `TestSession` where `studentId = ?`, ordered by `submittedAt DESC`, limit 5
    - Stats: total tests taken, average score, best score
  - `getAssignedTests(studentId)` → all tests assigned to this student (via batch or direct)
  - `getResult(studentId, sessionId)`:
    - Verify session belongs to student → 403 if not
    - Return session data + AIFeedback (if generated)

### Student API Routes
- [ ] Create `app/api/student/dashboard/route.ts`:
  - `GET` → `withAuth(handler, ["STUDENT"])` → `studentService.getDashboard(userId)`
- [ ] Create `app/api/student/tests/route.ts`:
  - `GET` → list assigned tests
- [ ] Create `app/api/student/results/[sessionId]/route.ts`:
  - `GET` → score + AI feedback (ownership-verified)

---

## Day 13: Admin Extras (Analytics, Impersonation)

### Analytics Service
- [ ] Create `lib/services/analytics-service.ts`:
  - `getAdminOverview()`:
    - Total users by role (count GROUP BY)
    - Total tests by status
    - Total sessions completed
    - Average platform score
    - Active sessions count (from Redis)
  - `getTestAnalytics(testId)` (used by teacher too):
    - Score distribution (histogram buckets)
    - Average score, median, pass rate
    - Per-question stats: correct %, most-selected wrong option
    - Top 5 students, bottom 5 students
    - Time analysis: average time per question

### Admin Analytics & Impersonation Routes
- [ ] Create `app/api/admin/analytics/overview/route.ts`:
  - `GET` → global platform stats
- [ ] Create `app/api/admin/impersonate/[userId]/route.ts`:
  - `POST` → stores original admin session in Redis, creates new session as target user, sets AuditLog (IMPERSONATE_START)
- [ ] Create `app/api/admin/stop-impersonation/route.ts`:
  - `POST` → restores original admin session from Redis, AuditLog (IMPERSONATE_END)

---

## Day 14: Connect Frontend to Real APIs

### Replace Mock Data
- [ ] Admin users page → fetch from `GET /api/admin/users` with search/filter params
- [ ] Admin batches page → fetch from `GET /api/admin/batches`
- [ ] Admin batch detail → fetch from `GET /api/admin/batches/:id`
- [ ] Admin create user dialog → `POST /api/admin/users`
- [ ] Admin edit user sheet → `PATCH /api/admin/users/:id`
- [ ] Teacher tests page → fetch from `GET /api/teacher/tests`
- [ ] Student dashboard → fetch from `GET /api/student/dashboard`
- [ ] Student results page → fetch from `GET /api/student/results/:id`

### Create API Client Utility
- [ ] Create `lib/api-client.ts`:
  - Wrapper around `fetch` that auto-handles: JSON parsing, error extraction, token refresh on 401
  - `apiClient.get(url, params?)`, `apiClient.post(url, body)`, `apiClient.patch(url, body)`, `apiClient.delete(url)`

### Test All Flows
- [ ] Login as admin → navigate to users → search → create user → edit → verify
- [ ] Login as teacher → view tests → verify only own tests shown
- [ ] Login as student → dashboard loads → results page works

---

## Week 2 Deliverables Checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | 5 Zod validation schema files (auth, user, batch, test, arena) | [ ] |
| 2 | User service with CRUD + temp password generation + email | [ ] |
| 3 | Batch service with CRUD + enrollment (bulk + single) | [ ] |
| 4 | Test service with CRUD + questions + assignment (teacher-scoped) | [ ] |
| 5 | Student service with dashboard + results (student-scoped) | [ ] |
| 6 | Analytics service (admin overview + test analytics) | [ ] |
| 7 | Impersonation flow (start + stop + audit trail) | [ ] |
| 8 | 20+ API routes all with auth guards + validation | [ ] |
| 9 | Frontend connected to real APIs (no more mock data) | [ ] |
| 10 | All flows tested manually (admin, teacher, student) | [ ] |
