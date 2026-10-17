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
# Run both test suites (105 passing tests across 15 files)
npm test

# Run backend test suite (84 tests across 10 test files)
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

## 🔧 Troubleshooting Guidance

### 1. Database Connection Failed (`P1001` or `ECONNREFUSED`)
- Ensure PostgreSQL is running: `brew services status postgresql@16` or `pg_isready`.
- Verify credentials and port 5432 in `backend/.env`.
- Ensure database exists: `createdb opsflow`.

### 2. Port Conflict (`EADDRINUSE: 5001` or `5173`)
- Check which process occupies port 5001: `lsof -i :5001`.
- Terminate stale node process: `kill -9 <PID>` or update `PORT=5002` in `backend/.env`.
- Frontend Vite automatically tries 5173 then next free port (or specify `--port 5174`).

### 3. Prisma Migrations Desynchronized
- Re-run migrations safely: `npm run db:migrate`.
- Re-seed initial personas and operations queues: `npm run db:seed`.

### 4. JWT Expiration / Unauthorized (401)
- If the browser session expires, the client clears `sessionStorage` and redirects to `/login`.
- Click any of the 6 demo personas to instantly refresh credentials.

---

## 📚 Detailed Documentation

- **[ENGINEERING_DECISIONS.md](./ENGINEERING_DECISIONS.md)**: Deep dive into architectural decisions, OCC locking, atomic claiming, idempotency engine, RBAC, and trade-offs.
- **[docs/ARCHITECTURE_SPEC.md](./docs/ARCHITECTURE_SPEC.md)**: Exhaustive API contracts, JSON schemas, workflow state transitions, and database models.

