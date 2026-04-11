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

## Phase 9 — Deployment 🔜

Planned:
- Backend: Render Web Service (or Fly.io)
- Database: Render Managed Postgres (or Supabase)
- File storage: Cloudflare R2 (S3-compatible, free egress)
- Frontend: Vercel (Next.js native) or Render Static Site
- Environment variable checklist for production
- S3Storage implementation for `internal/storage/`

---

## Architecture Notes

- **Amounts**: stored in paise (1 INR = 100 paise), displayed via `formatCurrency()`
- **Multi-tenancy**: every query filters by `owner_id`; bed/room ownership verified by joining up the chain (bed → room → site → owner)
- **Active stay**: `stays WHERE end_date IS NULL` — only one allowed per bed (enforced at API level)
- **Token storage**: JWT in `localStorage` (client-side only); future consideration: httpOnly cookie
- **DB migrations**: managed via `golang-migrate` CLI (`make migrate`)
