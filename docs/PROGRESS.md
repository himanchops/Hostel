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

## Phase 6 — E2E Testing ✅

- Playwright config with custom failure reporter → `test-results/failures.json`
- `make test-e2e`, `make test-e2e-ui`, `make test-e2e-debug`, `make fix-tests` targets
- `scripts/fix-tests.ts` — categorizes failures (api-error, navigation, missing-element, etc.) → `test-results/fix-report.md`
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

### Phase 9.2 prep — decisions + upload rate limiting ✅ (deploy session, Aug 2026)

Two questions that had been left open in `docs/DEPLOYMENT.md` were settled
before touching any dashboard. Both are written up in full there under
"Decisions taken"; the short version:

- **Error tracking: skipped.** No Sentry/GlitchTip account for this deploy. The
  `serverError` / `reportError` chokepoints are untouched, so it stays a
  two-file change later. Consequence accepted: nothing stores or announces an
  error yet.
- **R2 bucket: public.** Keys are `public/<32 hex>.ext` from `crypto/rand` and
  r2.dev does not list directories, so it is unguessable-link, not browsable.

The second decision made `POST /public/upload` — unauthenticated by necessity,
since a stranger uploads ID before any account exists — an open file host on the
Cloudflare account. Fixed in this session:

- `backend/internal/middleware/ratelimit.go` — `PublicUploadRateLimiter()`,
  per-client-IP token bucket. Burst 10, refill one per three minutes, idle IPs
  forgotten after an hour. Sized from the legitimate worst case: one
  registration is three files, and a whole hostel can share one NAT'd IP.
  Denies return the API's `{"error": ...}` envelope, not Echo's
  `{"message": ...}`, because `lib/api.ts` reads `body.error` and would
  otherwise show a generic "Upload failed".
- `backend/cmd/server/main.go` — `e.IPExtractor = echo.ExtractIPFromXFFHeader()`.
  Without it, Echo's fallback reads the *first* `X-Forwarded-For` entry, which
  the client writes and can forge — enough to walk past the limiter by rotating
  a header. Verified against a running binary: 12 requests with rotating forged
  XFF values all resolved to the proxy-observed client and were limited at the
  11th. This also fixes `remote_ip` in the request log, which behind Render
  would otherwise have been the proxy on every line.
- `backend/internal/middleware/ratelimit_test.go` — 3 tests: burst allowed,
  denial past it with the right envelope, buckets independent per client.

**Deliberately not logged in the DenyHandler.** `middleware.Logger()` already
records the 429 with the resolved `remote_ip`. A `c.Logger().Warnf` was written
and then removed — Echo's default logger level is ERROR, so it emitted nothing
while reading as though it did, which is the swallowed-error pattern CLAUDE.md
forbids wearing a disguise.

Not covered by e2e: no test in `frontend/tests/e2e/` touches file upload at all,
so the limiter cannot regress the 34-test suite — and uploads have no e2e
coverage to begin with. Noted rather than fixed here.

Follow-ups in `docs/BACKLOG.md` → "Security / privacy": presigned URLs (grows
more expensive per real tenant row, because the DB stores absolute URLs rather
than keys) and a registration token gating the upload.

### Phase 9.2 — Database (Neon) ✅ (Aug 2026)

Project on AWS `ap-southeast-1` (Singapore). Neon offers no India region — its
list stops at Singapore for APAC — and the backend is pinned to Render's
`singapore` anyway. Co-locating DB with compute is what matters: user→backend is
one round trip per page, backend→DB is several.

Neon Auth, Object storage, Functions and the AI gateway were all left off. Neon
Auth in particular would have added its own tables and broken the "exactly nine
tables" verification below.

Verified, not assumed: 5 migrations applied, `migrate ... version` → `5` clean,
and `pg_tables` returns exactly the nine expected names. Then the real server
binary was run locally against the Neon URL and a signup round-tripped, which is
what actually proves the driver and pooler work — `/health` only proves the
process booted.

**The connection string is the pooled endpoint** (`...-pooler...`, PgBouncer in
transaction mode). Checked that nothing in the app depends on session state:
no `LISTEN`/`NOTIFY`, no advisory locks, no temp tables, no `SET SESSION`. The
one explicit transaction (`settlements.go:336`) is fine — a transaction is the
unit PgBouncer pools by. Driver is `lib/pq` via sqlx and it accepts
`channel_binding=require`.

### Makefile: `make migrate` could target the wrong database ✅ (Aug 2026)

Found while cleaning up the smoke-test row. `make migrate`, `make migrate-down`
and `make seed-demo-reset` were hardcoded to `localhost:5432`. Harmless with one
database; a real trap with two, because a deploy-time `make migrate` would
report success having migrated local, and the missing column would surface as a
production 500 — precisely the failure DEPLOYMENT.md warns is easy to forget.

- `LOCAL_DB` and `DATABASE_URL ?= $(LOCAL_DB)` at the top of the Makefile.
- `migrate` / `migrate-down` honour the override, echo `LOCAL` or `REMOTE`
  before running, and `migrate` prints the resulting version afterwards.
- `seed-demo-reset` is deliberately **not** overridable and now announces that
  it is local-only. It writes rows; a typo in a remote URL is not a mistake
  worth making cheap — same reasoning as the `demo@seed.invalid` convention.

Deploy usage: `make migrate DATABASE_URL="$NEON_URL"`.

### Phase 9.3 — File storage (Cloudflare R2) ✅ (Aug 2026)

Bucket `hostel-uploads`, location Asia-Pacific, Standard storage class.
Infrequent Access was rejected deliberately: it bills per retrieval and imposes
a 30-day minimum per object, and tenant photos are fetched every time an owner
opens a profile — IA would charge for the app working normally.

Public read is served by the **R2.dev development subdomain**, because the app
needs two hostnames for two jobs: the S3 API endpoint takes SigV4-signed writes
from the Go backend, and an `<img src>` in the browser cannot sign anything. The
code already enforces the split — `NewS3Storage` refuses to start with an empty
`PublicURL`. Cloudflare labels it "Public Development URL" and rate-limits it;
a custom domain is the eventual answer and is noted in BACKLOG.md.

API token: `Object Read & Write` — the least privilege that permits `PutObject`,
since reads never touch the API — scoped to `hostel-uploads` alone, no IP
filter (Render's free tier has no stable outbound IPs, so a filter would work
once and then break on redeploy).

Verified with `cmd/storage-check`: `Backend: *storage.S3Storage`, upload
succeeded, and the returned URL rendered in a private window.

No CORS policy on the bucket, and none needed: browsers do not apply CORS to
`<img>` display, and uploads go browser → backend → R2, never browser → R2.

Gotchas worth keeping, both of which cost real time to spot:
- `S3_ENDPOINT` is the **host only**. The dashboard shows it with the bucket
  path appended; leaving that on produces `.../hostel-uploads/hostel-uploads/...`
  because the SDK uses path-style addressing.
- The token result screen shows a prominent **"Token value"** that is for
  Cloudflare's own API, not S3. The needed pair is Access Key ID / Secret Access
  Key further down; using the token value gives a signature error that reads
  like a typo.

### Phase 9.4–9.6 — Render, Vercel, wiring ✅ (Aug 2026) — **the app is live**

- Backend: `https://hostel-backend-k7ar.onrender.com` (Render, free, singapore)
- Frontend: `https://hostel-ten-kappa.vercel.app` (Vercel, hobby)

**Render** came up via Blueprint off `render.yaml`, so the twelve service
settings and non-secret env vars were read from the file and only the eight
`sync: false` secrets were typed. `GO_VERSION` was pinned in `render.yaml` first
(PR #22) because `backend/go.mod` needs 1.25.7, Render's default lags, and the
resulting failure reads like a dependency problem.

**Vercel** auto-detected the monorepo and proposed deploying the Go backend as
`/api/backend` alongside the frontend, asking for a `vercel.json` to formalise
it. Declined: Echo is a long-lived server, not a request-scoped function, and a
half-working unconfigured second copy of an app that handles government ID is
worse than one that plainly fails. Setting **Root Directory = `frontend`**
collapses the detection to a single Next.js service.

`NEXT_PUBLIC_API_URL` is set for Production **and** Preview, so branch previews
point at the production backend and get CORS-refused. That is the safer of two
broken options — do **not** add a preview origin to `FRONTEND_URL` to "fix" it,
because that lets a branch deploy write to production Neon.

**Verified end to end against the deployed stack, not the dashboards:**

| Path | Check |
|---|---|
| Browser → Vercel | 200; `hostel-backend-k7ar.onrender.com` found in the shipped JS chunks and `localhost:8080` absent — proves the build-time inline took |
| Browser → Render | preflight from the real origin returns ACAO; `placeholder.invalid` and the trailing-slash variant both refused |
| Render → Neon (read) | login as unknown user → 401, not 500 |
| Render → Neon (write) | signup → 201, read-back login → 200 |
| Render → R2 | upload returned a `pub-*.r2.dev` URL |
| Browser → R2 | 200, `image/png`, exact byte count |

The CORS trailing-slash check is worth keeping in the routine: `FRONTEND_URL`
with a trailing slash produces a configuration that looks complete and refuses
every request, and the only symptom is a browser-console error.

**Left behind by verification:** two objects in R2 (`smoke-test/` and
`public/`, ~137 bytes each) and one `demo@seed.invalid` owner row, deleted
after the fact with
`psql "$NEON_URL" -c "DELETE FROM owners WHERE email = 'demo@seed.invalid';"`.

**Phase 9 is complete.** Remaining loose ends are in `docs/BACKLOG.md`, not here:
no error tracking (deferred by decision), no e2e coverage on file upload,
`/auth/login` and `/public/register` still unthrottled, presigned URLs, a custom
domain on the bucket, and the Aadhaar questions.

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

1. Design Phase A (foundations) + Phase B (component kit) — B blocks everything ✅
2. **Phase 10 — Collections & WhatsApp nudges** (built WITH the new component kit, not before it) ✅
3. Design Phase C (mobile shell) — nudges are used from a phone, so mobile matters here ✅
4. Design Phase D (hero screens) ✅ + E (feedback layer) ✅
5. **Phase 11 — Settlement calculator** ✅
6. Design Phase F (public surfaces) — the registration page a stranger sees;
   worth doing before real tenants are pointed at it by QR code ✅
7. Phase 9.2–9.6 — deploy

---

## Phase 10 — Collections & WhatsApp Nudges ✅

**Shipped:** `GET /api/collections` + `/collections`, built on the Phase B kit.
The dashboard's overdue *total* is now a *worklist*: who owes, how long, one tap
to chase, one tap to record the money.

Decisions and details worth knowing:

- **Sign convention.** `balance_paise` is what the tenant OWES, so it is
  positive, and rows with nothing outstanding never reach the client. That is
  the opposite sign from the grid's balance (`paid − expected`) and the same as
  the tenant summary's. Documented on both the Go struct and the TS interface,
  because three conventions in one codebase is already one too many.
- **"Days overdue" counts from the first *unpaid* cycle**, not the current one.
  A tenant three cycles behind has been overdue since the oldest one, and that
  is the number that belongs in the nudge. Whole cycles paid = `totalPaid /
  rentAmount`, so a part payment reduces the balance without resetting the
  clock — there is a test pinning exactly that.
- **New helper `cycleStart(start, n, cycle)`** in `collections.go` — the
  inverse of `cyclesElapsed`, with the same month-end clamping. A test walks
  one against the other for 14 cycles across mid-month, month-end, 30th and
  leap-year move-ins; if they ever disagree, "days overdue" would drift from
  the balance sitting next to it on the page.
- **Phone normalisation is stricter than the plan said.** The plan said "if the
  result isn't 12 digits, hide the button"; a bare length check lets
  `098123456012` through, which is nobody's number. `normalizePhone` accepts
  only 10 digits (prefixed `91`) or 12 digits already starting `91`. The cost
  is that a genuine non-Indian number can't be nudged — acceptable while the
  app is rupee-denominated, and the 10-digit branch already assumed India.
- **Toast is now wired**, but only for this page's payment mutation. The
  sweep across every other mutation is still design Phase E.

**Known discrepancy (not fixed here):** collections includes stays with no bed
assigned, per this phase's spec, but the dashboard's `overdue_amount` excludes
them (`s.bed_id IS NOT NULL`). So the two figures can disagree for an owner who
has collected a deposit without allocating a room. Worth reconciling — probably
by dropping the dashboard's filter — but that changes a tested money figure, so
it wants its own change rather than riding along here.

**Mobile:** the page itself is fine at 375px (cards stack, actions wrap, no
horizontal scroll). The 224px fixed sidebar is what makes the viewport unusable,
which is exactly what design Phase C converts to a bottom tab bar.

Tests: `collections_test.go` (balance, overdue age, part payments, weekly/daily
cycles, exclusions, sorting, nullable passthrough, the cycleStart↔cyclesElapsed
inverse), `tests/unit/wa-link.test.ts` (normalisation, encoding, the message
template verbatim), and `tests/e2e/owner/collections.test.ts` (API row math,
paid-up tenant absent, record-payment-clears-the-row, bad phone offers a fix).

### Original spec

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

## Phase 11 — Settlement Calculator ✅

**Shipped:** migration `005_settlements`, three endpoints, and a Settle & vacate
drawer on the tenant page. The hand calculator is gone: deposit held − rent
outstanding ± manual adjustments = what changes hands, computed live as the
owner types and re-checked by the server before anything is written.

Decisions and details worth knowing:

- **Migration is `005`, not `004`.** The plan was written before
  `004_drop_rent_due_day` landed.
- **`deposit_paise` and `dues_paise` are snapshots**, not views onto the stay.
  S1 made rent and start date editable, and a settlement records money that
  actually changed hands — correcting a stay afterwards must not silently
  rewrite what was handed over.
- **What happens to a rent advance is the owner's decision, not the formula's.**
  A tenant who paid three months up front and left after two has an advance
  sitting there, and the settlement offers *return all of it / return part of it
  / do not return it*. The chosen amount is stored in
  `advance_returned_paise` — a decision, not a derivation, so a settlement row
  can be told apart from one where no advance existed.

  The first cut let this fall out of a signed `dues` (`deposit − dues`), which
  handed the whole advance back automatically. That is a policy, and not one
  this app gets to set: "partial" in particular cannot be derived from anything.
  `refundFor` now takes the returned amount as an explicit term, and
  `validateAdvanceReturned` keeps it inside what exists — no negatives, no more
  than was paid, and nothing at all when the tenant owes rent.

  **Returning it in full stays the default**, so an owner who never touches the
  control gets the generous reading and nothing changed silently. If the same
  option gets picked every time, an account-level default can sit on top of
  this later; it would need this control underneath it either way.
- **The server recomputes and rejects a mismatch.** Not because the client is
  hostile but because the drawer goes stale: a payment recorded in another tab
  moves the dues, and the owner would otherwise hand over a refund based on
  numbers that are no longer true. The 400 says so and tells them to reopen it.
- **The owner never types a minus sign.** Each adjustment row is a
  Deduct/Add-back choice plus a positive amount; the sign is applied for them.
  `parseRupees` rejects a typed minus so the two cannot cancel out, and accepts
  commas — `parseFloat("1,200")` is `1`, which would turn a ₹1,200 deduction
  into ₹1 with nothing on screen to show for it.
- **An already-ended stay settles against its own end date.** A request naming
  a different one is refused, not ignored — the settlement and the ledger have
  to describe the same move-out. Reachable from the UI too ("Settle deposit" on
  an ended, unsettled stay), because ending from the grid is a normal thing to
  do first.
- **A settlement does not write off the rent ledger.** The tenant summary still
  shows the outstanding rent afterwards; the settlement records what was paid
  out, which is a different question. Pinned by a test.
- **`GET /api/tenants/:id/settlements` replaces the planned
  `GET /api/stays/:id/settlement`.** The tenant page badges every ended stay, so
  the per-stay version would be N requests to render N badges — and with the
  list endpoint in place nothing would have called it.
- **The drawer shows its working** (`4 months × ₹8,500 = ₹34,000 billed ·
  ₹25,500 paid`). The one number the owner will argue with is the outstanding
  rent, and a bare total gives them nothing to check it against.

**Bug found and fixed on the way:** `GET /api/stays/:id` had *always* returned
404. `stayCols` is unqualified and that handler joins `tenants` to scope by
owner, so `id` is ambiguous and Postgres refused the query. Nothing in the app
calls the endpoint, so it went unnoticed. Now uses `stayColsQualified`. Worth
noting that the settlement test's first draft asserted `end_date` was falsy —
which passes on an error body too; asserting the status first is what exposed
it.

**Also fixed:** a stay card showed "Paid ₹0" until expanded, because payments
load lazily. Harmless before; a false zero sitting next to a refund figure is
not. Now shows "Paid —" until it knows.

Tests: `settlements_test.go` (23 — dues across monthly/weekly/daily and
month-end clamping, the move-out date changing the bill by exactly one cycle,
paid-ahead, refunds going negative, the stale-preview mismatch, agreement with
the tenant summary, date resolution, adjustment validation; three mutants killed
the advance returning in full/part/none and its validation; six mutants killed
on the arithmetic), `tests/unit/settlement.test.ts` (16 — the same fixture as
the Go tests so the two implementations cannot drift, plus rupee parsing and
cycle labels), and `tests/e2e/owner/settlement.test.ts` (7 — preview working and
exact stored refund, double-settle 409, mismatch 400, unlabelled adjustment 400,
already-ended path, all three advance outcomes plus both advance rejections, and
the full UI flow with a comma-typed deduction).

### Original spec

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

## Design Phase F — Public surfaces ✅

**Shipped:** `/register/[ownerId]` and `/my/login` converted to the kit, then
the registration page given the one decorative frame in the product. Full
write-up in `docs/DESIGN_PLAN.md`; the parts that matter here:

- **New endpoint `GET /public/owners/:ownerId`** — name only, unauthenticated.
  The registration page could not say which property it belonged to, which is
  the entire trust question for someone who reached it by scanning a sticker.
  Owner ids are enumerable, so the e2e pins the exact response key set to stop
  contact details ever being added to it.
- **`grep -rn "ring-stone-200" src/app` → 0.** That was Phase B's acceptance
  test and it has been outstanding since. Finishing it meant kit-converting the
  tenant shell header and the portal's stay card, and turning the dashboard
  account menu into a `Card` (an overlay, so it keeps `shadow-xl` — Card sets no
  shadow of its own, so there is no class collision).
- **Three `grid-cols-2` blocks were broken at 375px** and now stack below 640px.
- Two raw `ring-1` classes remain, both on the pending page's registration-link
  panel — a tinted multi-line block with no kit equivalent. Documented, not
  forced into `Banner`.

Tests: `tests/e2e/public/registration.test.ts` (3, whole file at 375px — the
name-only endpoint and its 404, a full end-to-end registration reaching the
owner's pending queue with zero horizontal overflow, and the degraded path
where the owner name fails to load).

---

## Phase 13 — Intake documents & tenant photo 🔜

Today the app collects ID proof only if the tenant uploads it themselves during
registration, and every field is optional. In practice the owner photographs
the person and their ID at the door on the day they move in, and that is the
copy that actually exists. The app has nowhere to put it.

**What is missing**
- **A photo taken at intake.** `tenants.photo_url` exists and the owner's edit
  form can upload one, but only as a file picked from disk. On a phone this
  should open the camera — `<input type="file" accept="image/*" capture="user">`
  — because the owner is standing in front of the person.
- **ID documents captured owner-side.** `id_proof_front_url` / `_back_url` are
  filled at registration or not at all. The owner needs to add or replace them
  later, from the tenant page, with the same camera affordance.
- **A view of what is actually on file.** Nothing on the tenant page or the
  pending queue says "no ID on record". An owner cannot see the gap, so the gap
  persists until they need the document and it is not there.
- **More than two slots.** Front and back of one ID is an assumption. Some
  tenants hand over a passport plus a college letter.

**Deliberately not decided here:** whether an ID is *required* before approval.
That is a policy, and per the settlement lesson the app should not freeze one —
surface the gap loudly at approval time and let the owner proceed anyway.

**Storage:** goes through the existing R2/S3 path and `ValidateUploadedURL`, so
this phase depends on 9.3 being done and is best built against real object
storage rather than the local disk backend.

**Privacy note worth carrying:** this turns the app into a store of
government-ID photographs for real people. Access is already owner-scoped, but
the retention question — what happens to these when a tenant leaves — has never
been asked and should be, in this phase.

---

## Incident — seed script wrote into a live account (2026-08-19)

A throwaway script written to populate a demo dataset guessed
`demo@hostel.local` for its owner. That was the actual owner's login. Signup
returned a conflict, and the script's `except: log in instead` fallback treated
that identically to a re-run, so it appended two sites, ten fake tenants, nine
stays and twenty-eight payments to real data. Cleaned up the same session —
everything it wrote was scoped to one owner, one day and one phone prefix, so
the delete was precise and the account returned to its exact prior state.

**Two causes, both worth remembering:**
- A "demo" identifier plausible enough to belong to someone. Seed data now uses
  `demo@seed.invalid`; `.invalid` is reserved by RFC 2606 and can never be a
  real address.
- A fallback that made "this already exists" indistinguishable from "you are
  about to write into something that is not yours". The script now refuses to
  reuse an owner at all; `make seed-demo-reset` deletes and reseeds explicitly.

Nothing here was specific to seeding. Any script that writes on a user's behalf
should fail loudly on an identity it did not create, rather than proceeding on
a guess.

---

## Phase 9.7 — Observability: error tracking ✅ (Sep 2026)

Step 3 of the observability plan, deferred at the deploy and picked up now that
strangers can reach the app. **Sentry, EU region**, wired into the chokepoints
that Phases 1–2 of that plan had already built. Full write-up — vendor
reasoning, verification method, alert rules, limitations — in
`docs/DEPLOYMENT.md` → "Where the logs go".

**Backend**
- `backend/internal/observability/sentry.go` — the whole SDK surface, so nothing
  else in the codebase imports Sentry directly. `Init` / `Flush` /
  `CaptureError` / `CapturePanic` / `Fatalf`, all inert without `SENTRY_DSN`.
- `backend/internal/handlers/errors.go` — `serverError` reports as well as logs.
  One line, because step 1 had already funnelled every 500 through here.
- `backend/cmd/server/main.go` — `Init` + deferred `Flush`; `middleware.Recover`
  becomes `RecoverWithConfig` with a `LogErrorFunc` so panics reach the tracker
  (they never pass through `serverError`); `log.Fatalf` at the two boot-failure
  sites becomes `observability.Fatalf`.
- `render.yaml` — `SENTRY_DSN` (`sync:false`) and `SENTRY_ENVIRONMENT`.

**Frontend**
- `frontend/src/instrumentation-client.ts` — SDK init. This is a *Next* file
  convention (verified against `node_modules/next/dist/docs`, per `AGENTS.md`),
  which is why no build plugin and no `next.config.ts` wrapping is needed.
  Also exports `onRouterTransitionStart` for navigation breadcrumbs.
- `frontend/src/lib/scrubPII.ts` + `frontend/src/lib/reportError.ts`.
- `frontend/next.config.ts` — maps Vercel's `VERCEL_GIT_COMMIT_SHA` into
  `NEXT_PUBLIC_COMMIT_SHA` so releases tag themselves.

**`@sentry/browser`, not `@sentry/nextjs`.** The Next SDK pulls `@sentry/cli`,
whose postinstall downloads a binary — and this repo gates install scripts
through `allowScripts` in `package.json`, so that is a supply-chain decision,
not a detail. What it buys is source-map upload, and the app is entirely
client-rendered, so the server-side half of that SDK has nothing to instrument.
The cost is minified production stack traces. If a crash ever proves unreadable,
the two ways out are `productionBrowserSourceMaps: true` (public source maps, no
secret) or adding the upload step with a `SENTRY_AUTH_TOKEN` (private, one more
secret). Neither is needed until it is.

**Two corrections to what this doc previously said.** The Aug 2026 note claimed
any SDK would send the `Authorization` header and registration bodies by
default. `sentry-go` v0.49 does neither with `SendDefaultPII: false` — bodies
are not collected at all and the header deny-list already matches `auth`. The
scrubber is therefore the second layer, not the first; the *configuration* is
what carries the weight, and it is set explicitly rather than inherited from
what the SDK calls a backwards-compatibility path. Second, `sentry-go/echo`
requires **echo/v5** and this project is on v4, so the official middleware was
not usable — no loss, since `serverError` was always the better chokepoint.

**Verified rather than asserted.** `SENTRY_DSN` was pointed at a local server
capturing envelopes verbatim; the real binary then served a real 500 carrying a
planted `Authorization` header, cookie, API key and full registration body. The
captured payload had no body, no cookies, three benign headers, `token=[Filtered]`
in the query string, and the Postgres cause intact. A panic route (added, used,
reverted) produced a fatal event with an 8-frame stack. The frontend was crashed
inside its real error boundary: phone, Aadhaar and email `[redacted]` everywhere
including console breadcrumbs. Also covered by unit tests both sides —
`internal/observability/sentry_test.go` (39 assertions incl. one driving the
SDK's own request builder, so an upstream default change fails the build) and
`frontend/tests/unit/scrub-pii.test.ts`.

**Known limitation, tested so it stays known:** names are not scrubbed. No
pattern distinguishes "Priya Sharma" from "Postgres Error". Structured data is
safe because bodies are never collected; the rule for strings we build
ourselves is now in CLAUDE.md.

**Also fixed here** (raised in the deploy session, never filed):
`backend/internal/handlers/tenants.go` mapped *any* `db.Get` error on the public
QR path to 404 "registration link not found", so a Neon outage told a stranger
in a corridor that the sticker they had just scanned was invalid — and logged
nothing. Same family as the errors PR #17 fixed, milder only because the error
was checked rather than discarded. Now `sql.ErrNoRows` alone is a 404 and
everything else is a reported 500. `PublicRegister` had the same shape in
`err != nil || !exists`, which conflated an outage with a missing owner; split.

**Live and confirmed, same day.** Sentry org created in the EU region, two
projects (`hostel-backend` Go / `hostel-frontend` Browser JS, both set up as
"Vanilla" — the Echo integration needs echo/v5 and `@sentry/nextjs` pulls
`@sentry/cli`, so neither framework SDK applies here). DSNs are in Render and
Vercel. Both ends verified end-to-end against the real deployments: the backend
boot log reads `error tracking: enabled (environment=production …)`, a real 500
arrived and grouped, and the browser console smoke test reached the frontend
project. Releases tag correctly — issues show `in release c36f9f602dc9`, the
merge commit.

**It found two live bugs in the first hour**, neither of which any test or code
review had caught. Both filed in `docs/BACKLOG.md` → "Found by Sentry": three
issues that are really one prepared-statement-crossing-connections bug on
`/api/collections` (hypothesis: Neon's pooled endpoint plus `lib/pq`), and a
missing upper bound on password length that turns a long passphrase into a 500
on both signup and the public registration path.

Worth recording plainly, because it is the argument for the whole change: the
app had been live for two weeks, and the first time anyone looked, it was
broken in a way nobody had noticed.

---

## Phase 14 — Flow & UX review 🔎

A deliberate pass over the whole product as a *user* rather than as its author,
against the deployed environment. Everything has been verified feature by
feature as it was built; nothing has ever been walked end to end by someone
asking "is this actually good".

**Run it against the deploy, not localhost.** Half of what this is for only
exists in production: CORS between Vercel and Render, uploads landing in R2,
cold starts on the free tier, real latency on a phone on mobile data.

**The flows to walk, each start to finish**
1. Owner signs up → creates a site, rooms, beds
2. Prospective tenant scans the QR → registers → owner sees them in Pending
3. Owner approves, assigns a bed, sets rent and deposit
4. Owner records payments — including a part payment and a backdated one
5. Rent day: collections list, the WhatsApp nudge, recording from the list
6. Tenant gives notice, from the portal and from the owner side
7. Settle & vacate — with dues, with an advance, with adjustments, and the
   "end without settling" path
8. Tenant portal: login, ledger, submit a payment proof, notice to vacate
9. The awkward ones: correcting a wrong start date, a stay with no bed, a
   tenant with two stays over time, month-end move-ins

**For each, three questions:** does it work, is the UX right, and what does the
backend do when the input is odd. Findings that are one-liners go to
`docs/BACKLOG.md`; anything structural gets promoted to a phase.

**Worth doing with fresh eyes.** A subagent reviewing flows it did not build is
genuinely better at this than the author is — ask before spawning one.

**Evidence this phase is not optional:** ten minutes of seeding a demo dataset
(2026-08-19) found that `POST /tenant/stays/:stayId/payments` had returned 500
on *every call since it was written* — the INSERT reused one placeholder across
a `DATE` and a `TIMESTAMPTZ` column, so Postgres rejected it with 42P08.
Tenants have never been able to submit a payment proof, which is a headline
feature of the portal. It survived because the e2e suite had `owner/` and
`public/` directories and no `tenant/` one, and because the handler returned a
generic 500 with the real error discarded. Both are fixed; the lesson is that a
surface with no test directory is a surface nobody has tested.

**Run the review against `make seed-demo`.** It builds every state the UI can
show, including the awkward ones — a bed-less stay, a paid-ahead tenant, a
settled move-out, a payment awaiting approval — which is most of the list above
already standing up.

---

## Phase 12 — Test Hardening 🔜

**Why this exists.** The tenant-summary bug (payments inflating the balance
owed) shipped while an e2e test named "tenant summary returns correct totals"
was passing. That test asserted `total_paid` (which was never wrong) and
`duration_days >= 0` (a tautology — the buggy value was 0), and never asserted
`total_expected` or `balance` at all. Its fixture started the stay *today*, so
the duration was zero and the per-payment multiplication was invisible.

The lesson is not "write more tests." It is:
1. **Assert exact values**, never `>= 0` or `toBeTruthy()` on a number.
2. **Fixtures must be non-degenerate** — multi-month stays, several payments,
   partial payments, backdated dates. A zero-length stay hides arithmetic bugs.
3. **Money math belongs in fast unit tests**, not only in e2e. The bug was pure
   arithmetic; a table test would have caught it in milliseconds without a
   browser or a database.

### 12a — Backend unit tests (money and dates) — do this first

No DB, no browser. Pure functions and aggregation logic.

- `cyclesElapsed`: join-date anchoring, month-end move-ins, short months,
  leap years, weekly/daily, same-day start, future start. *(partially done —
  `cycles_test.go`)*
- Summary aggregation: per-stay values must not scale with payment count;
  paying reduces balance by exactly the payment; multiple concurrent and
  historical stays; ended stays stop accruing; backfilled end dates.
  *(done — `summary_test.go`)*
- Bed status derivation (`vacant`/`paid`/`partial`/`overdue`/`vacating_soon`):
  table test over balance × notice × end-date combinations. The thresholds
  ("owes less than one cycle" vs "owes ≥ one cycle") are untested today.
- Dashboard revenue: expected vs collected this month, overdue totals, with
  several stays on different cycles and start dates.
- `formatCurrency` / paise conversions, including negative balances (credits).

### 12b — API integration tests (real DB, no browser)

Playwright `request` fixtures, as today, but with honest assertions.

- **Tenant lifecycle**: create → assign bed → record payments → give notice →
  end stay (backdated) → verify summary and grid status at each step.
- **Payment flows**: owner-recorded payment; tenant-submitted proof requiring
  approval; rejecting a proof; deleting a payment and confirming the balance
  moves back.
- **Date handling**: backdated payments, backdated stay start, backdated
  vacate, month-boundary stays, stays spanning a year boundary.
- **Overrides**: once stays become editable (see Known Issues), assert that
  correcting `start_date` / `rent_amount` recomputes every derived number.
- **Multi-tenancy**: owner A must never see or mutate owner B's data — one test
  per endpoint family. Currently untested and it is the security-critical
  invariant of the whole app.

### 12c — UI e2e (browser)

Keep thin — these are slow and will churn during the design phases.
One happy path each: create tenant via form, assign bed from grid, record a
payment from the grid drawer, approve a pending registration, end a stay with a
backdated date picker. Assert on user-visible money and dates, not internals.

### Conventions to adopt

- Every bug fixed from now on ships with a regression test that fails on the
  old code.
- Fixtures live in one place with builders (`stayStartedMonthsAgo(3)`), so a
  test that needs a realistic tenant doesn't hand-roll dates.
- `make verify-backend` (unit) must stay fast enough to run on every save;
  e2e runs before a PR.

**Sequencing note:** 12a is immune to UI churn, so it can land before the
design phases. 12c should wait until after design Phase D, or the tests get
rewritten twice.

---

## S1 — Data Integrity ✅

Stabilization pass. Priority set Aug 2026: make what exists correct before
building anything new.

- **`PUT /api/stays/:id` no longer clobbers fields you didn't send.** It wrote
  every column from the request body, so ending a stay (sending only
  `end_date`) silently set `notice_date = NULL`. Absent keys are now
  distinguished from explicit `null` by parsing the raw JSON keys —
  `c.Bind` into pointers cannot tell those apart, since both arrive as nil.
- **Stays are correctable.** `start_date`, `rent_amount`, `deposit_amount`, and
  `rent_cycle` are now editable. Previously a stay entered with the wrong start
  date had every derived number wrong forever with no fix path.
- **Validation on the resulting row**, not just the payload: end can't precede
  start, notice can't precede start, rent must be positive, cycle must be one
  of the three. Reopening a stay (clearing `end_date`) 409s if another active
  stay now holds the bed.
- **Month-end move-ins no longer skip a cycle.** The anchor day is clamped to
  the last day of the month being measured, so a stay starting the 31st rolls
  over on Feb 28 (29 in a leap year) instead of not at all.
- **`rent_due_day` dropped** (migration `004`) from the schema, models,
  handlers, import CLI, API types, and the pending-page form. Per the decision
  above, billing anchors to each tenant's join date, which is what
  `cyclesElapsed` already did — the column was dead config that looked live.

Tests: partial-update semantics (absent vs null vs value, zero treated as a
real value, malformed input rejected), month-end and leap-year cycle clamping,
30th-of-month move-ins, and that correcting a start date moves the expected
total. `make verify-backend` and `make test-e2e` (12/12) green.

---

## S2 — Money Math Unit Tests ✅

Phase 12a continued: the arithmetic that decides what a bed looks like and what
the dashboard claims you are owed is now covered by fast tests with exact
assertions. No DB, no browser — `make verify-backend` runs in under a second.

- **`computeBedStatus` (`grid.go`)** — `grid_status_test.go`. Table tests over
  the paid/partial/overdue boundaries: the one that matters is that owing
  *exactly* one full cycle is overdue while owing one paise less is partial, and
  that the threshold scales with the stay's own rent (₹5,000 short is partial on
  a ₹12,000 room, overdue on a ₹5,000 one). Also: zero rent is always paid, the
  30-day vacating window is inclusive at 30 days and open-ended in the past
  (backfilled vacates), notice outranks any end date, and vacating outranks the
  money status. `buildBed` is exercised end-to-end from a `gridRow` so the
  cycles → expected → balance → status chain is covered, not just the last step.
- **Dashboard revenue (`dashboard.go`)** — `dashboard_revenue_test.go`. The
  rollup loop was extracted from the handler into `computeRevenue(stays,
  collectedThisMonth, today) RevenueSummary` (with `stayRevenueRow` promoted to
  a package-level type) so the tests exercise production code rather than a
  copy of it. Fixtures are a five-stay portfolio on three cycles with start
  dates from February to mid-August: a monthly anchor day that has *not* come
  round yet contributes 0 to expected-this-month while one on the 1st
  contributes a full rent; a stay started mid-month bills its whole first cycle
  this month; weekly/daily stays cross several cycles inside one calendar month;
  a tenant paying ahead contributes 0 to overdue instead of netting off another
  tenant's arrears; a future start contributes nothing.
- **`formatCurrency` (`frontend/src/lib/api.ts`)** — `frontend/tests/unit/`.
  Exact rendered strings: lakh/crore grouping (`₹1,00,000`, not `₹100,000`),
  negative amounts keeping the sign outside the symbol, half-up rounding of
  sub-rupee paise. Note the two backend sign conventions are opposite — the
  tenant summary reports `expected − paid` (negative = credit), the grid reports
  `paid − expected` (negative = owes) — so both directions are asserted.
  Found in passing: `formatCurrency(-0)` renders `-₹0`. Pinned as a tripwire
  rather than fixed; Go marshals a zero `int64` as `0`, so `-0` cannot arrive
  from the API today.

**New runner:** the frontend had no unit-test runner (`make test` called a
non-existent `npm test`). Rather than adding vitest, unit tests run under
Playwright with a separate `frontend/playwright.unit.config.ts` — `testDir:
tests/unit`, no `webServer`, so nothing boots Go or Next. New targets:
`make verify-frontend`, and `make test` now runs both unit suites.

---

## Design Phase B — Component Kit ✅

Full detail in `docs/DESIGN_PLAN.md`. In short: `frontend/src/components/ui/`
now holds the whole vocabulary — `Button`, `Card`, `Field`/`Input`/`Select`/
`Textarea`/`FileInput`, `Badge`/`CountBadge`, `Banner`, `StatusPill`, `Drawer`,
`Modal`, `ConfirmDialog`, `EmptyState`, `PageHeader`, `Skeleton`, `Toast` —
and every owner-side page has been converted to use it. The grid's side column
and the pending page's hand-rolled overlay are now the shared `Drawer`; the
assign-bed modal is the shared `Modal`.

**`window.confirm` is gone from the owner app.** `useConfirm()` returns a
promise and renders a real dialog. This was a test-correctness fix too:
Playwright auto-dismisses native dialogs, so any e2e test covering a delete or
vacate would have silently exercised the cancel path.

**Frontend unit runner arrived with S2**, so `make verify-frontend` covers the
kit's pure helpers alongside `formatCurrency`.

Verification: `npx tsc --noEmit` clean, `npm run build` clean,
`make test-e2e` 12/12, and the converted pages driven by hand in a browser —
including the vacate flow end to end (confirm → stay ended → grid refreshed →
bed reads Vacant → scroll lock released).

Two follow-ups deliberately left for later phases: the tenant portal and public
registration pages are untouched (Phase C–E pick them up opportunistically),
and `Toast` is mounted but not yet wired into mutations (Phase E).

---

## Design Phase C — Responsive Shell ✅

Full detail in `docs/DESIGN_PLAN.md`. The sidebar now appears from 1024px up;
below that it becomes a bottom tab bar (Dashboard, Collections, Sites, Tenants,
Pending, both count badges carried over) plus a slim top bar holding the
wordmark and an account menu with sign out. One nav definition drives both.

Every owner page was walked at 375×812: no horizontal scroll and nothing
clipped inside a container. Three pages needed real work rather than padding —
the tenants table became a stacked list below `sm` (five columns wrapped every
cell onto two lines), pending's Approve/Reject buttons moved to their own row
(they were clipping the tenant's email mid-address), and the two- and
three-column form grids stack.

**The mobile top bar shows the wordmark, not the page title.** The plan asked
for the title, but every page already opens with its own `<h1>` and the tab bar
shows the active section, so it read as a duplicate on screen.

**A latent e2e race got fixed on the way.** Every UI test logged in with
`goto("/")` → `setItem("hostel_token")` → `goto(target)`. The first navigation
boots the app unauthenticated, which schedules a redirect to `/login`, and that
redirect can land *after* the second `goto` and steal it — the test then sits on
the dashboard (or the login page) looking for something that was never going to
be there. It had been passing on luck; two tests started failing about one run
in two. There is now a shared `loginAs()` helper using `addInitScript`, which
seeds the token before any page script runs. This touched the two pre-existing
test files too. The suite went from flaky at 46s to stable at ~10s, verified
across three consecutive clean runs.

Tests: `tests/e2e/owner/responsive.test.ts` — every page at 375px asserted for
both horizontal overflow and clipped-inside-`main` content, tab bar vs sidebar
at each breakpoint (by geometry, not by class name), tab navigation setting
`aria-current`, and the account menu signing out.

---

## Design Phase D — Hero Screens ✅

Detail in `docs/DESIGN_PLAN.md`. The grid became room cards with 96px bed tiles
(status as a left stripe over a pale tint, initials avatar, amount owed), the
legend became a filter with counts, and the dashboard got tinted stat-card
icons, a collected/expected progress bar, a red stripe on overdue, and one
consolidated "Needs attention" card. D3 landed with it: Fraunces on the wordmark
and page titles only, and an icon plus a real next step on all nine empty
states.

**This closes the vacate-backfill known issue.** The grid and the tenant page
now render the same `EndStayDialog`, so a departure recorded three days late is
billed to the day it happened from either screen.

The automated design review did not run, and could not have — the script it
called has never existed (see "Deferred" below). Before/after screenshots were
taken by hand instead.

---

## Design Phase E — Feedback Layer ✅

Detail in `docs/DESIGN_PLAN.md`. Toasts on all eighteen owner mutations, the
last `window.confirm` replaced (it was the tenant portal's notice-to-vacate,
which meant mounting `ConfirmProvider` and `ToastProvider` in the tenant shell),
and a sweep of loading states.

Three real defects surfaced while wiring it, none of them cosmetic:

1. **Silent failures.** `pending`'s approve/reject ended in
   `catch { /* ignore */ }`, and two payment deletes had no `catch` at all. A
   failed request left the row sitting there as though nothing had happened.
2. **The clipboard button claimed success it hadn't earned** — it toasted
   before awaiting `navigator.clipboard.writeText`, which rejects on a denied
   permission or an unfocused document.
3. **Width props on kit inputs had never worked.** `<Input className="w-32" />`
   was silently ignored since Phase B, because Tailwind resolves conflicting
   utilities by CSS source order rather than by the order in the class
   attribute, so the base `w-full` always won. `Field` now strips the base
   width when the caller sets one. Worth remembering the next time a kit
   component takes a `className`.

One e2e assertion was tightened rather than the code changed: the tenant test
looked for `getByText("Ended")`, which now also matches the toast's "…'s stay
ended". It asserts the badge exactly.

---

## Deferred

Things we decided are worth doing, but not now. Nothing here is half-built —
if it were, it would be under Known Issues instead.

### Go-live blockers, deliberately bypassed for the alpha 🅿️

**Decision (Aug 2026):** deploy without multi-tenancy isolation tests and
without password reset. Both were raised as go-live blockers in a status
report; the owner's call is that the alpha does not need them.

The reasoning holds, and it is worth writing down so this is not re-argued:
with exactly one owner account there is nobody for an isolation bug to leak
*to*, so the risk is unobservable. Every handler already scopes by `owner_id`
(42 query sites) — what is missing is the test proving it, not the scoping.

**The trigger is a second owner signing up, not the deploy.** Before anyone
else gets an account, write the 12b multi-tenancy tests: owner A must not be
able to read or mutate owner B's sites, rooms, beds, tenants, stays or
payments — one test per endpoint family.

Password reset stays parked until there is a second human who can lock
themselves out. Until then the fix is a `psql` update on `owners.password_hash`.

Also unaddressed and worth the same note: there is no rate limiting on
`/auth/login` or `/public/register/:ownerId`. Low risk while the registration
link is not public; a problem the day it is printed on a QR code by the door.

### Automated design review 🅿️

**The idea:** screenshot every page at 1280px and 375px with Playwright, send
the images to Claude's vision API with the "Design direction" section of
`docs/DESIGN_PLAN.md` as the rubric, and write the critique to
`test-results/design-review.md`. Run it before and after each design phase and
diff the two — a second pair of eyes on work that no test can assert.

**Status (Aug 2026): removed, not written.** `make review-design` existed as a
Makefile target from Phase 6 and `docs/` described the script as shipped, but
`scripts/review-design.ts` was never committed — the Phase 5–6 commit
(`6234f1c`) adds only `fix-tests.ts` and the package files. The target guarded
on `ANTHROPIC_API_KEY` and would then have failed on a missing file, which is
exactly the sort of trap that costs someone twenty minutes. Target, npm script,
and the now-unused `@anthropic-ai/sdk` dependency have been removed.

**To build it** (roughly 80 lines in `scripts/review-design.ts`, plus putting
the SDK dependency back):
1. Reuse the Playwright setup to visit each owner route at both viewports and
   save PNGs.
2. Base64 the images into one `messages.create` call with the design direction
   as the rubric.
3. Write the response to `test-results/design-review.md`, and restore the
   `review-design` Makefile target with its `ANTHROPIC_API_KEY` guard.

**Worth it when** design phases are still landing and the before/after
comparison earns its keep. Phases E and F are the last two, so if it does not
get built before those, it probably should not be built at all.

---

## Known Issues

Found while verifying the billing fixes (Aug 2026). None are fixed yet.

### ~~Vacate-from-grid can't backfill a date~~ ✅ fixed in design Phase D
Both paths now render the shared `components/EndStayDialog.tsx`, so the grid and
the tenant page ask for a move-out date the same way and bill to the same day.

### ~~Collapsed stay cards show "Paid ₹0"~~ ✅ fixed in Phase 11
The ledger is still lazy-loaded on expand, but the card now reads "Paid —"
until the payments arrive rather than claiming zero. Fixed when the settlement
work put a refund figure next to it, where a false zero stops being cosmetic.

---

## Architecture Notes

- **Amounts**: stored in paise (1 INR = 100 paise), displayed via `formatCurrency()`
- **Multi-tenancy**: every query filters by `owner_id`; bed/room ownership verified by joining up the chain (bed → room → site → owner)
- **Active stay**: `stays WHERE end_date IS NULL` — only one allowed per bed (enforced at API level)
- **Token storage**: JWT in `localStorage` (client-side only); future consideration: httpOnly cookie
- **DB migrations**: managed via `golang-migrate` CLI (`make migrate`)
