<h1 align="center">Unimonk Test Platform (Backend Architecture Showcase)</h1>

<p align="center">
  A highly scalable, production-grade EdTech testing platform designed to handle <strong>400+ concurrent student test submissions with zero data loss</strong>. This project serves as a showcase of advanced backend engineering patterns, custom authentication flows, asynchronous job processing, and AI integrations within the Next.js ecosystem.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16%20App%20Router-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-Robust%20Relational%20DB-blue?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Prisma-TypeSafe%20ORM-2D3748?style=for-the-badge&logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Redis-Session%20%26%20Rate%20Limit-DC382D?style=for-the-badge&logo=redis" alt="Redis" />
  <img src="https://img.shields.io/badge/BullMQ-Async%20Job%20Queues-FFB13B?style=for-the-badge" alt="BullMQ" />
  <img src="https://img.shields.io/badge/OpenAI-GPT_4o_Mini-412991?style=for-the-badge&logo=openai" alt="OpenAI" />
</p>

---

## 🚀 Key Engineering Highlights & Standout Features

While many tutorial applications rely on BaaS (Backend-as-a-Service) providers like Clerk or Supabase, this project implements **everything entirely from scratch** to demonstrate deep understanding of backend systems:

- **Custom JWT & Refresh Token Rotation via Redis:** Built a custom session management system from the ground up. Short-lived Access Tokens (15m) and long-lived Refresh Tokens (7d). Refresh tokens are stored in Redis allowing for immediate, server-side session invalidation on logout or password changes.
- **Asynchronous Submission Pipeline (BullMQ):** Grading 400 synchronized test submissions synchronously would block the Node event loop and cause timeouts. This platform instantly returns a raw score, but pushes the heavy AI analysis off to a Redis-backed BullMQ Queue.
- **Batch Answer Synchronization:** Instead of firing an API request on every single option click, the Arena interface queues answers locally and flushes them to the server via a `/batch-answer` endpoint periodically, drastically reducing horizontal network load during high-concurrency exams.
- **Real-Time Push via Server-Sent Events (SSE):** Replaced heavy WebSockets with raw Server-Sent Events utilizing Redis Pub/Sub. The moment a BullMQ worker finishes generating AI feedback, an event is pushed directly to the exact student's browser tab over a persistent HTTP connection to auto-refresh the UI.
- **Strict Role-Based Middleware Guarding:** A multi-layered architecture where the Edge Middleware prevents illegal UI access, while deep service-level restrictions prevent horizontal privilege escalation (e.g., a Teacher can only fetch their *own* Batches, a Student can only view their *own* Test results).
- **AI-Driven DocX to Test Pipeline:** Teachers can upload raw `.docx` study material. The backend extracts text using `mammoth`, chunks it intelligently, and streams it to OpenAI to deterministically generate strict JSON validation-checked Multiple Choice Questions.

---

## 🏗️ System Architecture & Design

> **[View the Complete System Architecture Markdown →](./Backend_system_design.md)**

Below is a high-level overview of the request lifecycle demonstrating the separation of concerns:

```mermaid
graph LR
    A[Request] --> B[Redis Rate Limiter]
    B --> C[Next.js Middleware<br/>JWT verification]
    C --> D[Role Guard<br/>ADMIN/TEACHER/STUDENT]
    D --> E[Zod Input Validation]
    E --> F[API Route Handler]
    F --> G[Service Layer<br/>Business logic]
    G --> H[(PostgreSQL / Prisma)]
    F --> I[Structured Error Handler]
```

### 1. Database Schema
Modeled in PostgreSQL via Prisma, featuring 8 core models including `User`, `Batch`, `Test`, `Question`, and `TestSession`.
* **Advanced design pattern:** Used `JSONB` fields for dynamic question options and AI Feedback data, preventing the need for overly complex, rigid relational joins for strictly nested, read-heavy data.

### 2. The Test Arena (Concurrency Management)
When a student starts a test, the server defines the `serverDeadline`. The client cannot cheat the timer.
Upon submission, the route `/api/arena/[sessionId]/submit` leverages a queue system:
1. **Synchronous Phase:** The API grades the test instantly against the DB and returns the score (sub-50ms).
2. **Asynchronous Phase:** The API adds an `ai-feedback` job to the BullMQ queue. A background Node worker processes this queue, interfaces with OpenAI, saves the insight to PostgreSQL, and pushes a notification back to the client via Redis SSE.

---

## ⚙️ Tech Stack Breakdown

### Core Backend Setup
- **Framework:** Next.js 16 (App Router + API Routes)
- **Language:** TypeScript (Strict Mode)
- **Database:** PostgreSQL (Relational)
- **ORM:** Prisma Studio & Client
- **Caching & Queues:** Redis Server, BullMQ
- **Email Delivery:** Resend SDK

### Security & Validation
- **Authentication:** `jsonwebtoken`, `bcryptjs`, and native `crypto.randomUUID()`
- **Input Validation:** Zod schema validation injected at the middleware level route-by-route.
- **Rate Limiting:** Custom sliding-window rate limiters built on Redis to protect Login APIs and AI Generation endpoints from DDoS and spam.

---

## 💻 Local Setup & Development

To run this backend architecture locally:

### 1. Prerequisites
You must have **Node.js 20+**, **PostgreSQL**, and **Redis** running on your local machine.

### 2. Clone & Install
```bash
git clone https://github.com/tohin003/Unimonks-test-platform.git
cd Unimonks-test-platform
npm install
```

### 3. Environment Variables
Create a `.env` file based on `.env.example`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/unimonk"
REDIS_URL="redis://localhost:6379"

JWT_SECRET="generate-a-random-secure-string"
JWT_REFRESH_SECRET="generate-another-random-secure-string"

OPENAI_API_KEY="sk-your-key-here"
RESEND_API_KEY="re_your_resend_key_here"
FROM_EMAIL="noreply@yourdomain.com"
```

### 4. Database Initialization
```bash
# Push the schema to your PostgreSQL database
npx prisma db push

# Seed the database with sample Admins, Teachers, Students, and Tests
npx prisma db seed
```

### 5. Start the Server
```bash
# Start the Next.js development server
npm run dev

# (Optional) In a separate terminal, start the Prisma Studio DB viewer
npx prisma studio
```

---
*Architected and developed by [Tohin](https://github.com/tohin003).*
