# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start PostgreSQL
make db-up

# Run database migrations (install golang-migrate first)
make migrate

# Run backend (localhost:8080)
make backend

# Run frontend (localhost:3000) - requires Node 20+
make frontend

# Build backend binary
make build-backend
```

## Project Structure

```
hostel/
├── backend/
│   ├── cmd/server/          # Main entry point
│   ├── internal/
│   │   ├── auth/            # JWT + bcrypt
│   │   ├── database/        # PostgreSQL connection
│   │   ├── middleware/      # Auth middleware
│   │   └── models/          # Domain models
│   └── migrations/          # SQL migrations
├── frontend/                # Next.js app
└── docker-compose.yml       # PostgreSQL
```

## Current Status

**See `docs/PROGRESS.md` for the full phase-by-phase build log.** Always read this first when resuming a session — it is the canonical handoff document and is kept up to date at the end of every session.

Current state (Aug 2026): Phases 0–9.1, **design Phases A–F complete**, **Phase 10 (Collections & WhatsApp nudges)** and **Phase 11 (Settlement calculator)** are merged, along with two stabilization passes — **S1 data integrity** (partial stay updates, correctable stays, month-end cycle clamping) and **S2 money-math unit tests** (`computeBedStatus`, dashboard revenue, `formatCurrency`). Everything on the roadmap before deployment is done: next up is **deploy, Phase 9.2–9.6** (Neon → R2 → Render → Vercel, `docs/DEPLOYMENT.md`).

UI work goes through `frontend/src/components/ui/` (design Phase B). New pages must not hand-roll buttons, cards, inputs, drawers or modals, and must not call `window.confirm` — use `useConfirm()`. `grep -rn "ring-stone-200" frontend/src/app` must stay at zero. Every mutation shows a toast (`useToast()`), and every failure path surfaces somewhere — inline `FormError` in forms, a toast elsewhere. Every page must work at 375px (design Phase C): sidebar above 1024px, bottom tab bar below.

E2E tests log in with `loginAs(page, token)` from `tests/e2e/helpers/api.ts` — never `goto("/")` then `localStorage.setItem`, which races with the root redirect.

**Roadmap decision (Apr 2026): deployment is deferred until after the UI modernization and two value features.** Execution order: design Phases A–B (`docs/DESIGN_PLAN.md`) → Phase 10 Collections & WhatsApp nudges (`docs/PROGRESS.md`) → design Phases C–E → Phase 11 Settlement calculator → design Phase F → deploy (Phase 9.2–9.6, `docs/DEPLOYMENT.md`).

Key conventions to carry forward:
- Every new feature ships with a Playwright e2e test in `frontend/tests/e2e/`
- Money math ships with a unit test too — `backend/internal/handlers/*_test.go` or `frontend/tests/unit/`. Exact values, non-degenerate fixtures (see Phase 12a in `docs/PROGRESS.md`)
- Amounts stored in **paise** (₹1 = 100 paise), displayed via `formatCurrency()`
- Go and Node are not on the default PATH in Claude's shell, and the paths differ per laptop — check before assuming. On the Homebrew machines: `export PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH`. Postgres may run natively (`brew services`) rather than via Docker, in which case `make db-up` is a no-op.

## Git Remote

Remote: `git@github-personal:himanchops/Hostel.git`

Uses SSH host alias `github-personal` (defined in `~/.ssh/config` → `~/.ssh/github_personal` key). Always use this alias in remote URLs — **not** `git@github.com`.

```bash
git remote add origin git@github-personal:himanchops/Hostel.git
git push -u origin master
```

---

## Project Overview

Multi-tenant SaaS web application for hostel and PG (paying guest) owners to manage rent tracking and occupancy planning. Core value is a dynamic room grid showing occupancy and payment status with support for irregular usage patterns and backfilled data entries.

## Tech Stack

- **Backend**: Go with Echo framework
- **Frontend**: Next.js with React and TailwindCSS
- **Database**: PostgreSQL with multi-tenant isolation
- **Auth**: JWT with bcrypt password hashing
- **Storage**: S3-compatible for file uploads (tenant photos, ID proofs)
- **Deployment**: Render, Fly.io, or Railway

## Architecture

### Multi-Tenancy Model
Each owner's data must be strictly isolated. All database queries and API endpoints must scope data to the authenticated owner's tenant context.

### Core Entities
- **Owner** - Admin user with full access to their tenant scope
- **HostelSite** - Multiple sites per owner
- **Room/Bed** - Rooms within sites, optionally with individual beds
- **Tenant/Renter** - Occupants
- **Stay** - Occupancy history tracking
- **Payment** - Ledger entries for rent/deposit tracking

### Room Grid States
The primary UI feature uses color coding:
- Occupied & paid (green)
- Occupied & partial payment (yellow)
- Occupied & overdue (red)
- Vacant (gray)
- Vacating soon (orange)

### User Roles
Currently implementing Owner (admin) role only. System should be designed for future Staff and Renter login extensibility.

### Tenant Registration Flow
1. Public QR-link form for tenant self-registration
2. Owner reviews pending registrations
3. Owner approves and assigns room/rent/deposit

### Tenant Portal (Limited Access)
- View payment ledger
- Submit payment proof screenshots
- Submit notice to vacate
- All entries require owner approval