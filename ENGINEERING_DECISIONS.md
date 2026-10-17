# OpsFlow — Engineering Decisions & Architectural Rationale

This document details the engineering choices, trade-offs, concurrency models, security controls, and design decisions implemented in **OpsFlow** for the Newtonite Software Engineering Challenge (*"Operations Under Pressure"*).

---

## 1. Architecture & Stack Choices

### Core Stack
- **Backend**: Node.js 20+ with Express, TypeScript, and Prisma ORM.
- **Frontend**: React 18 with TypeScript, Vite, and React Router v6.
- **Database**: PostgreSQL 16 with foreign key constraints, composite unique indexes, and ACID transaction isolation.
- **Styling**: Vanilla CSS custom design system with custom properties (CSS variables), sleek slate dark mode, responsive layouts, and zero heavy external UI kit overhead.
- **Testing**: Vitest with Supertest for backend integration testing and React Testing Library for frontend component verification.

### Rationale
- **TypeScript End-to-End**: Guarantees type consistency between request validation schemas (Zod), ORM models (Prisma), business logic, and frontend API consumption.
- **Express + Prisma**: Balances rapid development speed with deep control over SQL execution, transactional boundaries, and database constraints.
- **Vanilla CSS Design System**: Rather than generic utility CSS or heavy component libraries that add bloat and obscure DOM control, OpsFlow implements an enterprise-grade dark UI (`--bg-base`, `--bg-surface`, `--accent-primary`, etc.) with responsive typography and accessible micro-interactions.

---

## 2. Database Schema & Indexing Decisions

The database schema in `backend/prisma/schema.prisma` is optimized for operational read/write patterns:

```prisma
model WorkItem {
  id          String           @id @default(uuid())
  title       String
  description String           @db.Text
  type        WorkItemType     @default(TASK)
  priority    WorkItemPriority @default(MEDIUM)
  status      WorkItemStatus   @default(OPEN)
  teamId      String
  creatorId   String
  assigneeId  String?
  dueDate     DateTime?
  version     Int              @default(1)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  ...
}
```

### Indexing Decisions
1. `@@index([teamId, status])`: Optimizes team-filtered registry queries and status grouping.
2. `@@index([assigneeId, status])`: Powers the "Assigned to Me" operational queue on the live dashboard.
3. `@@index([priority, status])`: Optimizes triage queries (e.g., finding unassigned URGENT items).
4. `@@index([teamId, priority, status])`: Enables low-latency multi-attribute filtering on team work queues.
5. `@@index([workItemId, createdAt])` on `Comment` and `ActivityLog`: Guarantees deterministic, index-backed chronological rendering of item timelines without table scans.
6. `@@unique([key, userId])` on `IdempotencyRecord`: Enforces that an idempotency key is strictly scoped to the authenticated caller and cannot collide across different users.

---

## 3. Authentication & Team-Scoped RBAC

### Security Philosophy
- **Zero Trust in Frontend Assertions**: Neither user IDs nor role claims supplied by the frontend are trusted. All identity is established exclusively via cryptographically signed JWTs (`HS256`) verified on every request.
- **Algorithm Confusion Mitigation**: `jwt.verify` strictly limits allowed algorithms to `['HS256']`, preventing `none`-algorithm or RSA/HMAC confusion attacks.
- **Development-Only Demo Personas**: `POST /api/v1/auth/demo-login` is strictly guarded by `NODE_ENV !== 'production'`. In production, the route throws HTTP 403 Forbidden.

### Team-Scoped Role-Based Access Control (RBAC)
OpsFlow supports 4 discrete roles per team:
- **VIEWER**: Read-only access to team work items, metrics, and activity logs. Can view comments and post compliance notes. Cannot create items, claim items, modify specifications, or trigger status transitions.
- **MEMBER**: Standard operational access. Can create items, claim unassigned items, edit active items, submit items for approval, and post comments.
- **LEAD**: Operational authority. Holds all Member privileges plus gatekeeper approvals (`APPROVE`, `REJECT`), cancellations, and item closure.
- **ADMIN**: Administrative and operational supremacy. Holds all Lead privileges and administrative oversight across assigned teams.

### Cross-Team IDOR Prevention
All operations verify that the authenticated user possesses active membership in the target team (`TeamMember` table). If a user attempts to access or modify a work item belonging to a team they are not a member of, the backend immediately terminates the request with **HTTP 403 Forbidden**.

---

## 4. Atomic Work-Item Claiming

### Problem Under Pressure
In emergency response situations, multiple operators often race to claim unassigned urgent tickets simultaneously. A naive `SELECT` followed by `UPDATE` suffers from race conditions where two operators both believe they successfully claimed the ticket.

### Implementation
OpsFlow enforces atomic claiming inside an explicit Prisma transaction (`backend/src/services/workItem.service.ts`):

```typescript
const updated = await prisma.$transaction(async (tx) => {
  const item = await tx.workItem.findUnique({ where: { id } });
  if (!item) throw ApiError.notFound('Work item not found');

  if (item.assigneeId !== null) {
    throw ApiError.conflict('Work item has already been claimed by another operator');
  }

  if (expectedVersion !== undefined && item.version !== expectedVersion) {
    throw ApiError.conflict('Optimistic concurrency conflict');
  }

  return tx.workItem.update({
    where: { id, version: item.version },
    data: {
      assigneeId: userId,
      version: { increment: 1 },
    },
  });
});
```

- If an item is already claimed, the second request receives **HTTP 409 Conflict**.
- Assignment and activity logging occur atomically inside the same transaction.

---

## 5. Optimistic Concurrency Control (OCC)

### Mechanism
Every work item carries an integer `version` field (starting at `1`).
1. Every read operation provides the client with the current `version`.
2. Any write operation (`PATCH /api/v1/work-items/:id` or status transition) requires the client to send the current `version` in the payload.
3. The backend validates:
   ```typescript
   if (item.version !== clientVersion) {
     throw ApiError.conflict(
       `Conflict: Work item has been modified by another operator (expected v${clientVersion}, current v${item.version})`
     );
   }
   ```
4. If matched, the update increments `version: { increment: 1 }`.
5. If mismatched, the backend rejects with **HTTP 409 Conflict**.

### Frontend Conflict Resolution
When an operator encounters an HTTP 409 response, the UI surfaces a prominent conflict banner with an immediate **"Refresh Latest Version"** action button, preventing accidental overwrites while preserving operator context.

---

## 6. Idempotency Engine

### Problem Under Pressure
Network timeouts, flaky mobile connections, or duplicate button clicks during incidents can cause operators or automated scripts to retry work-item creation.

### Design
- Clients include an `Idempotency-Key` HTTP header (UUID or unique client token).
- The backend middleware/service calculates a SHA-256 fingerprint of the request payload (`teamId`, `title`, `description`, `type`, `priority`).
- Database table `idempotency_records` stores `(key, userId, fingerprint, statusCode, responseBody, expiresAt)`.

### Behavior Under Concurrent or Duplicate Requests
1. **Identical Retries**: If the same user sends the same key with identical payload, the backend returns the cached HTTP response directly (`201 Created` with stored JSON), avoiding duplicate database insertions.
2. **Key Reuse with Mismatched Payload**: If a user attempts to reuse a key with a different request body, the backend rejects with **HTTP 422 Unprocessable Entity** ("Idempotency key already used for a different request payload").
3. **Concurrent In-Flight Requests**: If two identical requests hit the server concurrently, the database unique constraint `@@unique([key, userId])` causes the second insert to fail gracefully, waiting for the first transaction to complete and returning the cached response.

---

## 7. Workflow State Machine & Separation of Duties

### Valid Status Transitions
```
[ OPEN ] ──(START_PROGRESS)──> [ IN_PROGRESS ] ──(SUBMIT_FOR_APPROVAL)──> [ AWAITING_APPROVAL ]
    │                                                                             │
    ├──(CANCEL)──> [ CLOSED ]                                                     ├──(APPROVE)──> [ RESOLVED ] ──(CLOSE)──> [ CLOSED ]
                                                                                  │
                                                                                  └──(REJECT)───> [ IN_PROGRESS ]
```

### Strict Separation of Duties (Gatekeeper Approvals)
To comply with regulatory standards and prevent operational compromise:
- **No Self-Approval**: Even if an operator holds the **LEAD** or **ADMIN** role in a team, they **cannot approve** a work item if they are the designated assignee (`assigneeId === userId`).
- The transition service strictly evaluates:
  ```typescript
  if (action === WorkflowAction.APPROVE && item.assigneeId === userId) {
    throw ApiError.forbidden(
      'Separation of duties: You cannot approve your own work item. Another Lead or Admin must review and approve.'
    );
  }
  ```
- Rejections require an explicit explanation (`reason` string with minimum 3 characters) recorded in the activity log.

---

## 8. Activity Logging & Transaction Boundaries

Every mutating operational action generates an immutable `ActivityLog` entry within the same database transaction:
- `CREATED`: Work item creation.
- `CLAIMED`: Unassigned item claimed by an operator.
- `ASSIGNED`: Reassigned to an operator.
- `STATUS_CHANGED`: State transitions.
- `APPROVED` / `REJECTED`: Lead approval decisions with metadata reasons.
- `COMMENTED`: Operator notes and updates.
- `UPDATED`: Field modifications.

Because activity creation is tied to the Prisma database transaction of the work item, no orphaned activity events or missing timeline logs can occur.

---

## 9. Testing Strategy

OpsFlow implements a dual-layer automated testing pyramid:

1. **Backend Integration Tests (Vitest + Supertest)**:
   - 10 test suites covering 84 comprehensive tests.
   - Real PostgreSQL database interactions (no fragile in-memory mocks for database logic).
   - Tests verify JWT validation, RBAC boundaries, cross-team IDOR, atomic claiming, OCC 409 conflicts, concurrent idempotency retries, separation-of-duties self-approval blocking, activity audit order, and dashboard query scoping.
   - Includes full 12-step operational journey test (`backend/tests/e2eJourney.test.ts`).

2. **Frontend Component & Integration Tests (Vitest + React Testing Library)**:
   - 5 test suites covering 21 comprehensive tests.
   - Tests verify API client token storage and 401 handling, login flow with demo persona switching, dashboard metric rendering, work item registry filtering and pagination, OCC version badges, 409 conflict banners, rejection reason validation, and self-approval UI suppression.

**Total Verified Tests**: 105 passing tests across 15 test suites.

---

## 10. Known Trade-Offs & Future Improvements

1. **`sessionStorage` for JWT Storage**:
   - *Trade-off*: `sessionStorage` was chosen over `localStorage` to ensure credentials do not persist beyond tab closures and do not leak across tabs. It provides protection against CSRF since tokens are explicitly injected via Authorization Bearer headers. However, any client-side storage is theoretically vulnerable if XSS occurs.
   - *Mitigation*: React automatically escapes rendered strings, `dangerouslySetInnerHTML` is banned across the codebase, and all user input is sanitized and validated with Zod.
   - *Future improvement*: Migrate to `httpOnly`, `SameSite=Strict` secure cookies with server-side CSRF token validation.

2. **Absence of WebSockets / Push Notifications**:
   - *Trade-off*: For simplicity and resilience under the challenge scope, real-time updates rely on reactive client refetches and polling rather than persistent WebSocket connections.
   - *Future improvement*: Implement Server-Sent Events (SSE) or WebSockets with Redis pub/sub for instant cross-operator timeline updates.

3. **Idempotency Record Cleanup**:
   - *Current state*: Idempotency records are created with a 24-hour expiration timestamp (`expiresAt`), but automatic pruning currently depends on scheduled database cron or maintenance jobs.
   - *Future improvement*: Implement a background worker (e.g., BullMQ or pg_cron) to purge expired idempotency records periodically.
