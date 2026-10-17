# OpsFlow — Comprehensive Engineering Walkthrough & Interview Guide

This guide provides an exhaustive, code-grounded explanation of **OpsFlow**, an internal operations management platform engineered for the **Newtonite Software Engineering Challenge ("Operations Under Pressure")**.

Use this document to understand every technical subsystem, defend architectural trade-offs, and master the code for technical interviews.

---

## 1. System Topology & Architecture

OpsFlow is structured as an npm monorepo with an Express/TypeScript backend, a React/TypeScript frontend, and a PostgreSQL relational database accessed through Prisma ORM.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT / BROWSER                                   │
│  React 18 SPA + Vite                                                              │
│  • AuthContext (In-memory token + sessionStorage tab persistence)                 │
│  • Typed API Client (fetch wrapper with Idempotency-Key & 401 interceptor)        │
│  • Operational Dashboard, Work Item Registry, & Detail View                       │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ HTTP / JSON
                                         │ Authorization: Bearer <JWT>
                                         │ Idempotency-Key: <UUID> (optional)
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                EXPRESS BACKEND                                    │
│  [backend/src/app.ts] & [backend/src/server.ts]                                   │
│                                                                                   │
│  1. Global Middlewares: cors(), express.json()                                    │
│  2. Authentication Middleware [backend/src/middleware/authenticate.ts]            │
│     • Cryptographically verifies HS256 JWT                                        │
│     • Verifies user exists in DB; attaches req.user                               │
│  3. Validation Middleware [backend/src/middleware/validateRequest.ts]             │
│     • Validates req.body, req.query, or req.params against Zod schemas            │
│  4. Route Handlers [backend/src/routes/*.routes.ts]                               │
│  5. Controllers [backend/src/controllers/*.controller.ts]                         │
│     • Extracts parameters and delegates to Domain Services                        │
│  6. Domain Services [backend/src/services/*.service.ts]                           │
│     • Enforces business logic, RBAC rules, state machine transitions,             │
│       concurrency checks, and database transaction boundaries                     │
│  7. Centralized Error Handler [backend/src/middleware/errorHandler.ts]            │
│     • Formats ApiError and ZodError; hides internal details in production         │
└────────────────────────────────────────┬──────────────────────────────────────────┘
                                         │ Prisma ORM Client
                                         │ [backend/src/config/db.ts]
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                 POSTGRESQL 16                                     │
│  Relational Database Schema [backend/prisma/schema.prisma]                        │
│  • users: Operator identity, credentials, and memberships                         │
│  • teams & team_members: Multi-tenant team scoping & roles (VIEWER..ADMIN)        │
│  • work_items: Operational tickets with integer version tokens                    │
│  • comments: Threaded operator collaboration notes                                │
│  • activity_logs: Immutable, append-only chronological audit stream                │
│  • idempotency_records: Request fingerprints and cached response bodies           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Request Lifecycle Walkthrough: Creating a Work Item

Let us trace what occurs when an operator creates a ticket from the frontend to PostgreSQL:

1. **Client Submission ([CreateWorkItemModal.tsx](file:///Users/shivanshomer/Desktop/OpsFlow/frontend/src/components/work-items/CreateWorkItemModal.tsx))**:
   - The user fills out title, description, priority, type, and selects a team.
   - The frontend generates a client-side UUID: `crypto.randomUUID()`.
   - The API client ([client.ts](file:///Users/shivanshomer/Desktop/OpsFlow/frontend/src/api/client.ts)) dispatches a `POST /api/v1/work-items` request with:
     - `Authorization: Bearer <token>`
     - `Idempotency-Key: <uuid>`
     - JSON body.

2. **Authentication ([authenticate.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/middleware/authenticate.ts))**:
   - Verifies the JWT signature with `jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })`.
   - Confirms the user exists in PostgreSQL; attaches `req.user`.

3. **Input Validation ([workItem.controller.ts#L18-L41](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/controllers/workItem.controller.ts#L18-L41))**:
   - Zod schema `createWorkItemSchema` validates constraints: title (3–200 chars), description ($\ge 1$ char), teamId (UUID format).
   - Rejects protected system fields (`id`, `version`, `creatorId`, `createdAt`, `updatedAt`) with `400 Bad Request`.

4. **Service & Authorization ([workItem.service.ts#L56-L95](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L56-L95))**:
   - Queries `prisma.teamMember.findUnique` for `(teamId, userId)`.
   - If not found: throws `403 Forbidden` (*"You do not have access to create work items in this team"*).
   - If role is `VIEWER`: throws `403 Forbidden` (*"Viewers have read-only access"*).
   - If `assigneeId` is designated, verifies they belong to the same team.

5. **Idempotency Pre-Check ([workItem.service.ts#L96-L123](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L96-L123))**:
   - Canonicalizes JSON body (recursively sorting object keys via [idempotency.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/utils/idempotency.ts)).
   - Computes SHA-256 fingerprint: `SHA256(METHOD + ":" + PATH + ":" + CANONICAL_BODY)`.
   - Queries `idempotencyRecord` for `(key, userId)`.
   - If existing record has matching fingerprint: returns cached `201 Created` response immediately.
   - If existing record has differing fingerprint: throws `422 Unprocessable Entity`.

6. **Database Transaction ([workItem.service.ts#L127-L183](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L127-L183))**:
   - Executes `prisma.$transaction(async (tx) => ...)`:
     - Inserts row into `work_items` with `version = 1`, `status = OPEN`.
     - Inserts row into `activity_logs` with `action = CREATED`, `newValue = OPEN`.
     - Inserts row into `idempotency_records` with fingerprint and stored response (24h TTL).
   - Returns `{ success: true, data: { workItem } }` with HTTP status `201 Created`.

---

## 3. Concurrency Mechanics Deep Dive

### A. Atomic Work-Item Claiming
*Source Code: [backend/src/services/workItem.service.ts#L457-L540](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L457-L540)*

#### The Problem
During incident triage, multiple operators simultaneously click "Claim" on an unassigned urgent ticket. A naive `findUnique` followed by `update` allows two operators to read `assigneeId: null` concurrently, causing one to overwrite the other without notification.

#### The Implementation
OpsFlow enforces atomic claims at the database level inside a Prisma transaction:

```typescript
return prisma.$transaction(async (tx) => {
  // 1. Concurrency-safe pre-read inside transaction to capture actual pre-claim status
  const before = await tx.workItem.findUnique({
    where: { id },
    select: { id: true, status: true, assigneeId: true, version: true },
  });

  if (!before) throw ApiError.notFound('Work item not found');
  if (before.assigneeId !== null) {
    throw ApiError.conflict('Work item has already been claimed by another user');
  }
  if (clientVersion !== undefined && before.version !== clientVersion) {
    throw ApiError.conflict(`Conflict: Work item version mismatch. Expected version ${clientVersion}, current version is ${before.version}.`);
  }
  if (before.status !== WorkItemStatus.OPEN && before.status !== WorkItemStatus.IN_PROGRESS) {
    throw ApiError.conflict('Work item cannot be claimed in its current status');
  }

  // 2. Conditional atomic update matching version and assigneeId: null
  const result = await tx.workItem.updateMany({
    where: {
      id,
      assigneeId: null,
      version: before.version,
      status: { in: [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS] },
    },
    data: {
      assigneeId: userId,
      status: WorkItemStatus.IN_PROGRESS,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    const current = await tx.workItem.findUnique({ where: { id } });
    if (!current) throw ApiError.notFound('Work item not found');
    if (current.assigneeId !== null) {
      throw ApiError.conflict('Work item has already been claimed by another user');
    }
    if (current.version !== before.version) {
      throw ApiError.conflict(`Conflict: Work item was modified by another operation. Expected version ${before.version}, current version is ${current.version}.`);
    }
    throw ApiError.conflict('Work item cannot be claimed in its current status');
  }

  // 3. Activity record using the exact pre-claim status
  await tx.activityLog.create({
    data: {
      workItemId: id,
      actorId: userId,
      action: ActivityAction.CLAIMED,
      oldValue: before.status,
      newValue: userId,
      metadata: {
        previousStatus: before.status,
        newStatus: WorkItemStatus.IN_PROGRESS,
      },
    },
  });

  return tx.workItem.findUniqueOrThrow({ where: { id }, ... });
});
```

#### Why Competing Claims Cannot Collide
1. In PostgreSQL, `UPDATE` acquires an exclusive row-level lock.
2. If Operator A and Operator B execute this transaction simultaneously:
   - Operator A's `updateMany` acquires the lock and updates 1 row (`assigneeId = A`, `version = 2`).
   - Operator B's `updateMany` blocks on the row lock until Transaction A commits.
   - Once Transaction A commits, Transaction B re-evaluates the `where` clause against the newly committed row.
   - Because `assigneeId` is no longer `null` (and `version` is no longer 1), 0 rows match. `result.count === 0`.
   - Transaction B rolls back and throws `409 Conflict`. Zero duplicate activity logs are created.

---

### B. Optimistic Concurrency Control (OCC)
*Source Code: [backend/src/services/workItem.service.ts#L406-L453](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L406-L453)*

#### The Mechanism
Every work item contains an integer `version` field starting at `1`.
1. Every write operation (`PATCH /api/v1/work-items/:id` or state transition) requires the client to supply its last-read `version`.
2. The service executes an atomic conditional update:
   ```typescript
   const result = await tx.workItem.updateMany({
     where: { id, version: expectedVersion },
     data: { ...updates, version: { increment: 1 } },
   });
   ```
3. If another operator modified the item in the interim, the database version is higher than `expectedVersion`.
4. `result.count === 0`. The transaction immediately aborts and throws `409 Conflict`:
   ```
   Conflict: Work item was modified by another operation.
   Expected version 1, but current version is 2. Please refresh.
   ```
5. In the UI ([WorkItemDetailPage.tsx](file:///Users/shivanshomer/Desktop/OpsFlow/frontend/src/pages/WorkItemDetailPage.tsx)), receiving a 409 status displays a red alert banner with a **"Refresh Latest Version"** action button, preventing accidental overwrites while preserving user context.

---

### C. Idempotency Engine
*Source Code: [backend/src/utils/idempotency.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/utils/idempotency.ts) & [backend/src/services/workItem.service.ts#L96-L221](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L96-L221)*

#### Deterministic Fingerprinting
To prevent false-positive mismatches caused by varying key order in JSON payloads (e.g., `{ a: 1, b: 2 }` vs `{ b: 2, a: 1 }`), `canonicalizeJson` recursively sorts all object keys prior to hashing:

```typescript
export function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalizeJson);
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson((obj as Record<string, unknown>)[key]);
  }
  return result;
}
```

#### Handling Concurrent In-Flight Retries
If two identical requests arrive simultaneously before either has written to `idempotency_records`:
1. Both requests begin processing.
2. The database table enforces a composite unique constraint: `@@unique([key, userId])`.
3. The first transaction commits the record.
4. The second transaction attempts to insert the same `(key, userId)` and triggers a PostgreSQL unique constraint violation (Prisma error `P2002`).
5. OpsFlow catches `P2002`, queries the completed record committed by the first transaction, confirms the fingerprint matches, and safely returns the cached `201 Created` payload.

---

## 4. Security, Authorization & Separation of Duties

### A. Team-Scoped RBAC & Anti-IDOR
*Source Code: [backend/src/middleware/teamAuth.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/middleware/teamAuth.ts)*

- **Identity Derived Exclusively From Tokens**: The server never trusts client headers like `X-User-Id` or `X-User-Role`.
- **Live Database Evaluation**: Roles are stored per-team in `team_members`. If an operator's role is demoted or revoked in PostgreSQL, subsequent requests immediately fail with `403 Forbidden` without waiting for token expiry.
- **Cross-Team IDOR Prevention**: Every query for a work item, activity log, comment, or dashboard checks that the item's `teamId` belongs to `req.user.memberships`. An operator in Team A attempting to view an item in Team B receives `403 Forbidden`.

### B. Strict Separation of Duties (Gatekeeper Rule)
*Source Code: [backend/src/services/workflow.service.ts#L71-L84](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workflow.service.ts#L71-L84)*

In high-reliability operational environments, self-approval represents a severe compliance risk.
1. Even if an operator holds the **LEAD** or **ADMIN** role in a team, **they cannot approve a work item assigned to themselves**:
   ```typescript
   if (action === WorkflowAction.APPROVE && item.assigneeId === userId) {
     throw ApiError.forbidden(
       'Separation of duties: You cannot approve a work item assigned to yourself. Another Lead or Admin must review and approve this item.'
     );
   }
   ```
2. In the frontend ([WorkItemDetailPage.tsx](file:///Users/shivanshomer/Desktop/OpsFlow/frontend/src/pages/WorkItemDetailPage.tsx)), when `item.assigneeId === user.id`, the "Approve & Resolve" button is replaced with an amber compliance callout explaining why peer approval is required.

---

## 5. Workflow State Machine Specification

*Source Code: [backend/src/services/workflow.service.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workflow.service.ts)*

```
[ OPEN ] ──(START_PROGRESS)──> [ IN_PROGRESS ] ──(SUBMIT_FOR_APPROVAL)──> [ AWAITING_APPROVAL ]
    │                                                                             │
    ├──(CANCEL)──> [ CLOSED ]                                                     ├──(APPROVE)──> [ RESOLVED ] ──(CLOSE)──> [ CLOSED ]
                                                                                  │
                                                                                  └──(REJECT)───> [ IN_PROGRESS ]
```

### The 6 Valid Lifecycle Transitions
1. `START_PROGRESS` (`OPEN → IN_PROGRESS`): Allowed for `MEMBER`, `LEAD`, `ADMIN`. Requires item to be claimed/assigned.
2. `SUBMIT_FOR_APPROVAL` (`IN_PROGRESS → AWAITING_APPROVAL`): Allowed for the assigned `MEMBER`, or any `LEAD`/`ADMIN`.
3. `APPROVE` (`AWAITING_APPROVAL → RESOLVED`): Allowed for `LEAD`, `ADMIN` only. Blocked if `assigneeId === callerId`.
4. `REJECT` (`AWAITING_APPROVAL → IN_PROGRESS`): Allowed for `LEAD`, `ADMIN` only. Requires a string `reason` ($\ge 3$ characters).
5. `CLOSE` (`RESOLVED → CLOSED`): Allowed for `LEAD`, `ADMIN` only. Final closure.
6. `CANCEL` (`OPEN → CLOSED`): Allowed for `LEAD`, `ADMIN` only. Requires cancellation `reason` ($\ge 3$ characters).

Any other transition (e.g., `OPEN → RESOLVED` or `CLOSED → OPEN`) throws `409 Conflict`.

---

## 6. Operational Command Center (Dashboard Scoping)

*Source Code: [backend/src/services/dashboard.service.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/dashboard.service.ts)*

The dashboard aggregates metrics using PostgreSQL `$transaction` and `groupBy` queries to prevent memory exhaustion:
1. **Summary Cards**:
   - `totalActive`: Count of items where `status !== CLOSED` in caller's teams.
   - `byStatus` and `byPriority`: Computed using database-level `prisma.workItem.groupBy`.
2. **Operational Queues**:
   - `assignedToMe`: Items where `assigneeId = caller.id` and `status !== CLOSED`.
   - `unassignedUrgent`: Items where `assigneeId IS NULL`, `priority = URGENT`, and `status !== CLOSED`.
   - `awaitingMyApproval`: Items in `AWAITING_APPROVAL` status, filtered strictly to teams where the caller holds `LEAD` or `ADMIN` role. Members and Viewers see count `0`.
   - `overdue`: Items where `dueDate < NOW()` and `status NOT IN ('RESOLVED', 'CLOSED')`.
3. **Audit Feed**: 10 most recent activity logs across caller's teams.

---

## 7. Failure Scenarios & Operational Resilience

| Failure Scenario | How OpsFlow Responds | Code Location |
|:---|:---|:---|
| **PostgreSQL Connection Lost** | Prisma throws connection error; caught by `errorHandler.ts`. Returns `500 Internal Server Error` with generic message, hiding raw DB connection strings. | [errorHandler.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/middleware/errorHandler.ts) |
| **Expired JWT Token** | `verifyToken` catches `TokenExpiredError` and throws `ApiError.unauthorized`. Frontend interceptor clears `sessionStorage` and redirects to `/login`. | [jwt.ts](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/utils/jwt.ts#L36) & [client.ts](file:///Users/shivanshomer/Desktop/OpsFlow/frontend/src/api/client.ts#L110) |
| **Network Timeout on Ticket Creation** | Operator retries creation with the same `Idempotency-Key`. Server replays cached `201 Created` response without creating duplicate tickets. | [workItem.service.ts#L101-L122](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L101-L122) |
| **Concurrent Edit Collision** | OCC version check fails (`result.count === 0`). Server returns `409 Conflict`. Frontend displays conflict banner and preserves user's uncommitted form input while offering a refresh button. | [workItem.service.ts#L423-L429](file:///Users/shivanshomer/Desktop/OpsFlow/backend/src/services/workItem.service.ts#L423-L429) |

---

## 8. Engineering Trade-offs & Limitations

1. **`sessionStorage` vs `httpOnly` Cookies**:
   - *Decision*: JWTs are stored in `sessionStorage` and sent via `Authorization: Bearer <token>`.
   - *Trade-off*: Immune to standard CSRF form submissions because browsers do not attach custom headers on cross-site requests. However, tokens can be accessed by JavaScript if an XSS vulnerability exists.
   - *Mitigation*: All user input is strictly validated via Zod, `dangerouslySetInnerHTML` is banned across the codebase, and React automatically escapes dynamic strings.
   - *Future improvement*: Use `httpOnly`, `SameSite=Strict` secure cookies combined with server-issued anti-CSRF tokens.

2. **REST Polling vs WebSockets**:
   - *Decision*: Updates rely on user interactions, page refetches, and optimistic UI transitions.
   - *Trade-off*: Avoids the operational complexity of stateful WebSocket connections, connection reconnect storms, and sticky sessions under high pressure.
   - *Future improvement*: Introduce Server-Sent Events (SSE) or Redis-backed WebSockets for live timeline broadcasts.

3. **Idempotency Key Retention**:
   - *Decision*: Records are stored with a 24-hour expiration (`expiresAt`).
   - *Trade-off*: In the current implementation, expired records remain in the database until cleaned by maintenance scripts.
   - *Future improvement*: Implement an automated background task (e.g., pg_cron or worker queue) to purge expired records periodically.

---

## 9. Five Realistic Interview Questions & Code-Grounded Answers

### Q1: How does OpsFlow prevent two operators from claiming the same urgent ticket at the exact same millisecond?
> **Answer**:
> "We enforce atomic claims at the database level inside a Prisma transaction in `backend/src/services/workItem.service.ts` in the `claimWorkItem` function.
>
> Rather than doing a `findUnique` followed by an unconditional update, we execute a conditional update using `tx.workItem.updateMany`:
> ```typescript
> const result = await tx.workItem.updateMany({
>   where: {
>     id,
>     assigneeId: null,
>     version: before.version,
>     status: { in: [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS] },
>   },
>   data: {
>     assigneeId: userId,
>     status: WorkItemStatus.IN_PROGRESS,
>     version: { increment: 1 },
>   },
> });
> ```
> In PostgreSQL, an `UPDATE` acquires an exclusive row-level lock. When two transactions run concurrently, the second transaction is queued. Once the first transaction commits, the second transaction re-evaluates the `where` clause. Because `assigneeId` is no longer `null` and `version` has incremented, 0 rows match (`result.count === 0`).
>
> When `result.count === 0`, we immediately throw an `ApiError.conflict` (HTTP 409). The losing transaction rolls back, producing zero duplicate activity logs, while the winner atomically sets `assigneeId` and creates the `ActivityAction.CLAIMED` record."

---

### Q2: What happens when an operator attempts to save an edit on a stale version of a ticket?
> **Answer**:
> "We implement Optimistic Concurrency Control (OCC) in `backend/src/services/workItem.service.ts` in the `updateWorkItem` method.
>
> Every ticket in PostgreSQL has an integer `version` field starting at 1. When a client reads a work item, it receives this version. When submitting updates (`PATCH /api/v1/work-items/:id`), the client must supply the current version.
>
> The backend executes:
> ```typescript
> const result = await tx.workItem.updateMany({
>   where: { id, version: expectedVersion },
>   data: { ...updates, version: { increment: 1 } },
> });
> ```
> If another user updated the ticket in the meantime, the database version has incremented, causing `result.count` to be 0. We throw a `409 Conflict` error stating the expected and current versions.
>
> On the frontend, in `frontend/src/pages/WorkItemDetailPage.tsx`, the `ApiClientError` with status 409 is caught, displaying a red conflict banner: *'Concurrency Conflict (HTTP 409): This work item was modified by another operator'*. It provides a *'Refresh Latest Version'* button that re-fetches the item without destroying the user's view."

---

### Q3: How is idempotency implemented, and how do you handle key reuse with a conflicting payload?
> **Answer**:
> "Idempotency is implemented in `backend/src/services/workItem.service.ts` in `createWorkItem` and supported by `backend/src/utils/idempotency.ts`.
>
> When a client creates a ticket, it passes an `Idempotency-Key` header. We calculate a deterministic SHA-256 fingerprint:
> 1. We recursively sort all keys in the request body using `canonicalizeJson` so key order does not alter the hash.
> 2. We hash `METHOD:NORMALIZED_PATH:CANONICAL_BODY`.
> 3. We check the `idempotency_records` table, which has a composite unique constraint `@@unique([key, userId])`.
>
> If a record exists with the same key:
> - If the fingerprint matches, we return the cached response payload with status `201 Created`.
> - If the fingerprint differs, we throw a `422 Unprocessable Entity` error (*'Idempotency key has already been used with a different request payload'*).
>
> If two identical requests hit the server concurrently, the second insert hits PostgreSQL's unique constraint `P2002`. We catch `P2002`, query the completed record committed by the first transaction, and safely return the cached response."

---

### Q4: How is Role-Based Access Control enforced, and how does OpsFlow prevent Cross-Team IDOR?
> **Answer**:
> "We enforce multi-tenant team-scoped RBAC in `backend/src/middleware/teamAuth.ts` and within our domain services (`workItem.service.ts`, `workflow.service.ts`, `dashboard.service.ts`).
>
> 1. Identity is derived strictly from the verified JWT via `authenticate.ts`. We never trust frontend assertions of user identity or role.
> 2. Every team membership is stored in the `team_members` table with one of four roles: `VIEWER`, `MEMBER`, `LEAD`, or `ADMIN`.
> 3. When an operator requests a work item (`GET /api/v1/work-items/:id`), the service queries the item's `teamId`, then queries `teamMember` for `(item.teamId, req.user.id)`. If no record exists, it throws `403 Forbidden` (*'You do not have access to view this work item'*).
> 4. For listing queries (`GET /api/v1/work-items`), the service queries all teams the user belongs to and restricts the Prisma `where` clause to `teamId: { in: userTeamIds }`. If the user passes an explicit `?teamId=...` for a team they do not belong to, it rejects the request with `403 Forbidden`."

---

### Q5: Why can't a Lead or Admin approve a ticket assigned to themselves, and where is that separation of duties enforced?
> **Answer**:
> "In operations under pressure, self-approval bypasses peer review and creates compliance and safety risks. OpsFlow enforces Separation of Duties both on the server and in the client UI.
>
> In `backend/src/services/workflow.service.ts`, the `APPROVE` transition rule defines a custom validator:
> ```typescript
> [WorkflowAction.APPROVE]: {
>   from: WorkItemStatus.AWAITING_APPROVAL,
>   to: WorkItemStatus.RESOLVED,
>   action: WorkflowAction.APPROVE,
>   allowedRoles: [Role.LEAD, Role.ADMIN],
>   validate: ({ userId, assigneeId }) => {
>     if (assigneeId === userId) {
>       throw ApiError.forbidden(
>         'Separation of duties: You cannot approve a work item assigned to yourself. Another Lead or Admin must review and approve this item.'
>       );
>     }
>   },
> }
> ```
> Even if the user is an `ADMIN`, if they are the designated `assigneeId`, the server returns `403 Forbidden`.
>
> In `frontend/src/pages/WorkItemDetailPage.tsx`, we evaluate `const isSelfApprovalBlocked = isLeadOrAdmin && isAssignee;`. If true, the 'Approve & Resolve' button is hidden, and an amber notice is rendered: *'Separation of duties: You cannot approve your own ticket. Another Lead/Admin must approve.'*"
