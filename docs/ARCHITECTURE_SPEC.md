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
