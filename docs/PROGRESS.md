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

## Phase 3 — Tenant Self-Registration (QR Flow) 🔜

Planned:
- Public endpoint `GET /register/:ownerSlug` — no auth required
- Tenant submits: name, phone, email, ID proof photo upload
- Owner sees pending registrations list in dashboard
- Owner approves → assigns room/bed/rent → creates stay
- Owner generates QR code linking to their registration URL
- `owner_slug` field on `owners` table (new migration needed)

---

## Phase 4 — Dashboard Insights 🔜

Planned:
- Occupancy rate per site (occupied beds / total beds)
- Total rent collected this month vs expected
- Overdue count + total overdue amount
- Upcoming vacations (notice given, ending within 30 days)
- Recent payment activity feed
- `GET /api/dashboard` summary endpoint

---

## Phase 5 — Tenant Portal 🔜

Planned:
- Separate tenant login (email/phone + OTP or password)
- Tenant views their own payment ledger
- Tenant submits payment proof (screenshot upload to S3)
- Tenant submits notice to vacate
- All tenant-submitted entries flagged `is_approved = false`, owner reviews
- Minimal, mobile-first UI separate from owner dashboard

---

## Architecture Notes

- **Amounts**: stored in paise (1 INR = 100 paise), displayed via `formatCurrency()`
- **Multi-tenancy**: every query filters by `owner_id`; bed/room ownership verified by joining up the chain (bed → room → site → owner)
- **Active stay**: `stays WHERE end_date IS NULL` — only one allowed per bed (enforced at API level)
- **Token storage**: JWT in `localStorage` (client-side only); future consideration: httpOnly cookie
- **DB migrations**: managed via `golang-migrate` CLI (`make migrate`)
