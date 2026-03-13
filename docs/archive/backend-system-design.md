
> Archived document. This file preserves an earlier design draft and is not the source of truth for the current implementation. Use [README.md](../../README.md), [DEPLOYMENT.md](../../DEPLOYMENT.md), [API_README.md](../../API_README.md), and [LAUNCH_CHECKLIST.md](../../LAUNCH_CHECKLIST.md) first.

# Backend System Design — Unimonk Test Platform

Complete backend architecture for auth, user management, APIs, middleware, real-time events, AI integration, analytics, and role-based content delivery. Designed for **400 concurrent students** with zero data loss.

---

## Architecture Overview

```mermaid
graph TB
    subgraph Client["Frontend (Next.js App Router)"]
        A[Browser Client]
    end

    subgraph Edge["Next.js Middleware Layer"]
        B[middleware.ts<br/>JWT verification + role routing]
    end

    subgraph API["Next.js API Routes (/app/api)"]
        C1[Auth Routes]
        C2[Admin Routes]
        C3[Teacher Routes]
        C4[Student Routes]
        C5[Arena Routes]
        C6[AI Routes]
        C7[SSE Endpoint]
    end

    subgraph Services["Backend Service Layer (/lib/services)"]
        D1[AuthService]
        D2[UserService]
        D3[BatchService]
        D4[TestService]
        D5[SubmissionService]
        D6[AIService]
        D7[AnalyticsService]
    end

    subgraph Data["Data Layer"]
        E1[(PostgreSQL<br/>via Prisma)]
        E2[(Redis<br/>Sessions + Queue)]
        E3[BullMQ Workers]
    end

    subgraph External["External Services"]
        F1[OpenAI API]
        F2[Resend Email]
    end

    A --> B --> API
    API --> Services
    Services --> E1
    Services --> E2
    E2 --> E3
    E3 --> F1
    Services --> F2
    D6 --> F1
```

---

## 1. Database Schema (PostgreSQL + Prisma)

### Core Tables

```mermaid
erDiagram
    User {
        uuid id PK
        string email UK
        string name
        string passwordHash
        enum role "ADMIN | TEACHER | STUDENT"
        enum status "ACTIVE | INACTIVE | SUSPENDED"
        boolean mustChangePassword
        string resetToken
        datetime resetTokenExpiry
        datetime createdAt
        datetime updatedAt
    }

    Batch {
        uuid id PK
        string name
        string code UK
        uuid teacherId FK
        enum status "ACTIVE | UPCOMING | COMPLETED"
        datetime createdAt
    }

    BatchStudent {
        uuid batchId FK
        uuid studentId FK
    }

    Test {
        uuid id PK
        uuid teacherId FK
        string title
        text description
        int durationMinutes
        enum status "DRAFT | PUBLISHED | ARCHIVED"
        enum source "MANUAL | AI_GENERATED"
        json settings "shuffleQuestions, showResult, passingScore"
        datetime scheduledAt
        datetime createdAt
        datetime updatedAt
    }

    Question {
        uuid id PK
        uuid testId FK
        int order
        text stem
        json options "Array of 4: {id, text, isCorrect}"
        text explanation
        enum difficulty "EASY | MEDIUM | HARD"
        string topic
    }

    TestAssignment {
        uuid id PK
        uuid testId FK
        uuid batchId FK "nullable"
        uuid studentId FK "nullable"
        datetime assignedAt
    }

    TestSession {
        uuid id PK
        uuid testId FK
        uuid studentId FK
        enum status "IN_PROGRESS | SUBMITTED | TIMED_OUT | FORCE_SUBMITTED"
        datetime startedAt
        datetime serverDeadline "authoritative timer"
        datetime submittedAt
        json answers "Array of {questionId, selectedOptionId, markedForReview, answeredAt}"
        int tabSwitchCount
        int score "nullable, filled after grading"
        int totalMarks
        float percentage
    }

    AIFeedback {
        uuid id PK
        uuid testSessionId FK
        json strengths "Array of strings"
        json weaknesses "Array of strings"
        json actionPlan "Array of strings"
        json questionExplanations "Map<questionId, explanation>"
        string overallTag "e.g. Accurate but slow"
        datetime generatedAt
    }

    AuditLog {
        uuid id PK
        uuid userId FK
        string action
        json metadata
        string ipAddress
        datetime createdAt
    }

    User ||--o{ Batch : "teaches"
    Batch ||--o{ BatchStudent : "has"
    User ||--o{ BatchStudent : "enrolled in"
    User ||--o{ Test : "creates"
    Test ||--o{ Question : "contains"
    Test ||--o{ TestAssignment : "assigned via"
    Batch ||--o{ TestAssignment : "receives"
    User ||--o{ TestSession : "attempts"
    Test ||--o{ TestSession : "generates"
    TestSession ||--o| AIFeedback : "analyzed by"
```

### Prisma Setup

#### [NEW] [schema.prisma](file:///Users/xyx/Desktop/Unimonk_test_platform/prisma/schema.prisma)
- Full schema with all tables above
- PostgreSQL provider with connection pooling
- Enums: `Role`, `UserStatus`, `TestStatus`, `TestSource`, `SessionStatus`, `Difficulty`

#### [NEW] [seed.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/prisma/seed.ts)
- Seeds 1 admin, 2 teachers, 10 students, 3 batches, 2 sample tests with questions

---

## 2. Authentication & Session System

### Flow Diagram

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as Middleware
    participant API as /api/auth/*
    participant DB as PostgreSQL
    participant R as Redis

    Note over B,R: LOGIN FLOW
    B->>API: POST /api/auth/login {email, password}
    API->>DB: Find user by email
    API->>API: bcrypt.compare(password, hash)
    API->>API: Generate JWT (accessToken: 15min)
    API->>API: Generate refreshToken (7 days)
    API->>R: Store refreshToken → userId mapping
    API->>B: Set httpOnly cookies (access_token, refresh_token)
    API->>DB: Insert AuditLog(LOGIN)

    Note over B,R: AUTHENTICATED REQUEST
    B->>M: Any request with cookies
    M->>M: Verify JWT from access_token cookie
    alt Token Valid
        M->>API: Forward request + inject userId, role
    else Token Expired
        M->>API: POST /api/auth/refresh
        API->>R: Validate refresh_token
        API->>API: Issue new access_token
        API->>B: Set new access_token cookie
    else Invalid
        M->>B: 401 → Redirect /login
    end

    Note over B,R: PASSWORD RESET FLOW
    B->>API: POST /api/auth/forgot-password {email}
    API->>DB: Find user, generate crypto.randomUUID() token
    API->>DB: Store hashed token + 30min expiry
    API->>B: Send email with /reset-password?token=xxx
    B->>API: POST /api/auth/reset-password {token, newPassword}
    API->>DB: Verify hashed token + expiry
    API->>DB: Update passwordHash, clear token
    API->>R: Invalidate all refresh tokens for user
```

### Implementation Files

#### [NEW] [lib/auth.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/auth.ts)
- `hashPassword(plain)` → bcrypt hash (12 rounds)
- `verifyPassword(plain, hash)` → bcrypt compare
- `generateAccessToken(userId, role)` → JWT, 15 min expiry, signed with `JWT_SECRET`
- `generateRefreshToken()` → crypto.randomUUID()
- `verifyAccessToken(token)` → decoded payload `{userId, role, iat, exp}`
- `generateResetToken()` → crypto.randomUUID(), hashed with SHA-256 for DB storage

#### [NEW] [middleware.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/middleware.ts)
```
Matching: /admin/*, /teacher/*, /student/*, /arena/*, /api/(admin|teacher|student|arena)/*
Logic:
  1. Read access_token from cookies
  2. Verify JWT → extract {userId, role}
  3. Role-route guard:
     - /admin/* → role must be ADMIN
     - /teacher/* → role must be TEACHER
     - /student/* → role must be STUDENT
     - /arena/* → any authenticated user
  4. If mustChangePassword=true → redirect to /change-password (except that route itself)
  5. Inject x-user-id, x-user-role headers for downstream API routes
  6. Public routes (/login, /reset-password, /api/auth/*) → passthrough
```

#### [NEW] [lib/session.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/session.ts)
- `createSession(userId, role)` → generates both tokens, stores refresh in Redis with TTL
- `refreshSession(refreshToken)` → validates Redis, rotates refresh token (one-time use)
- `destroySession(userId)` → removes all refresh tokens from Redis
- `getSessionUser(request)` → reads cookies, returns `{userId, role}` or null

#### Cookie Configuration
| Cookie | httpOnly | secure | sameSite | path | maxAge |
|---|---|---|---|---|---|
| `access_token` | ✅ | ✅ (prod) | `Strict` | `/` | 15 min |
| `refresh_token` | ✅ | ✅ (prod) | `Strict` | `/api/auth/refresh` | 7 days |

---

## 3. API Route Map

All API routes live in `/app/api/`. Every route handler validates input with **Zod**, returns typed responses, and logs errors.

### Auth Routes (`/api/auth/`)

| Method | Route | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/login` | `{email, password}` | Set cookies, `{user}` | Rate-limited: 5/min per IP |
| POST | `/refresh` | — (cookie) | New access_token cookie | Rotates refresh token |
| POST | `/logout` | — (cookie) | Clear cookies | Invalidates Redis session |
| POST | `/forgot-password` | `{email}` | `{message}` | Always returns 200 (no user enumeration) |
| POST | `/reset-password` | `{token, password}` | `{message}` | Verifies hashed token + expiry |
| POST | `/change-password` | `{oldPassword, newPassword}` | `{message}` | For first-login forced change |

### Admin Routes (`/api/admin/`) — requires `role=ADMIN`

| Method | Route | Body/Query | Returns | Notes |
|---|---|---|---|---|
| GET | `/users` | `?search&role&status&page&limit` | `{users[], total, page}` | Paginated, filterable |
| POST | `/users` | `{name, email, role}` | `{user, tempPassword}` | Auto-generates password, sends email |
| PATCH | `/users/:id` | `{name?, role?, status?}` | `{user}` | Partial update |
| DELETE | `/users/:id` | — | `{message}` | Soft-delete (status=INACTIVE) |
| GET | `/batches` | `?search&status&page&limit` | `{batches[], total}` | Paginated |
| POST | `/batches` | `{name, code, teacherId}` | `{batch}` | Unique code validation |
| PATCH | `/batches/:id` | `{name?, teacherId?, status?}` | `{batch}` | |
| DELETE | `/batches/:id` | — | `{message}` | Soft-delete |
| POST | `/batches/:id/students` | `{studentIds[]}` | `{added}` | Bulk enroll |
| DELETE | `/batches/:id/students/:studentId` | — | `{message}` | Unenroll |
| GET | `/analytics/overview` | — | `{totalUsers, totalTests, ...}` | Global stats |
| POST | `/impersonate/:userId` | — | New session as target user + audit log |
| POST | `/stop-impersonation` | — | Restore original session |

### Teacher Routes (`/api/teacher/`) — requires `role=TEACHER`

| Method | Route | Body/Query | Returns | Notes |
|---|---|---|---|---|
| GET | `/tests` | `?status&page&limit` | `{tests[], total}` | Teacher's own tests |
| POST | `/tests` | `{title, duration, settings}` | `{test}` | Creates DRAFT |
| PATCH | `/tests/:id` | `{title?, duration?, status?}` | `{test}` | DRAFT→PUBLISHED |
| DELETE | `/tests/:id` | — | `{message}` | Only DRAFT tests |
| GET | `/tests/:id/questions` | — | `{questions[]}` | |
| POST | `/tests/:id/questions` | `{stem, options[], ...}` | `{question}` | Zod validates 4 opts, 1 correct |
| PATCH | `/tests/:id/questions/:qId` | `{stem?, options?}` | `{question}` | |
| DELETE | `/tests/:id/questions/:qId` | — | `{message}` | Reorders remaining |
| POST | `/tests/:id/assign` | `{batchIds[], studentIds[]}` | `{assignments[]}` | |
| GET | `/tests/:id/analytics` | — | `{overview, students[], questionStats[]}` | |
| POST | `/tests/generate-from-doc` | `FormData(file)` | `{test (DRAFT)}` | AI pipeline, 5/hour limit |

### Student Routes (`/api/student/`) — requires `role=STUDENT`

| Method | Route | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/dashboard` | — | `{upcoming[], recent[], stats}` | Aggregated dashboard data |
| GET | `/tests` | — | `{assigned[], completed[]}` | Tests assigned to student |
| GET | `/results/:sessionId` | — | `{session, feedback}` | Score + AI feedback |

### Arena Routes (`/api/arena/`) — authenticated, validated enrollment

| Method | Route | Body | Returns | Notes |
|---|---|---|---|---|
| POST | `/start` | `{testId}` | `{sessionId, questions[], serverDeadline}` | **Questions WITHOUT correct answers** |
| POST | `/:sessionId/answer` | `{questionId, optionId}` | `{saved: true}` | Per-question auto-save |
| POST | `/:sessionId/submit` | — | `{score, percentage}` | Grades + queues AI feedback |
| GET | `/:sessionId/status` | — | `{timeRemaining, answeredCount}` | Server-authoritative time |
| POST | `/:sessionId/flag` | `{type: "TAB_SWITCH"}` | `{warningCount}` | Anti-cheat tracking |

### SSE Endpoint (`/api/events/`)

| Route | Purpose | Events Emitted |
|---|---|---|
| GET `/api/events/stream` | Long-lived SSE connection | `test:started`, `test:ending-soon`, `feedback:ready`, `session:force-submit` |

---

## 4. Middleware Stack

Every API request passes through these layers in order:

```mermaid
graph LR
    A[Request] --> B[Rate Limiter<br/>Redis sliding window]
    B --> C[Auth Middleware<br/>JWT verification]
    C --> D[Role Guard<br/>ADMIN/TEACHER/STUDENT]
    D --> E[Input Validation<br/>Zod schema]
    E --> F[Route Handler<br/>Business logic]
    F --> G[Error Handler<br/>Structured JSON errors]
    G --> H[Audit Logger<br/>Critical actions]
    H --> I[Response]
```

### Implementation Files

#### [NEW] [lib/middleware/rate-limiter.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/middleware/rate-limiter.ts)
- Redis sliding-window rate limiter
- Configurable per-route: login=5/min, AI generate=5/hour, arena submit=1/session

#### [NEW] [lib/middleware/auth-guard.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/middleware/auth-guard.ts)
- `withAuth(handler, allowedRoles[])` → HOF that wraps route handlers
- Verifies JWT, checks role, injects `userId` into request context

#### [NEW] [lib/middleware/validate.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/middleware/validate.ts)
- `withValidation(schema, handler)` → validates `req.json()` against Zod schema
- Returns `400 {error, details[]}` on validation failure

#### [NEW] [lib/middleware/error-handler.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/middleware/error-handler.ts)
- Catches all thrown errors, maps to structured JSON: `{error, code, message, details?}`
- `AppError` class for typed errors with HTTP status codes

---

## 5. Real-Time: Server-Sent Events (SSE)

### Why SSE over WebSockets
- One-directional (server → client) fits our use case
- Works through firewalls/proxies without special config
- Native browser support (`EventSource`)
- No socket library needed, simpler to scale

### Architecture

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as /api/events/stream
    participant R as Redis Pub/Sub

    B->>API: GET /api/events/stream (EventSource)
    API->>R: SUBSCRIBE to user:{userId} channel
    Note over API,R: Connection stays open

    Note over R: When test starts...
    R-->>API: Publish test:started event
    API-->>B: data: {"type":"test:started","testId":"xxx"}

    Note over R: When AI feedback is ready...
    R-->>API: Publish feedback:ready event
    API-->>B: data: {"type":"feedback:ready","sessionId":"xxx"}

    Note over R: When time is about to expire...
    R-->>API: Publish test:ending-soon event
    API-->>B: data: {"type":"test:ending-soon","remaining":300}
```

#### [NEW] [app/api/events/stream/route.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/app/api/events/stream/route.ts)
- Returns `ReadableStream` with `text/event-stream` headers
- Subscribes to Redis `user:{userId}` channel
- Sends heartbeat every 30s to keep connection alive
- Cleans up Redis subscription on `close`

#### [NEW] [lib/services/event-service.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/services/event-service.ts)
- `emitToUser(userId, event)` → publishes to Redis channel
- `emitToBatch(batchId, event)` → lookups all student IDs, publishes to each

---

## 6. AI Integration

### 6A. Auto Test Generation (Word → MCQ)

```mermaid
graph TB
    A[Teacher uploads .docx] --> B[mammoth extracts text]
    B --> C{Text > 8k tokens?}
    C -->|Yes| D[Chunk into 4k segments]
    C -->|No| E[Single prompt]
    D --> F[GPT-4o-mini per chunk]
    E --> F
    F --> G[Zod validate each question]
    G -->|Pass| H[Save as DRAFT test]
    G -->|Fail| I[Retry with GPT-4o]
    I -->|Pass| H
    I -->|Fail| J[Return partial + error report]
```

#### [NEW] [lib/services/ai-service.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/services/ai-service.ts)

```typescript
// Core functions:
generateQuestionsFromText(text: string, count: number): Promise<Question[]>
generatePersonalizedFeedback(session: TestSession, questions: Question[]): Promise<AIFeedback>
generateQuestionExplanation(question: Question, studentAnswer: string): Promise<string>

// Configuration:
- Model: gpt-4o-mini (default), fallback gpt-4o
- Temperature: 0.3 for MCQs (deterministic), 0.7 for feedback (creative)
- Max tokens per question: 500
- System prompt enforces strict JSON output matching Zod schema
```

#### AI Prompt Template (MCQ Generation)
```
You are an expert test creator. Generate {count} multiple-choice questions from
the following educational content. Each question MUST have:
- A clear, unambiguous stem
- Exactly 4 options labeled A-D
- Exactly 1 correct answer
- A brief explanation of why the correct answer is right
- A difficulty rating (EASY/MEDIUM/HARD)
- A topic tag

Content: {text}

Respond in JSON format: { questions: [...] }
```

### 6B. Instant AI Feedback (Post-Submission)

```mermaid
sequenceDiagram
    participant S as Student Browser
    participant API as Submit API
    participant Q as BullMQ
    participant W as Worker
    participant AI as OpenAI
    participant DB as PostgreSQL
    participant SSE as SSE Channel

    S->>API: POST /arena/:id/submit
    API->>DB: Grade (raw score) — instant
    API->>S: 200 {score, percentage} — instant response
    API->>Q: Enqueue AI feedback job

    Note over W: Async (2-5 seconds)
    Q->>W: Process job
    W->>DB: Fetch questions + student answers
    W->>AI: Generate personalized feedback
    AI->>W: {strengths, weaknesses, actionPlan, explanations}
    W->>DB: Store AIFeedback record
    W->>SSE: Emit feedback:ready to student
    SSE->>S: EventSource receives notification
    S->>S: UI updates — "AI Analysis Ready!"
```

**Key insight**: The student gets their **raw score instantly** upon submit. The AI-powered personalized feedback arrives **2-5 seconds later** via SSE and the results page auto-refreshes.

---

## 7. Submission Pipeline (400 Concurrent Students)

The highest-stress point in the system. Here's how we handle it:

```mermaid
graph TB
    subgraph "400 Students Submit"
        A1[Student 1] --> Q
        A2[Student 2] --> Q
        A3[Student ...] --> Q
        A4[Student 400] --> Q
    end

    Q[BullMQ Queue<br/>Redis-backed] --> W1[Worker 1]
    Q --> W2[Worker 2]
    Q --> W3[Worker 3]

    W1 --> V[Validate<br/>server deadline check]
    V --> G[Grade<br/>compare answers to correct options]
    G --> DB[(PostgreSQL<br/>bulk insert scores)]
    G --> AIQ[AI Feedback Queue<br/>lower priority]

    AIQ --> AW[AI Worker<br/>rate-limited to OpenAI]
    AW --> DB
    AW --> SSE[SSE: feedback:ready]
```

#### [NEW] [lib/queue/submission-queue.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/queue/submission-queue.ts)
- BullMQ queue: `test-submissions`
- Concurrency: 10 workers
- Job data: `{sessionId, answers[], submittedAt}`
- On process: validate deadline, grade, store score, enqueue AI job

#### [NEW] [lib/queue/ai-feedback-queue.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/queue/ai-feedback-queue.ts)
- BullMQ queue: `ai-feedback`
- Concurrency: 3 workers (respects OpenAI rate limits)
- Job data: `{sessionId}`
- On process: fetch session+questions, call AI, store feedback, emit SSE

#### [NEW] [lib/queue/workers.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/queue/workers.ts)
- Initializes both workers
- Retry policy: 3 attempts with exponential backoff
- Dead letter queue for failed jobs
- Metrics logging (process time, queue depth)

---

## 8. Role-Based Content Delivery

### How the same API serves different content per role

```mermaid
graph TB
    A[Request hits middleware.ts] --> B{Read JWT Role}
    B -->|ADMIN| C["/api/admin/* routes<br/>Full CRUD, all data, impersonation"]
    B -->|TEACHER| D["/api/teacher/* routes<br/>Own tests only, batch analytics"]
    B -->|STUDENT| E["/api/student/* routes<br/>Assigned tests only, own results only"]

    C --> F[Admin Dashboard<br/>Global stats, all users, all batches]
    D --> G[Teacher Dashboard<br/>Own tests, assigned batches, student performance]
    E --> H[Student Dashboard<br/>Upcoming tests, past results, AI feedback]
```

### Data Scoping Rules (enforced in service layer)

| Role | Users | Batches | Tests | Results | AI Feedback |
|---|---|---|---|---|---|
| **Admin** | All (CRUD) | All (CRUD) | All (read) | All (read) | All (read) |
| **Teacher** | Own students only | Own batches | Own tests (CRUD) | Per-test analytics | Aggregate only |
| **Student** | Self only | Own batches (read) | Assigned only | Own only | Own only |

#### [NEW] [lib/services/user-service.ts](file:///Users/xyx/Desktop/Unimonk_test_platform/lib/services/user-service.ts)
Every query is scoped: `WHERE teacherId = :currentUserId` (teacher) or `WHERE studentId = :currentUserId` (student). Admin sees all.

---

## 9. File Structure (New Backend Files)

```text
Unimonk_test_platform/
├── prisma/
│   ├── schema.prisma              # Full database schema
│   ├── seed.ts                    # Dev seed data
│   └── migrations/                # Auto-generated
├── lib/
│   ├── auth.ts                    # JWT + bcrypt utils
│   ├── session.ts                 # Cookie-based session management
│   ├── redis.ts                   # Redis client singleton
│   ├── prisma.ts                  # Prisma client singleton
│   ├── middleware/
│   │   ├── auth-guard.ts          # withAuth() HOF
│   │   ├── rate-limiter.ts        # Redis sliding-window
│   │   ├── validate.ts            # Zod validation wrapper
│   │   └── error-handler.ts       # Structured error responses
│   ├── services/
│   │   ├── auth-service.ts        # Login, register, reset logic
│   │   ├── user-service.ts        # User CRUD (role-scoped)
│   │   ├── batch-service.ts       # Batch CRUD + enrollment
│   │   ├── test-service.ts        # Test CRUD + questions
│   │   ├── submission-service.ts  # Grading logic
│   │   ├── ai-service.ts          # OpenAI integration
│   │   ├── analytics-service.ts   # Stats aggregation
│   │   ├── event-service.ts       # SSE pub/sub via Redis
│   │   └── email-service.ts       # Resend/SES wrapper
│   ├── queue/
│   │   ├── submission-queue.ts    # BullMQ: test submissions
│   │   ├── ai-feedback-queue.ts   # BullMQ: AI feedback gen
│   │   └── workers.ts             # Worker process
│   └── validations/
│       ├── auth.schema.ts         # Login, reset, change-password
│       ├── user.schema.ts         # Create/update user
│       ├── batch.schema.ts        # Create/update batch
│       ├── test.schema.ts         # Create/update test + questions
│       └── arena.schema.ts        # Start, answer, submit
├── app/api/
│   ├── auth/
│   │   ├── login/route.ts
│   │   ├── logout/route.ts
│   │   ├── refresh/route.ts
│   │   ├── forgot-password/route.ts
│   │   ├── reset-password/route.ts
│   │   └── change-password/route.ts
│   ├── admin/
│   │   ├── users/route.ts
│   │   ├── users/[id]/route.ts
│   │   ├── batches/route.ts
│   │   ├── batches/[id]/route.ts
│   │   ├── batches/[id]/students/route.ts
│   │   ├── analytics/overview/route.ts
│   │   ├── impersonate/[userId]/route.ts
│   │   └── stop-impersonation/route.ts
│   ├── teacher/
│   │   ├── tests/route.ts
│   │   ├── tests/[id]/route.ts
│   │   ├── tests/[id]/questions/route.ts
│   │   ├── tests/[id]/questions/[qId]/route.ts
│   │   ├── tests/[id]/assign/route.ts
│   │   ├── tests/[id]/analytics/route.ts
│   │   └── tests/generate-from-doc/route.ts
│   ├── student/
│   │   ├── dashboard/route.ts
│   │   ├── tests/route.ts
│   │   └── results/[sessionId]/route.ts
│   ├── arena/
│   │   ├── start/route.ts
│   │   ├── [sessionId]/answer/route.ts
│   │   ├── [sessionId]/submit/route.ts
│   │   ├── [sessionId]/status/route.ts
│   │   └── [sessionId]/flag/route.ts
│   └── events/
│       └── stream/route.ts
└── middleware.ts                   # Root Next.js middleware
```

---

## 10. Environment Variables Required

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/unimonk"

# Redis
REDIS_URL="redis://localhost:6379"

# Auth
JWT_SECRET="<random-64-char-string>"
JWT_REFRESH_SECRET="<random-64-char-string>"

# OpenAI
OPENAI_API_KEY="sk-..."

# Email (Resend)
RESEND_API_KEY="re_..."
FROM_EMAIL="noreply@unimonk.com"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

---

## 11. Packages to Install

```bash
# Database & ORM
npm install prisma @prisma/client

# Auth & Security
npm install bcryptjs jsonwebtoken
npm install -D @types/bcryptjs @types/jsonwebtoken

# Validation
npm install zod

# Redis & Queues
npm install ioredis bullmq

# AI
npm install openai

# File Parsing (Word → MCQ)
npm install mammoth

# Email
npm install resend

# Utilities
npm install nanoid
```

---

## 12. Implementation Order (Dependency Graph)

```mermaid
graph LR
    A["Phase 1<br/>Foundation"] --> B["Phase 2<br/>Auth System"]
    B --> C["Phase 3<br/>CRUD APIs"]
    C --> D["Phase 4<br/>Arena + Submission"]
    D --> E["Phase 5<br/>AI Integration"]
    E --> F["Phase 6<br/>Real-time + Polish"]
```

| Phase | What | Files | Est. Time |
|---|---|---|---|
| **1. Foundation** | Prisma schema, Redis client, Prisma client, seed data, env setup | `prisma/`, `lib/prisma.ts`, `lib/redis.ts` | 1 day |
| **2. Auth** | JWT utils, bcrypt, middleware, session management, login/logout/reset APIs, cookies | `lib/auth.ts`, `lib/session.ts`, `middleware.ts`, `app/api/auth/*` | 1-2 days |
| **3. CRUD APIs** | Admin users/batches, Teacher tests/questions, Student dashboard, Zod schemas, role guards | `lib/services/*`, `lib/validations/*`, `app/api/admin/*`, `app/api/teacher/*`, `app/api/student/*` | 2-3 days |
| **4. Arena** | Start session, answer tracking, server-authoritative timer, submission queue, instant grading | `app/api/arena/*`, `lib/queue/submission-queue.ts`, `lib/services/submission-service.ts` | 2 days |
| **5. AI** | OpenAI integration, Word→MCQ pipeline, personalized feedback, AI feedback queue | `lib/services/ai-service.ts`, `lib/queue/ai-feedback-queue.ts`, `app/api/teacher/tests/generate-from-doc/*` | 2 days |
| **6. Real-time** | SSE endpoint, Redis Pub/Sub, event service, connect frontend to live events, analytics service | `lib/services/event-service.ts`, `app/api/events/*`, `lib/services/analytics-service.ts` | 1-2 days |

**Total estimated: 9-12 days**

---

## Verification Plan

### Automated Tests
- `npx prisma db push` — verify schema applies cleanly
- `npx prisma db seed` — verify seed data inserts
- `npx next build` — verify all API routes compile
- Unit tests for `lib/auth.ts` (hash, verify, JWT sign/verify)
- Integration tests for critical flows (login → get token → access protected route → refresh)

### Manual Verification
- **Auth flow**: Login → check cookies in DevTools → access admin page → logout → verify redirect
- **Role guard**: Login as student → try accessing `/api/admin/users` → expect 403
- **Password reset**: Request reset → check email → use token → verify new password works
- **Arena submission**: Start test → answer questions → submit → verify instant score → wait for AI feedback SSE notification
- **Concurrency**: Use `autocannon` or `k6` to simulate 400 concurrent submissions hitting `/api/arena/:id/submit`

> [!IMPORTANT]
> This plan requires PostgreSQL and Redis running locally (or via Docker). Before starting Phase 1, we should set up `docker-compose.yml` for local development.
