# Unimonk Test Platform — API Reference

## Authentication

All API routes are protected by JWT-based authentication via httpOnly cookies. The middleware enforces role-based access control.

### Auth Flow
1. `POST /api/auth/send-otp` — Send OTP to email
2. `POST /api/auth/verify-otp` — Verify OTP → receive access + refresh tokens via cookies
3. `POST /api/auth/refresh` — Rotate refresh token → new access token
4. `POST /api/auth/logout` — Destroy all sessions

### Error Codes
| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | Request body failed Zod validation |
| `UNAUTHORIZED` | Missing or invalid access token |
| `FORBIDDEN` | Role doesn't have access to this resource |
| `NOT_FOUND` | Resource doesn't exist |
| `ACCOUNT_LOCKED` | Too many failed login attempts (15 min lockout) |
| `RATE_LIMITED` | Too many requests (varies by endpoint) |
| `PAYLOAD_TOO_LARGE` | JSON body > 100KB |

---

## Admin Routes (`/api/admin/*`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/users` | List all users (with search, filter, pagination) |
| POST | `/api/admin/users` | Create a new user |
| GET | `/api/admin/users/:id` | Get user details |
| PATCH | `/api/admin/users/:id` | Update user (name, role, status) |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/batches` | List all batches |
| POST | `/api/admin/batches` | Create a new batch |
| GET | `/api/admin/batches/:id` | Get batch details + enrolled students |
| PATCH | `/api/admin/batches/:id` | Update batch |
| DELETE | `/api/admin/batches/:id` | Delete batch |
| GET | `/api/admin/tests` | List all tests |
| GET | `/api/admin/tests/:id` | Get test details |
| DELETE | `/api/admin/tests/:id` | Delete test |

---

## Teacher Routes (`/api/teacher/*`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teacher/dashboard` | Teacher stats (batches, tests, attempts) |
| GET | `/api/teacher/batches` | List teacher's assigned batches |
| GET | `/api/teacher/tests` | List teacher's tests |
| POST | `/api/teacher/tests` | Create a new test |
| GET | `/api/teacher/tests/:id` | Get test with questions |
| PATCH | `/api/teacher/tests/:id` | Update test |
| DELETE | `/api/teacher/tests/:id` | Delete test |
| POST | `/api/teacher/tests/:id/questions` | Add a question |
| PATCH | `/api/teacher/tests/:id/questions/:qId` | Update a question |
| DELETE | `/api/teacher/tests/:id/questions/:qId` | Delete a question |
| POST | `/api/teacher/tests/:id/assign` | Assign test to batches |
| GET | `/api/teacher/tests/:id/analytics` | Test analytics |
| POST | `/api/teacher/tests/generate-from-doc` | AI: Upload .docx → generate MCQs |

---

## Student Routes (`/api/student/*`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/student/dashboard` | Student dashboard stats |
| GET | `/api/student/tests` | List assigned tests |
| GET | `/api/student/results/:sessionId` | Get test results + AI feedback |

---

## Arena Routes (`/api/arena/*`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/arena/start` | Start a test session |
| POST | `/api/arena/:sessionId/answer` | Save an answer (rate limited: 2/sec) |
| POST | `/api/arena/:sessionId/submit` | Submit test → instant grading |
| GET | `/api/arena/:sessionId/status` | Get time remaining + progress |
| POST | `/api/arena/:sessionId/flag` | Flag anti-cheat violation |

---

## Real-Time Events (`/api/events/*`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events/stream` | SSE stream for real-time events |

### Event Types
- `feedback:ready` — AI feedback generated for a session
- `test:started` — Test session started
- `test:submitted` — Test submitted
