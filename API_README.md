# Unimonk Test Platform - API Reference

This file documents the current active API surface after the legacy role cleanup.

## Product Rules

- Login is only for the admin and enrolled students.
- Public free-mock users are stored as leads and do not authenticate.
- Paid tests allow 4 total attempts per student.
- Free tests allow 1 total attempt per lead.
- Published tests stay available until an admin archives or deletes them.

## Authentication

Authentication is cookie-based.

Flow:

1. `POST /api/auth/send-otp`
2. `POST /api/auth/verify-otp`
3. `POST /api/auth/refresh`
4. `GET /api/auth/session`
5. `POST /api/auth/logout`

## Shared Error Codes

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | Request payload or query params are invalid |
| `UNAUTHORIZED` | Missing or invalid session |
| `FORBIDDEN` | Caller is authenticated but not allowed |
| `NOT_FOUND` | Resource does not exist |
| `RATE_LIMITED` | Caller exceeded endpoint rate limits |
| `PAYLOAD_TOO_LARGE` | JSON request exceeded the proxy limit |
| `OTP_DELIVERY_FAILED` | OTP email could not be sent |

## Public Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/public/free-tests` | List published free mocks |
| GET | `/api/public/free-tests/:testId` | Get public free-mock details |
| POST | `/api/public/free-tests/:testId/lead` | Create or update the lead before a free attempt |
| POST | `/api/public/free-tests/:testId/start` | Start the single free attempt for a lead |
| GET | `/api/public/free-sessions/:sessionId/status` | Free-session timer and state |
| POST | `/api/public/free-sessions/:sessionId/batch-answer` | Save multiple answers for a free session |
| POST | `/api/public/free-sessions/:sessionId/submit` | Submit a free session |
| GET | `/api/public/free-sessions/:sessionId/result` | Fetch the final free-session result |

## Admin Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/analytics/overview` | Admin dashboard overview |
| GET | `/api/admin/users` | List admin and student users |
| POST | `/api/admin/users` | Create a student user |
| PATCH | `/api/admin/users/:id` | Update a user |
| DELETE | `/api/admin/users/:id` | Deactivate a user |
| GET | `/api/admin/batches` | List batches |
| POST | `/api/admin/batches` | Create a standard paid batch |
| GET | `/api/admin/batches/:id` | Get batch details |
| PATCH | `/api/admin/batches/:id` | Update a batch |
| DELETE | `/api/admin/batches/:id` | Disable or permanently delete a batch |
| POST | `/api/admin/batches/:id/students` | Enroll students into a batch |
| DELETE | `/api/admin/batches/:id/students` | Remove a student from a batch |
| GET | `/api/admin/tests` | List tests |
| POST | `/api/admin/tests` | Create a draft test |
| GET | `/api/admin/tests/:id` | Get test details |
| PATCH | `/api/admin/tests/:id` | Update or publish a test |
| DELETE | `/api/admin/tests/:id` | Delete a test |
| GET | `/api/admin/tests/:id/questions` | List test questions |
| POST | `/api/admin/tests/:id/questions` | Add a question |
| PATCH | `/api/admin/tests/:id/questions/:qId` | Update a question |
| DELETE | `/api/admin/tests/:id/questions/:qId` | Delete a question |
| POST | `/api/admin/tests/:id/assign` | Assign a test batch-wise |
| GET | `/api/admin/tests/:id/analytics` | Test analytics |
| POST | `/api/admin/tests/generate-from-doc` | Admin document import with extraction-first AI fallback |
| GET | `/api/admin/leads` | Lead queue and filters |
| PATCH | `/api/admin/leads/:id` | Mark a lead reviewed or update lead state |
| POST | `/api/admin/impersonate/:userId` | Start student impersonation |
| POST | `/api/admin/stop-impersonation` | Restore the admin session |

## Student Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/student/dashboard` | Student dashboard data |
| GET | `/api/student/tests` | Assigned paid tests with attempt state |
| GET | `/api/student/results/:sessionId` | Full paid-test result payload |
| GET | `/api/student/results/:sessionId/feedback-status` | Lightweight AI feedback status |

## Arena Routes

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/arena/start` | Start or resume a paid test attempt |
| POST | `/api/arena/:sessionId/answer` | Save one answer |
| POST | `/api/arena/:sessionId/batch-answer` | Save multiple answers in one call |
| GET | `/api/arena/:sessionId/status` | Session status and remaining time |
| POST | `/api/arena/:sessionId/submit` | Submit a paid attempt and enqueue AI feedback |
| POST | `/api/arena/:sessionId/flag` | Record anti-cheat signals |

## Event and Operational Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events/poll` | Pull queued user events |
| GET | `/api/health` | Database and Redis readiness check |

## Internal Cron and Webhook Routes

These are internal operational endpoints and should not be used directly by frontend clients.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/cron/reconcile-jobs` | Reconcile expired sessions and missing feedback |
| POST | `/api/webhooks/ai-feedback` | QStash AI feedback worker |
| POST | `/api/webhooks/force-submit` | QStash force-submit worker |
| POST | `/api/webhooks/qstash-dlq` | QStash dead-letter intake |
