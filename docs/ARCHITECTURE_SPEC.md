# OpsFlow Architecture Specification (Approved & Refined)
**Newtonite Software Engineering Challenge: "Operations Under Pressure"**

---

## 1. Authentication Strategy & Security Properties

### Single Authentication Strategy: Bearer JWT via Authorization Header
- **Transport**: Standard HTTP `Authorization: Bearer <token>` header on all authenticated REST requests.
- **Token Generation**: Cryptographically signed using HMAC SHA-256 (`HS256`) with a server-side secret (`JWT_SECRET`).
- **Token Payload**:
  ```json
  {
    "userId": "uuid-v4",
    "email": "user@opsflow.io",
    "iat": 1729150000,
    "exp": 1729178800
  }
  ```
- **Security Properties**:
  - **Stateless & Scalable**: Decoupled from server memory sessions; validated on every request.
  - **CSRF Immunity**: Modern browsers do not automatically attach the `Authorization` header on cross-site requests, protecting against Cross-Site Request Forgery (CSRF) without requiring CSRF synchronizer tokens.
  - **No Client Trust**: Client never supplies user roles or permissions in headers or payloads. The backend extracts `userId` from the verified JWT and evaluates active `TeamMember` roles from PostgreSQL for every operation.
- **Client Storage & Lifecycle**:
  - Maintained in-memory inside React `AuthContext` for active runtime state.
  - Cached in `sessionStorage` strictly for tab persistence across page refreshes.
  - Automatic 401 interceptor clears stored credentials and redirects to login.
- **Required Configuration**:
  - `JWT_SECRET`: Minimum 32-character high-entropy secret.
  - `PORT`: Server port (default: 5001).
  - `DATABASE_URL`: PostgreSQL connection string.

### Demo Persona Switcher (Development-Only)
- Endpoint: `POST /api/v1/auth/demo-login`
- Body: `{ "persona": "admin" | "lead-platform" | "lead-incident" | "member-dev" | "member-junior" | "viewer" }`
- **Strict Guard**: Enabled **strictly** when `process.env.NODE_ENV !== 'production'`. In production mode, this endpoint returns `404 Not Found`.
- **Backend-Controlled**: The server looks up the pre-seeded user by hardcoded deterministic email (e.g. `admin@opsflow.io`), verifies user existence, and issues a standard signed JWT. Never trusts frontend-supplied user IDs or role claims.

---

## 2. Idempotency Architecture & Safe Duplicate Handling

### Dedicated Storage Entity
```prisma
model IdempotencyRecord {
  id           String   @id @default(uuid())
  key          String
  userId       String
  fingerprint  String   // SHA-256(method + path + canonical_json_body)
  statusCode   Int
  responseBody Json
  createdAt    DateTime @default(now())
  expiresAt    DateTime

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([key, userId])
  @@index([expiresAt])
  @@map("idempotency_records")
}
```

### Execution Flow
1. **Header Inspection**: Client supplies `Idempotency-Key: <UUID>` on mutating creation endpoints (e.g. `POST /api/v1/work-items`).
2. **Fingerprint Computation**:
   $$\text{fingerprint} = \text{SHA256}(\text{req.method} + \text{req.path} + \text{canonicalJSON}(\text{req.body}))$$
3. **Lookup & Payload Verification**:
   - Query `IdempotencyRecord` where `key = $key` and `userId = $userId`.
   - If found:
     - If `existing.fingerprint !== computedFingerprint`: Return `422 Unprocessable Entity` ("Idempotency key re-used with conflicting payload").
     - If `existing.fingerprint === computedFingerprint`: Return stored `statusCode` and cached `responseBody` with header `X-Cache-Lookup: HIT`.
4. **Transactional Write**:
   - If not found, execute the work item creation and persist the `IdempotencyRecord` atomically inside a PostgreSQL transaction (`$transaction`).

---

## 3. Workflow State Machine & Permitted Transitions

### Permitted Transition Matrix
| Source Status | Permitted Target Status | Permitted Roles | Required Conditions |
|:---|:---|:---|:---|
| `OPEN` | `IN_PROGRESS` | Member, Lead, Admin | Must assign a valid team member (or self-assign via Claim). |
| `IN_PROGRESS` | `AWAITING_APPROVAL`| Member (Assignee), Lead, Admin | Ready for review; records verification notes. |
| `IN_PROGRESS` | `RESOLVED` | Lead, Admin | Direct resolution for tasks not requiring formal gatekeeper sign-off. |
| `AWAITING_APPROVAL` | `RESOLVED` | **Lead, Admin ONLY** | **Gatekeeper Approval**. Validated on backend. |
| `AWAITING_APPROVAL` | `IN_PROGRESS` | **Lead, Admin ONLY** | **Gatekeeper Rejection**. Requires rejection reason in comment/metadata. |
| `RESOLVED` | `CLOSED` | Creator, Lead, Admin | Final verification; permanently closes ticket. |
| `RESOLVED` | `IN_PROGRESS` | Member, Lead, Admin | Reopens ticket if issue recurs or regression detected. |
| `OPEN` / `IN_PROGRESS`| `CLOSED` | Lead, Admin | Cancellation of obsolete or duplicate items. |

*Any other transition (e.g. `OPEN → RESOLVED` or `AWAITING_APPROVAL → RESOLVED` by a Viewer or Member) is strictly rejected with `422 Unprocessable Entity` or `403 Forbidden`.*

---

## 4. Data Integrity & Concurrency Architecture

### Atomic Transactions via Prisma `$transaction`
Every state-changing mutation executes inside a single database transaction:
1. **Optimistic Concurrency Check**: Match item `id` and current `version`.
2. **State & Assignee Update**: Set new fields and increment `version: { increment: 1 }`.
3. **Audit Log Generation**: Insert an immutable `ActivityLog` entry recording `actorId`, `action`, `oldValue`, `newValue`, and contextual `metadata`.

If any step fails or another transaction increments the `version` first, the entire transaction rolls back and returns `409 Conflict`.

### Atomic Task Claiming
```sql
UPDATE work_items
SET "assigneeId" = $userId, "status" = 'IN_PROGRESS', "version" = "version" + 1, "updatedAt" = NOW()
WHERE "id" = $id AND "assigneeId" IS NULL AND "version" = $expectedVersion;
```
If affected rows count is 0, the backend immediately returns `409 Conflict` ("Task has already been claimed or modified").

---

## 5. Role-Permission Matrix (Team-Scoped)

| Operation | Viewer | Member | Lead | Admin |
|:---|:---:|:---:|:---:|:---:|
| Read work items, comments, activity log | ✅ | ✅ | ✅ | ✅ |
| Create work item | ❌ | ✅ | ✅ | ✅ |
| Claim unassigned work item | ❌ | ✅ | ✅ | ✅ |
| Edit description / priority (Assigned to self) | ❌ | ✅ | ✅ | ✅ |
| Edit description / priority (Assigned to others)| ❌ | ❌ | ✅ | ✅ |
| Submit for approval (`→ AWAITING_APPROVAL`) | ❌ | ✅ | ✅ | ✅ |
| Approve item (`AWAITING_APPROVAL → RESOLVED`) | ❌ | ❌ | ✅ | ✅ |
| Reject item (`AWAITING_APPROVAL → IN_PROGRESS`)| ❌ | ❌ | ✅ | ✅ |
| Force Reassign / Close any item | ❌ | ❌ | ✅ | ✅ |

---

## 6. Work Items & Concurrency API Specification (Implemented in Phase 3)

### Endpoint Contracts

#### 1. `POST /api/v1/work-items`
- **Headers**:
  - `Authorization: Bearer <token>` (Required)
  - `Idempotency-Key: <string>` (Optional, 8–128 alphanumeric characters, hyphens, and underscores)
- **Request Body**:
  ```json
  {
    "title": "Fix memory leak in metric agent",
    "description": "Exceeding RSS memory limits during high ingestion.",
    "type": "BUG",                 // Optional: TASK (default), BUG, INCIDENT, OPERATIONAL_REQUEST
    "priority": "HIGH",            // Optional: LOW, MEDIUM (default), HIGH, URGENT
    "teamId": "<uuid>",            // Required
    "assigneeId": "<uuid>",        // Optional, must be a member of teamId
    "dueDate": "2026-10-31T00:00:00.000Z" // Optional
  }
  ```
- **Protected Fields Rejected**: Attempting to supply `id`, `version`, `creatorId`, `createdAt`, or `updatedAt` returns `400 Bad Request`.
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "workItem": { "id": "uuid", "title": "...", "version": 1, ... }
    }
  }
  ```
- **Idempotency Semantics**:
  - If re-sent with the identical payload and key: returns stored `201 Created` response with header `X-Cache-Lookup: HIT`.
  - If re-sent with the same key but a different request payload: returns `422 Unprocessable Entity`.
  - Retention: Records are retained with a 24-hour TTL (`expiresAt`).

#### 2. `GET /api/v1/work-items`
- **Query Parameters**:
  - `page`: Integer $\ge 1$ (default `1`)
  - `limit`: Integer $1 \dots 100$ (default `10`)
  - `teamId`: UUID (optional; user must be a member or receives `403 Forbidden`)
  - `status`: `OPEN` | `IN_PROGRESS` | `AWAITING_APPROVAL` | `RESOLVED` | `CLOSED`
  - `priority`: `LOW` | `MEDIUM` | `HIGH` | `URGENT`
  - `type`: `TASK` | `BUG` | `INCIDENT` | `OPERATIONAL_REQUEST`
  - `assigneeId`: UUID or `"unassigned"`
  - `search`: Case-insensitive text query matching title and description
  - `sortBy`: `"createdAt"` | `"updatedAt"` | `"priority"` | `"dueDate"` (default: `"createdAt"`)
  - `sortOrder`: `"asc"` | `"desc"` (default: `"desc"`)
- **Scope Isolation**: Automatically scopes queries to only include work items belonging to teams where the caller holds active membership.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": [ /* Array of work items */ ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalItems": 42,
      "totalPages": 5
    }
  }
  ```

#### 3. `GET /api/v1/work-items/:id`
- **Response `200 OK`**: Includes work item, creator, assignee, team, caller's team role (`myRole`), and counts for comments and activities.
- **Access Control**: Returns `403 Forbidden` if caller does not belong to the item's owning team (IDOR prevention).

#### 4. `PATCH /api/v1/work-items/:id` (Optimistic Concurrency Control)
- **Request Body**:
  ```json
  {
    "version": 2,                  // Required integer version from last read
    "title": "New Title",          // Optional
    "description": "New Notes",    // Optional
    "priority": "URGENT",          // Optional
    "type": "INCIDENT",            // Optional
    "assigneeId": "<uuid>",        // Optional (must belong to team)
    "dueDate": null                // Optional
  }
  ```
- **Protected Fields Rejected**: Attempts to modify `id`, `creatorId`, `teamId`, or `status` via this endpoint return `400 Bad Request`.
- **Conflict Semantics (`409 Conflict`)**:
  - Returned when the database version does not match the client-submitted `version`.
  - Message: `"Conflict: Work item was modified by another operation. Expected version X, but current version is Y. Please refresh."`

#### 5. `POST /api/v1/work-items/:id/claim` (Atomic Claiming)
- **Request Body**: Optional `{ "version": 1 }`
- **Execution**: Executes atomic conditional update in PostgreSQL:
  ```sql
  UPDATE work_items
  SET "assigneeId" = $userId, "status" = 'IN_PROGRESS', "version" = "version" + 1
  WHERE "id" = $id AND "assigneeId" IS NULL AND "status" IN ('OPEN', 'IN_PROGRESS')
  ```
- **Conflict Semantics (`409 Conflict`)**:
  - If already claimed by another user: `"Work item has already been claimed by another user"`.
  - If version mismatch: `"Conflict: Work item version mismatch..."`.
  - Losing concurrent claims consistently receive `409 Conflict`.

---

## 7. Workflow State Machine, Approvals & Activity Timeline (Implemented in Phase 4)

### Permitted Workflow Actions & State Transition Rules

| Action | Current Status | Target Status | Permitted Roles | Additional Conditions & Guards |
|:---|:---|:---|:---|:---|
| `START_PROGRESS` | `OPEN` | `IN_PROGRESS` | Member, Lead, Admin | Assignee must already be set (or item claimed). |
| `SUBMIT_FOR_APPROVAL` | `IN_PROGRESS` | `AWAITING_APPROVAL` | Member (Assignee), Lead, Admin | Non-assignee members are blocked (`403 Forbidden`). |
| `APPROVE` | `AWAITING_APPROVAL` | `RESOLVED` | **Lead, Admin ONLY** | **Separation of Duties**: Approver cannot be the assignee (`assigneeId !== userId`). |
| `REJECT` | `AWAITING_APPROVAL` | `IN_PROGRESS` | **Lead, Admin ONLY** | Requires meaningful rejection `reason` (min 3 chars). |
| `CLOSE` | `RESOLVED` | `CLOSED` | Lead, Admin | Permanently closes resolved ticket. |
| `CANCEL` | `OPEN` | `CLOSED` | Lead, Admin | Requires cancellation `reason` (min 3 chars). |

*All other transitions (e.g. `OPEN → RESOLVED`, `IN_PROGRESS → CLOSED`, `CLOSED → *`) are strictly prohibited and return `409 Conflict`.*

### Dedicated Workflow Endpoints

#### 1. `POST /api/v1/work-items/:id/transitions`
- **Request Body**:
  ```json
  {
    "action": "APPROVE",             // Optional if targetStatus supplied
    "targetStatus": "RESOLVED",      // Optional if action supplied
    "version": 3,                    // Required integer version from last read
    "reason": "Test coverage met",   // Required for REJECT and CANCEL
    "comment": "Optional comment"    // Atomically persisted as comment if present
  }
  ```
- **Error Semantics**:
  - `400 Bad Request`: Missing version or missing required reason for `REJECT`/`CANCEL`.
  - `403 Forbidden`: Insufficient role, non-assignee member submitting, or Lead attempting self-approval.
  - `409 Conflict`: Invalid state transition from current status, or OCC version mismatch (`Expected version X, current version Y`).
  - `404 Not Found`: Work item does not exist.

#### 2. `GET /api/v1/work-items/:id/activity`
- **Query Parameters**:
  - `page`: default 1
  - `limit`: default 20 (max 100)
- **Ordering**: Deterministic reverse chronological ordering (`ORDER BY createdAt DESC, id DESC`).
- **Response**: Array of activity logs with populated `actor` (`id`, `name`, `email`, `avatarUrl`) and pagination metadata.
- **Access Control**: Team-scoped (`403 Forbidden` for non-members).

#### 3. `POST /api/v1/work-items/:id/comments`
- **Request Body**: `{ "content": "..." }` (1–2000 characters).
- **Behavior**: Attributed to caller, persists `COMMENTED` event in activity timeline atomically.
- **Access Control**: Any authenticated team member (`VIEWER`, `MEMBER`, `LEAD`, `ADMIN`).

#### 4. `GET /api/v1/work-items/:id/comments`
- **Ordering**: Chronological (`createdAt: ASC`).
- **Access Control**: Team-scoped (`403 Forbidden` for non-members).

---

## 8. Dashboard APIs & Integrated React Frontend Architecture (Phase 5)

### Dashboard Endpoint: `GET /api/v1/dashboard`
- **Query Parameter**: `teamId` (optional UUID).
- **Authentication**: Bearer JWT via `Authorization` header required.
- **Authorization & IDOR Protection**:
  - If `teamId` is supplied, the backend strictly verifies the caller's active membership in that team (`403 Forbidden` if unauthorized).
  - If omitted, results are aggregated strictly across all teams the caller is an active member of.
  - An Admin or Lead only receives data for teams where they hold active membership; cross-team data is never leaked.

### Precise Operational Metric Definitions
- **Total Active**: Work items where `status !== 'CLOSED'` within authorized teams.
- **Status Distribution**: Breakdown of work items grouped by `status` (OPEN, IN_PROGRESS, AWAITING_APPROVAL, RESOLVED, CLOSED).
- **Priority Distribution**: Breakdown of non-closed items grouped by `priority` (LOW, MEDIUM, HIGH, URGENT).
- **Assigned to Me**: Work items where `assigneeId === caller.id` and `status !== 'CLOSED'`.
- **Unassigned Urgent**: Work items where `assigneeId IS NULL`, `priority === 'URGENT'`, and `status !== 'CLOSED'`. Supports 1-click atomic claiming.
- **Awaiting My Approval**: Work items in `AWAITING_APPROVAL` status belonging strictly to teams where the caller holds `LEAD` or `ADMIN` role.
- **Overdue Work Items**: Work items where `dueDate < CURRENT_TIMESTAMP` and `status NOT IN ('RESOLVED', 'CLOSED')`.
- **Recent System Activity**: The 10 most recent activity logs across caller's teams with actor details.

### Frontend Application Architecture (React + Vite + TypeScript)
- **Token Storage**: Strict `sessionStorage` usage (`opsflow_session_token`). Stored tokens are never written to `localStorage`. Cleared on user logout or upon receiving HTTP 401.
- **Idempotency Protection**: When creating work items, a unique UUID is generated per logical operation. Retries of the same operation reuse the identical `Idempotency-Key` header, allowing the backend to return the cached response.
- **Optimistic Concurrency Control (OCC)**:
  - Every work item view tracks its `version`.
  - Mutations submit `{ version }`.
  - HTTP 409 Conflict triggers a prominent callout with a **"Refresh Latest Version"** button, preventing silent overwrites.
- **Role-Aware UI**:
  - `VIEWER`: Read-only access to items, comments, and timeline. Mutation actions (edit, claim, transition, approve) are hidden/disabled.
  - `MEMBER`: Can create, claim unassigned items, edit assigned items, and submit for peer review.
  - `LEAD` & `ADMIN`: Access to approval queue, approve/reject controls, and close actions.
  - **Separation of Duties**: When a ticket is assigned to a Lead/Admin, self-approval is blocked with an explanatory warning banner.
- **Component Design System**:
  - Vanilla CSS design system with custom tokens (`--bg-primary`, `--bg-surface`, `--primary`, `--border-color`).
  - High-contrast badges for statuses, priorities, and types.
  - Responsive layout with desktop sidebar, mobile drawer, and top bar context switchers.



