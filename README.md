# OpsFlow — Operations Under Pressure

OpsFlow is an internal operations management platform built for high-reliability teams operating under pressure. It provides structured operational queues, team-scoped Role-Based Access Control (RBAC), an explicit workflow state machine with gatekeeper separation-of-duties, optimistic concurrency controls (OCC), and transactional idempotency.

---

## 🛠 Technology Stack

- **Frontend**: React 18, TypeScript, Vite, React Router v6, Lucide Icons, Vanilla CSS Design System
- **Backend**: Node.js, Express, TypeScript, Zod Schema Validation
- **Database**: PostgreSQL 16
- **ORM**: Prisma ORM with automated migrations and seeding
- **Testing**: Vitest with Supertest (Backend), Vitest with React Testing Library & jsdom (Frontend)
- **Monorepo**: npm workspaces (`backend`, `frontend`)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ or v24+
- **PostgreSQL**: 16+ running locally on port 5432
- **npm**: 10+

### 2. Environment Configuration

#### Backend Configuration
Create or verify `backend/.env`:
```bash
PORT=5001
NODE_ENV=development
DATABASE_URL="postgresql://shivanshomer@localhost:5432/opsflow?schema=public"
JWT_SECRET="opsflow-dev-secret-super-secure-key-32chars-minimum!"
```

### 3. Database Migration and Seeding

Run the database migrations and seed script from the project root:
```bash
# Run migrations
npm run db:migrate

# Seed demo personas, teams, and sample operations work items
npm run db:seed
```

---

## 🔑 Demo Personas & Development Credentials

In development mode (`NODE_ENV !== 'production'`), OpsFlow provides a **1-click Demo Persona Switcher** on the login page as well as standard email/password authentication:

| Persona | Email | Password | Primary Role & Scope |
|:---|:---|:---|:---|
| **Alex Morgan** | `admin@opsflow.io` | `password123` | **ADMIN** — Full authority across Platform Ops & Incident Response |
| **Elena Rostova** | `lead.platform@opsflow.io` | `password123` | **LEAD** — Platform Operations (Gatekeeper Approver) |
| **Marcus Vance** | `lead.incident@opsflow.io` | `password123` | **LEAD** — Incident Response (Gatekeeper Approver) |
| **Sarah Chen** | `member.dev@opsflow.io` | `password123` | **MEMBER** — Senior SRE (Submitter, member of both teams) |
| **David Kim** | `member.junior@opsflow.io` | `password123` | **MEMBER** — Ops Associate (Incident Response) |
| **Rachel Green** | `viewer.audit@opsflow.io` | `password123` | **VIEWER** — Compliance Auditor (Read-only access across teams) |

---

## 💻 Running the Applications

### Run Both Frontend & Backend Concurrently
From the workspace root:
```bash
npm run dev
```

- **Backend API**: `http://localhost:5001`
- **Frontend Web Application**: `http://localhost:5173`

### Run Individually
```bash
# Start backend server
npm run dev:backend

# Start frontend development server
npm run dev:frontend
```

---

## 🧪 Automated Testing & Production Builds

### Run Test Suites
```bash
# Run both test suites
npm test

# Run backend test suite (79 tests across 9 test files)
npm run test:backend

# Run frontend test suite (21 tests across 5 test files)
npm run test:frontend
```

### Production Build
```bash
# Compile and build both backend and frontend for production
npm run build
```

---

## 🏛 Architecture Highlights

1. **Dashboard APIs (`GET /api/v1/dashboard`)**:
   - Aggregates operational focus queues: **Assigned to Me**, **Unassigned Urgent**, **Awaiting Approval**, and **Overdue Work Items**.
   - Team-scoped IDOR prevention: Caller can only access metrics for teams they belong to.
   - Database-level aggregations via Prisma `$transaction` and `groupBy` without loading entire datasets into browser memory.

2. **Optimistic Concurrency Control (OCC)**:
   - Every work item tracks an integer `version`.
   - Modifying fields or triggering workflow transitions validates the last-read version.
   - On mismatch, backend returns `409 Conflict`.
   - Frontend displays a prominent warning callout with an immediate **"Refresh Latest Version"** action button.

3. **Workflow State Machine & Separation of Duties**:
   - Strict transition rules: `OPEN → IN_PROGRESS → AWAITING_APPROVAL → RESOLVED → CLOSED`.
   - Rejections require a stated reason (minimum 3 characters) and return ticket to `IN_PROGRESS`.
   - **Separation of Duties**: Leads and Admins cannot approve tickets assigned to themselves; an independent Lead/Admin must review and approve.

4. **Transactional Idempotency**:
   - `POST /api/v1/work-items` accepts an `Idempotency-Key` header.
   - Retries with identical payload return cached response (`X-Cache-Lookup: HIT`).
   - Retries with conflicting payload return `422 Unprocessable Entity`.
