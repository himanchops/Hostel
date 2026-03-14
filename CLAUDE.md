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