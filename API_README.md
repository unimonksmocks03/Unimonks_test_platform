# Unimonk Test Platform — API Reference

This file documents the current API surface of the project.

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

## Admin Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/analytics/overview` | Admin dashboard overview |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users` | Create user |
| GET | `/api/admin/users/:id` | Get user |
| PATCH | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/batches` | List batches |
| POST | `/api/admin/batches` | Create batch |
| GET | `/api/admin/batches/:id` | Get batch details |
| PATCH | `/api/admin/batches/:id` | Update batch |
| DELETE | `/api/admin/batches/:id` | Delete batch |
| GET | `/api/admin/batches/:id/students` | List batch students |
| GET | `/api/admin/tests` | List all tests |
| DELETE | `/api/admin/tests/:id` | Force-delete a test |
| POST | `/api/admin/impersonate/:userId` | Start impersonation |
| POST | `/api/admin/stop-impersonation` | Stop impersonation |

## Teacher Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teacher/dashboard` | Teacher dashboard stats |
| GET | `/api/teacher/batches` | Teacher-owned batches |
| GET | `/api/teacher/tests` | List teacher tests |
| POST | `/api/teacher/tests` | Create draft test |
| GET | `/api/teacher/tests/:id` | Get test details |
| PATCH | `/api/teacher/tests/:id` | Update test |
| DELETE | `/api/teacher/tests/:id` | Delete draft or finished published test |
| POST | `/api/teacher/tests/:id/questions` | Add question |
| PATCH | `/api/teacher/tests/:id/questions/:qId` | Update question |
| DELETE | `/api/teacher/tests/:id/questions/:qId` | Delete question |
| POST | `/api/teacher/tests/:id/assign` | Assign test to teacher-owned batches or students |
| GET | `/api/teacher/tests/:id/analytics` | Test analytics |
| POST | `/api/teacher/tests/generate-from-doc` | DOCX/PDF import with extraction-first AI fallback |

## Student Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/student/dashboard` | Student dashboard data |
| GET | `/api/student/tests` | Assigned tests list |
| GET | `/api/student/results/:sessionId` | Full result payload |
| GET | `/api/student/results/:sessionId/feedback-status` | Lightweight AI feedback status |

## Arena Routes

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/arena/start` | Start or resume a test session |
| POST | `/api/arena/:sessionId/answer` | Save one answer |
| POST | `/api/arena/:sessionId/batch-answer` | Save multiple answers in one call |
| GET | `/api/arena/:sessionId/status` | Session status and remaining time |
| POST | `/api/arena/:sessionId/submit` | Submit test and enqueue AI feedback |
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
| GET | `/api/cron/tests-retention` | Purge finished tests past retention |
| POST | `/api/webhooks/ai-feedback` | QStash AI feedback worker |
| POST | `/api/webhooks/force-submit` | QStash force-submit worker |
| POST | `/api/webhooks/qstash-dlq` | QStash dead-letter intake |
