
# EdTech MCQ Test Platform - Architecture & Implementation Plan

## Goal Description
Build a robust, highly concurrent MCQ testing platform for an EdTech company. The platform allows admins to manage users (teachers and students) and batches. Teachers can create tests (Google Forms style) and assign them to batches or individuals. Students take tests in a live interactive environment, and upon submission, an AI system analyzes mistakes and provides personalized feedback. The system is designed to handle 400 concurrent students safely.

## 1. System Architecture & Technology Stack

### Backend & Infrastructure
- **Backend:** Node.js with Express (or NestJS), TypeScript (with Zod for schema validation)
- **Database:** PostgreSQL (with connection pooling like PgBouncer or Prisma's built-in pooling)
- **Caching & Message Queue:** Redis, BullMQ (for handling mass submissions, AI task throttling, and cron jobs)
- **AI & File Parsing:** OpenAI API (GPT-4o / GPT-4o-mini) and `mammoth` for `.docx` parsing
- **Email Service:** Resend or AWS SES for reliable bulk transactional emails

### Frontend & Design System
- **Framework:** Next.js App Router, React, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui (Radix Primitives)
- **Typography:** Inter (Google Font)
- **Color Palette:** 
  - *Primary:* Indigo-600 (Brand, primary buttons)
  - *Secondary:* Slate-200 (Secondary buttons, backgrounds)
  - *Accent:* Emerald-500 (Success, correct answers)
  - *Destructive:* Rose-600 (Errors, incorrect answers)
  - *Warning:* Amber-500 (Timers, flags)
  - *Muted:* Slate-500 (Helper text)
  - *Surface:* Slate-50 / White

## 2. Authentication Strategy: Admin-Provisioned Passwords
- Admins create accounts for Teachers and Students, linking email/phone.
- Initial auto-generated temporary password sent via email.
- Users are forced to change their password on first login.
- Avoids OTP bottlenecks during mass login right before a test starts.

## 3. App Shell & Global Layout System
- **Desktop (>= 1024px):** Fixed left sidebar (w-64) with Logo, Primary Nav, and User Profile (w/ Impersonation state). Main content area features a sticky top header (Breadcrumbs, Global Search cmd+k, Notifications, Theme Toggle).
- **Mobile/Tablet (< 1024px):** Sidebar becomes a hidden drawer (Slide-in Sheet) triggered by a Hamburger menu. Sticky top header.
- **Loading States:** Next.js `loading.tsx` skeleton screens, thin progress bar on route transitions (nprogress), and Sonner/React Hot Toast for notifications.

## 4. Core Modules & Feature Breakdown

### A. Admin Module
- **Dashboard & User Management**: CRU(D) for Teachers and Students, Role management, Batch management (e.g., "Physics 101 Batch A"). Global Analytics.
- **UI Design**: Dense data table with filtering (Search, Role, Status), bulk actions, and side-panel drawers (Slide-over Sheet) for editing users.
- **Impersonation**: Prominent global banner when active. Replaces current session securely for troubleshooting.

### B. Teacher Module
- **Dashboard**: Grid layout with stats cards (Active Tests, Pending Evaluations, Avg Score), Recent Tests list with sparklines, and a mini-calendar schedule.
- **Analytics**: Single Test View with three tabs: [Overview] (Score distribution, Key metrics), [Student List], [Question Analysis] (Question stem, difficulty, correct response rate, and option selection breakdown).
- **Test Builder & AI Generator (Deep Dive)**: 
  - *Manual Builder*: Three-Pane Layout (Left: Sortable Navigator, Middle: Editor, Right: Settings). Zustand state with 2s auto-save. Validation to prevent publishing incomplete tests.
  - *AI Test Generator (Word to MCQ)*: `POST /api/tests/upload-docx` endpoint (max 5MB). `mammoth` extracts raw text, which is chunked (if > 8k tokens) and sent to GPT-4o-mini (falling back to GPT-4o on validation failure).
  - *Strict Validation*: Zod schemas ensure 4 options, 1 correct answer, and no empty values from the AI output.
  - *Preview Mode*: Generated tests are saved as Drafts. Teachers review, edit questions/options, and manually publish.

### C. Student Module
- **Dashboard**: Hero section showing "Next Up" / "Live Now" test (Dynamic button states: Green for enter, Gray countdown, Orange resume). Grid of past performance cards.
- **Live Test Arena (Deep Dive)**: 
  - *Layout*: Minimalist (no global sidebar/header) to reduce distractions.
  - *Top Header*: Sticky, Test Name, large Timer (Green -> Amber -> Red/Pulsing), "Finish Test" button.
  - *Main Body*: Left column for current question (large typography, selectable option cards). Right column for Question Palette (Clickable grid showing Not Visited, Current, Answered, Marked for Review). Action footer for "Clear", "Mark", "Previous", "Save & Next". Mobile puts Palette in a Bottom Sheet.
  - *Anti-Cheat UX*: Disable text selection/right-click. Window focus tracking with warning modals.
- **AI Feedback & Results Page (Deep Dive)**:
  - *Hero Summary*: Overall score, rank, time taken, quick tag (e.g. "Accurate but slow").
  - *AI Insights*: 3 cards for Strengths, Areas for Improvement, Action Plan.
  - *Detailed Review*: Expandable accordion per question showing full question, user's answer, correct answer, and an AI Explanation block (custom styling) detailing the 'why'.

## 5. High-Concurrency & Security Hardening

- **The "Mass Submit" Bottleneck**: Submissions offloaded to BullMQ (Redis). Background worker safely scores and inserts into PostgreSQL. Auto-save feature in test arena prevents data loss.
- **Client-Side Time Manipulation**: Visual countdown is observational. Server maintains authoritative timer, hard-rejecting late submissions (plus latency window).
- **API Data Leakage**: Node API uses strict TypeScript DTOs. Correct answers are NEVER shipped to the browser during the test.
- **AI Rate Limiting & Cost Control**: Immediate raw score generation; AI personalized feedback queued asynchronously. The Word-to-MCQ generator uses GPT-4o-mini by default, rate-limits teachers to 5 uploads/hour, sanitizes text, drops raw files immediately, and logs all token/cost metrics.
- **Security UI in Arena**: Disabling text selection, tracking tab switches, warning modals.

## 6. Suggested Next.js Folder Structure (App Router)

```text
app/
├── (auth)/                 # Authenticated route group
│   ├── layout.tsx          # Global Sidebar/Topbar Layout
│   ├── admin/
│   │   ├── dashboard/
│   │   └── users/          # Users list & @modal parallel route for edit
│   ├── teacher/
│   │   ├── dashboard/
│   │   └── tests/
│   │       ├── create/     # Test Builder UI
│   │       └── [testId]/analytics/
│   └── student/
│       ├── dashboard/
│       └── results/[testAttemptId]/ # AI Feedback UI
├── (public)/               # Public route group (centered layout)
│   ├── layout.tsx
│   ├── login/
│   └── signup/
├── arena/                  # Isolated route for Live Test 
│   └── [testSessionId]/
│       ├── layout.tsx      # Minimalist Arena Layout
│       └── page.tsx        # Test taking component
├── api/                    # Backend proxy/endpoints
├── globals.css             # Tailwind imports & CSS vars
└── layout.tsx              # Root layout (providers, fonts)
```
# Archived planning note: this file reflects an earlier architecture draft and is not the source of truth for the current implementation. Use `README.md`, `DEPLOYMENT.md`, and `API_README.md` instead.
