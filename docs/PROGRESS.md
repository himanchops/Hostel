# Build Progress

Tracking phases, what's done, and what's next.

---

## Phase 0 — Project Foundation ✅
_Committed: `a047e85`_

- Go backend scaffold (Echo framework, sqlx, JWT, bcrypt)
- Next.js 16 + React 19 + Tailwind 4 frontend scaffold
- PostgreSQL schema via `001_init.up.sql`
  - Tables: `owners`, `hostel_sites`, `rooms`, `beds`, `tenants`, `stays`, `payments`
  - Enums: `rent_cycle` (daily/weekly/monthly), `payment_type` (cash/online)
- Docker Compose for local Postgres
- Makefile targets: `db-up`, `migrate`, `backend`, `frontend`, `build-backend`
- Auth service stub (JWT + bcrypt), middleware stub, DB connection

---

## Phase 1 — Auth + Sites/Rooms/Beds API + Frontend Auth Flow ✅

**Backend**
- `POST /auth/signup` — create owner account, returns JWT
- `POST /auth/login` — returns JWT
- `GET /api/me` — current owner profile
- Sites CRUD: `GET/POST /api/sites`, `GET/PUT/DELETE /api/sites/:id`
- Rooms CRUD: `GET/POST /api/sites/:siteId/rooms`, `PUT/DELETE …/:id`
- Beds CRUD: `GET/POST /api/sites/:siteId/rooms/:roomId/beds`, `PUT/DELETE …/:id`
- All queries scoped to `owner_id` for multi-tenant isolation
- CORS locked to `FRONTEND_URL` env var

**Frontend**
- `src/lib/api.ts` — typed fetch wrapper, `ApiError`, all endpoint functions
- `src/contexts/auth.tsx` — `AuthContext` with JWT persisted in localStorage, session restore on mount
- `/login`, `/signup` — clean auth forms with error handling
- `/(auth)/layout.tsx` — centered layout, redirects to dashboard if already logged in
- `/(dashboard)/layout.tsx` — sidebar nav (Dashboard, Sites), auth guard, owner info + logout
- `/dashboard` — summary cards + sites list preview
- `/sites` — full sites CRUD (create, list, delete)
- `/sites/[id]` — rooms list with expandable bed management (add/remove inline)
- Root `/` — redirects to dashboard or login based on auth state

---

## Phase 2 — Room Grid + Tenant/Stay/Payment Management ✅

**Backend**
- `GET /api/sites/:siteId/grid` — core grid endpoint; single SQL query joins rooms → beds → active stays → tenants → payments, computes bed status server-side
- Bed status logic:
  - `vacant` — no active stay
  - `paid` (green) — balance ≥ 0
  - `partial` (yellow) — owes less than one full rent cycle
  - `overdue` (red) — owes ≥ one full rent cycle
  - `vacating_soon` (orange) — notice given or end_date within 30 days
- Billing cycle calculation handles monthly/weekly/daily, anchored to `start_date`
- Tenant CRUD: `GET/POST /api/tenants`, `GET/PUT /api/tenants/:id`
- Stay management: `POST /api/stays`, `GET/PUT /api/stays/:id`, `GET /api/tenants/:id/stays`
- Payment ledger: `GET/POST /api/stays/:stayId/payments`, `DELETE /api/payments/:id`

**Frontend**
- `/sites/[id]/grid` — occupancy grid with color-coded bed cards
  - Status legend with all 5 states
  - Click vacant bed → side panel: search existing tenants or create new, set rent/deposit/cycle/start date, assign
  - Click occupied bed → side panel: balance display (paid vs expected), payment history, add payment form, one-click vacate
  - Grid refreshes after any mutation
- `/tenants` — searchable tenant list with inline create form
- `/tenants/[id]` — full tenant profile: all stays (active + historical), expandable payment ledger per stay, add payment inline, end stay
- Sidebar updated with Tenants nav item
- `formatCurrency()` helper for paise → ₹ display

---

## Phase 3 — Tenant Self-Registration + Tenant Portal ✅

_Committed: `8481bb4`_

**Backend**
- `POST /public/register/:ownerId` — public self-registration with name/phone/email/password
- `POST /tenant-auth/login` — tenant login (phone + password)
- Tenant JWT middleware (separate from owner JWT)
- `GET /tenant/me`, `GET /tenant/stays`, `POST /tenant/stays/:id/payments`, `PUT /tenant/stays/:id/notice`
- `POST /tenants/:id/approve` — assign bed/rent/cycle/start, auto-creates stay
- `DELETE /tenants/:id/reject` — reject pending registration
- `GET /payments/pending`, `POST /payments/:id/approve` — owner review of tenant-submitted payments
- Migration `002_tenant_auth` — adds `password_hash` to tenants table

**Frontend**
- `/register/[ownerId]` — public registration form (no auth required)
- `/my/login`, `/my` — tenant portal: view ledger, submit payments, give notice
- `/pending` — owner review page: Registrations tab + Payment Proofs tab
- Tenant auth context (separate from owner auth)

---

## Phase 4 — Dashboard Insights ✅

**Backend**
- `GET /api/dashboard` — single endpoint returning: per-site occupancy, revenue summary (expected/collected this month, overdue total), alert counts (pending registrations + payments), vacating-soon list, recent payments feed
- `cyclesElapsed` extracted to `handlers/helpers.go` (shared between grid and dashboard)

**Frontend**
- Dashboard page fully rewritten: alert banners, 4 stat cards, vacating-soon + recent-payments panels, per-site occupancy bars

---

## Phase 5 — File Uploads (ID Proofs + Payment Screenshots) ✅

**Backend**
- `StorageService` interface at `internal/storage/` — swappable local vs S3
- `LocalStorage` impl: saves files to `./uploads/`, served at `/uploads/*`
- `POST /public/upload` — no auth, used by tenant registration (images + PDF, max 10 MB)
- `POST /tenant/upload` — tenant JWT, used by payment proof uploads
- `POST /public/register/:ownerId` now accepts `id_proof_url`
- `POST /tenant/stays/:stayId/payments` now accepts `proof_url`
- `BASE_URL` env var (default `http://localhost:8080`) controls file URL prefix

**Frontend**
- Registration form: optional ID proof file picker — uploads first, then includes URL in registration call
- Tenant portal payment form: optional screenshot file picker — same two-step pattern
- `/pending` page: "View ID proof →" link on registrations, "View screenshot →" link on payment submissions

**For production**: swap `LocalStorage` for S3/R2 implementation — set `BASE_URL` + S3 env vars

---

## Phase 6 — E2E Testing + AI Design Review ✅

- Playwright config with custom failure reporter → `test-results/failures.json`
- `make test-e2e`, `make test-e2e-ui`, `make test-e2e-debug`, `make fix-tests` targets
- `scripts/fix-tests.ts` — categorizes failures (api-error, navigation, missing-element, etc.) → `test-results/fix-report.md`
- `scripts/review-design.ts` + `make review-design` — screenshots every page, Claude vision API → `test-results/design-review.md`
- `tests/e2e/helpers/api.ts` — typed API helpers for seeding test data
- `tests/e2e/owner/tenant-management.test.ts` — tenant creation API + UI; caught + fixed NULL scan bug in models
- **Convention**: new features get a Playwright test alongside the implementation

**Remaining test coverage** (to be added per feature):
- `owner/auth.test.ts` — signup, duplicate email, login, logout
- `owner/site-setup.test.ts` — site/room/bed CRUD, grid shows vacant
- `owner/tenant-review.test.ts` — pending registration, approve, reject
- `owner/payments.test.ts` — direct payment, approve proof, reject proof
- `owner/dashboard.test.ts` — stat cards after seeded data
- `tenant/registration.test.ts` — public form → success screen
- `tenant/portal.test.ts` — portal view, submit payment, give notice

---

## Phase 7 — Tenant Profile Enrichment + Registration UX ✅

**DB**
- Migration `003_tenant_profile` — 7 new columns on `tenants` (address, emergency contact name/phone, workplace, aadhaar_number, id_proof_front_url, id_proof_back_url); `stays.bed_id` made nullable (pending bed assignment)
- Partial index `idx_stays_active_tenant` for one-active-stay enforcement

**Backend**
- `Tenant` model: 7 new `*string` fields
- `Stay.BedID`: `int64` → `*int64` (null = deposit collected, bed TBD)
- All 6 tenant query sites updated to include new columns
- `Approve` handler: 3-path approval — approve only / assign bed / collect deposit without bed
- One-active-stay guard on `Approve` and `Stay.Create` (409 if active stay exists)
- `AssignBed` handler: `PUT /api/stays/:id/assign-bed`
- `Summary` handler: `GET /api/tenants/:id/summary` — aggregate totals (total_paid, total_expected, balance, duration_days)
- `tenant_portal.go`, `dashboard.go`, `payments.go`, `grid.go`: LEFT JOINs + COALESCE throughout for nullable `bed_id`

**Frontend**
- Self-registration form: address, workplace, emergency contact, Aadhaar, ID front + back
- Pending page — registration cards: circular avatar (photo or initials, deterministic color), click card body → **profile side drawer** with full details + ID proof tiles + Approve/Reject
- Pending page — approval modal: 3-mode radio (approve only / assign bed / collect deposit)
- Tenant detail page:
  - Profile card (all new fields, masked Aadhaar, ID proof links) + "Edit profile" inline form with file uploads
  - Financial summary bar (total paid / duration / balance, color-coded)
  - End-stay **date picker** (replaces `confirm()` + hard-coded today)
  - Unassigned stay: amber "Bed unassigned" badge + "Assign bed" → modal with vacant bed picker
- `maskAadhaar()` helper: `XXXX-XXXX-1234`

**Tests**
- `tests/e2e/owner/tenant-profile-enrichment.test.ts` — 8 tests: public registration with profile fields, deposit-only approval, assign-bed, one-active-stay enforcement, summary endpoint, profile update, UI profile card, UI end-stay date picker

---

## Phase 8 — Tenant UX Polish ✅

### 8a — Unified review + approve drawer
- Merged the old two-step flow (ProfileDrawer → ApproveModal) into a single `ReviewDrawer` component
- Step 1 ("review"): profile details, ID proof tiles, Reject/Approve buttons
- Step 2 ("approve"): back arrow, 3-mode radio (approve only / assign bed / collect deposit), rent fields inline
- Single drawer, no more overlapping modal layers
- Removed `approvingTenant` state — only `drawerTenant` needed now

### 8b — Full-page Add Tenant form
- New page at `/tenants/new` with full profile form (3 sections: basic info, profile details, documents)
- All fields: name, phone, email, address, workplace, emergency contact, Aadhaar, photo/ID front/ID back
- On create → redirect to `/tenants/:id` detail page
- `tenantsApi.create` now accepts full `TenantUpdateData` (backend already supported all fields)
- `/tenants` list page: replaced inline 3-field form with link to `/tenants/new`
- Updated existing e2e tests for the new form flow

---

## Phase 9 — Deployment

Target stack: **Render** (backend) + **Neon** (Postgres) + **Cloudflare R2** (files) + **Vercel** (frontend). $0/mo on free tiers, ~$7/mo to keep backend always-on. Full walkthrough in `docs/DEPLOYMENT.md`.

### Phase 9.1 — Code prep ✅ (on `phase-9-deploy-prep` branch)

- `backend/internal/storage/s3.go` — `S3Storage` impl using `aws-sdk-go-v2`; works with R2, AWS S3, or MinIO (path-style addressing). Builds public URLs from `S3_PUBLIC_URL` so no signed-URL handshake on read.
- `backend/internal/storage/selector.go` — `NewFromEnv()` chooses `S3Storage` vs `LocalStorage` based on `STORAGE_BACKEND`. Unknown values fall back to local rather than disabling uploads silently.
- `backend/internal/storage/selector_test.go` — 4 unit tests covering selector behavior + S3 cred validation.
- `backend/internal/database/database.go` — new `ConnectURL(dsn)` accepts the `postgres://...` DSN that Neon/Render/Supabase hand out.
- `backend/cmd/server/main.go` — uses `DATABASE_URL` when set, falls back to per-field `DB_*` vars for local; uses `storage.NewFromEnv` instead of always-local.
- `backend/cmd/storage-check/main.go` — smoke-test CLI: uploads a single file through the configured backend, prints the public URL. Catches R2 config bugs without needing the full app.
- `render.yaml` — Blueprint defining the backend service, env-var schema, health-check path, and which secrets the user fills in.
- `backend/.env.example` — full env-var inventory with REQUIRED vs LOCAL ONLY markers.
- `docs/DEPLOYMENT.md` — step-by-step deploy walkthrough (Neon → R2 → Render → Vercel).
- `Makefile` — new `storage-check` target.

**Local dev unchanged:** without `STORAGE_BACKEND` set, the server picks `LocalStorage`; without `DATABASE_URL`, it uses the `DB_*` vars. Existing `make dev` flow works identically.

**New backend deps:** `github.com/aws/aws-sdk-go-v2`, `.../config`, `.../credentials`, `.../service/s3`. Will be pulled in by `go mod tidy`.

### Phase 9.2–9.6 — Deploy walkthrough 🔜 (deliberately deferred — see roadmap below)

Steps live in `docs/DEPLOYMENT.md`:
- 9.2 Database (Neon) — create project, run migrations against the `DATABASE_URL`
- 9.3 File storage (Cloudflare R2) — bucket + public subdomain + API token
- 9.4 Backend (Render) — Blueprint pick-up via `render.yaml`, fill in secrets, hit `/health`
- 9.5 Frontend (Vercel) — point at `frontend/`, set `NEXT_PUBLIC_API_URL`
- 9.6 Wire `FRONTEND_URL` back into Render, verify end-to-end with a real signup + upload

---

## Roadmap decision (Apr 2026)

Owner is the alpha user, running locally. Decision: ship the **UI modernization**
(`docs/DESIGN_PLAN.md`, Phases A–E) and the two **value features below** BEFORE
deploying. Recommended execution order:

1. Design Phase A (foundations) + Phase B (component kit) — B blocks everything
2. **Phase 10 — Collections & WhatsApp nudges** (built WITH the new component kit, not before it)
3. Design Phase C (mobile shell) — nudges are used from a phone, so mobile matters here
4. Design Phase D (hero screens) + E (feedback layer)
5. **Phase 11 — Settlement calculator**
6. Phase 9.2–9.6 — deploy

---

## Phase 10 — Collections & WhatsApp Nudges 🔜

The core loop of the business: rent day → who hasn't paid → chase. Currently the
dashboard shows an overdue *total*; this phase makes it a *workflow*.

**Backend**
- `GET /api/collections` — one query over active stays (`end_date IS NULL`) with
  computed balance > 0. Reuse `cyclesElapsed` from `handlers/helpers.go` (same
  logic as grid/dashboard). Returns per row:
  `tenant_id, tenant_name, phone, site_name, room_name, bed_name (nullable),
  rent_amount, balance_paise, days_since_due, last_payment_date (nullable),
  stay_id, rent_cycle`.
  Sorted by `balance_paise` DESC. Owner-scoped like everything else.

**Frontend**
- New page `/collections` + sidebar/tab nav item ("Collections", with count badge
  of rows, red when > 0).
- Each row: tenant name + room/bed, balance (red, `tabular-nums`), days overdue,
  last payment date, and two actions:
  1. **Record payment** — inline expand (not a page nav): amount prefilled with
     the balance, type cash/online, date defaulting to today. Posts to the
     existing `POST /api/stays/:stayId/payments`. Row disappears (or balance
     updates) on success + toast.
  2. **WhatsApp nudge** — `https://wa.me/<phone>?text=<encoded message>`
     opened in a new tab. NO WhatsApp API, NO backend involvement — it's a deep
     link that opens WhatsApp with the message prefilled; the owner presses send.
- Phone normalization for wa.me: strip non-digits; if 10 digits, prefix `91`
  (India). If the result isn't 12 digits, hide the nudge button and show a
  "fix phone" link to the tenant edit page instead. Helper `waLink(phone, msg)`
  in `lib/` with unit-testable pure logic.
- Default message template (hardcoded v1, editable textarea inline before send
  is a nice-to-have, not required):
  `"Hi <first name>, this is a reminder that rent of <₹amount> for <room> is
  pending (due <n> days ago). Please pay at your convenience. Thank you!"`
  Amount formatted via `formatCurrency`.
- Empty state: "Everyone is paid up 🎉" (EmptyState component).

**Tests**
- e2e: seed a stay with an old start_date and no payments → row appears on
  /collections with correct balance → record payment inline → row clears.
- Unit test `waLink()`: 10-digit, +91-prefixed, garbage, and short numbers.

**Explicitly out of scope:** automated/scheduled sending, WhatsApp Business API,
SMS, email. The owner taps; the app never messages anyone by itself.

---

## Phase 11 — Settlement Calculator 🔜

When a tenant vacates: deposit held − outstanding dues ± manual adjustments =
refund. Currently done on a hand calculator; money mistakes happen there.

**DB**
- Migration `004_settlements`:
  ```sql
  CREATE TABLE settlements (
      id BIGSERIAL PRIMARY KEY,
      stay_id BIGINT NOT NULL UNIQUE REFERENCES stays(id) ON DELETE CASCADE,
      deposit_paise BIGINT NOT NULL,
      dues_paise BIGINT NOT NULL,          -- outstanding rent at settlement time (snapshot)
      adjustments JSONB NOT NULL DEFAULT '[]', -- [{"label": "Damaged chair", "amount_paise": -50000}, ...]
      refund_paise BIGINT NOT NULL,         -- final: deposit - dues + sum(adjustments); negative = tenant owes
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
  Adjustments sign convention: negative = deduction from refund (damage, unpaid
  electricity), positive = credit to tenant (e.g. advance rent returned).

**Backend**
- `GET /api/stays/:id/settlement-preview` — computes deposit, current outstanding
  dues (reuse cycle logic), returns them; frontend does live math as the owner
  adds adjustment lines.
- `POST /api/stays/:id/settlement` — body: adjustments array + notes + final
  refund_paise (server recomputes and validates: refund must equal
  deposit − dues + Σ adjustments; 400 on mismatch). Creates the settlement row
  AND sets `stays.end_date` if not already set (settling implies vacating —
  accept an `end_date` in the body, default today).
- `GET /api/stays/:id/settlement` — fetch existing (for display on tenant page).
- Owner-scoping via the stay → tenant → owner chain, as everywhere.

**Frontend**
- Tenant detail page: when a stay has `notice_date` set OR the owner clicks
  "End stay", show **Settle & vacate** flow (Drawer):
  - Read-only lines: Deposit held, Outstanding dues (fetched from preview)
  - **Manual adjustment rows: label + amount, add/remove freely** (the owner
    must be able to override reality — damaged property, verbal agreements,
    goodwill discounts)
  - Live-computed refund line, color-coded (emerald = pay tenant,
    red = tenant owes)
  - Notes field, confirm button → posts settlement, ends stay, toast
- After settlement: stay card shows a "Settled" badge + refund amount;
  settlement details expandable.
- The old plain end-stay date picker remains available as "End without
  settlement" (skips the money part) — not every vacate needs the ceremony.

**Tests**
- e2e: tenant with deposit + partial payments → settle with one deduction →
  correct refund shown and stored → stay ended → summary endpoint reflects it.
- Backend validation test: mismatched refund_paise → 400.

---

## Architecture Notes

- **Amounts**: stored in paise (1 INR = 100 paise), displayed via `formatCurrency()`
- **Multi-tenancy**: every query filters by `owner_id`; bed/room ownership verified by joining up the chain (bed → room → site → owner)
- **Active stay**: `stays WHERE end_date IS NULL` — only one allowed per bed (enforced at API level)
- **Token storage**: JWT in `localStorage` (client-side only); future consideration: httpOnly cookie
- **DB migrations**: managed via `golang-migrate` CLI (`make migrate`)
