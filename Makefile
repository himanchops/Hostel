export PATH := /opt/homebrew/opt/node/bin:/opt/homebrew/bin:$(PATH)

.PHONY: dev setup db-up db-down migrate backend frontend seed-demo seed-demo-reset verify-backend verify-frontend import-data import-data-dry storage-check playwright-install test-e2e test-e2e-ui test-e2e-debug fix-tests clean-e2e-data

# One-shot setup: install deps, start DB, migrate, then run backend + frontend in parallel
setup:
	@echo "→ Installing Go dependencies..."
	cd backend && go mod download
	@echo "→ Installing Node dependencies..."
	cd frontend && npm install
	@echo "→ Installing Playwright browser (needed by make test-e2e)..."
	cd frontend && npx playwright install chromium
	@echo "→ Starting PostgreSQL..."
	docker compose up -d
	@echo "→ Waiting for Postgres to be ready..."
	@until docker compose exec -T db pg_isready -U hostel -q 2>/dev/null; do sleep 1; done
	@echo "→ Running migrations..."
	migrate -path backend/migrations -database "postgres://hostel:hostel_dev@localhost:5432/hostel?sslmode=disable" up
	@echo "→ Creating uploads directory..."
	mkdir -p backend/uploads
	@echo ""
	@echo "✓ Setup complete. Run 'make dev' to start the app."

# Run backend + frontend together
dev:
	@echo "Starting backend (:8080) and frontend (:3000)..."
	@trap 'kill 0' INT; \
	  (cd backend && go run cmd/server/main.go) & \
	  (cd frontend && npm run dev) & \
	  wait

# Start PostgreSQL
db-up:
	docker compose up -d

# Stop PostgreSQL
db-down:
	docker compose down

# Run database migrations (requires golang-migrate CLI)
migrate:
	migrate -path backend/migrations -database "postgres://hostel:hostel_dev@localhost:5432/hostel?sslmode=disable" up

migrate-down:
	migrate -path backend/migrations -database "postgres://hostel:hostel_dev@localhost:5432/hostel?sslmode=disable" down

# Run backend
backend:
	cd backend && go run cmd/server/main.go

# Run frontend (use Node 20+)
frontend:
	cd frontend && npm run dev

# Build backend
build-backend:
	cd backend && go build -o bin/server cmd/server/main.go

# Full backend verify: tidy deps, compile everything (all cmds), run unit tests
verify-backend:
	cd backend && go mod tidy && go build ./... && go test ./...

# Frontend unit tests (pure functions in src/lib) — no browser, no dev server.
verify-frontend:
	cd frontend && npm run test:unit

# Bulk-import tenants/stays/payments from a JSON file (see docs/import-prompt.md)
# Usage: make import-data OWNER=you@example.com FILE=ledger.json
import-data:
	@test -n "$(OWNER)" || (echo "Error: OWNER=<email> required" && exit 1)
	@test -n "$(FILE)" || (echo "Error: FILE=<path.json> required" && exit 1)
	cd backend && go run ./cmd/import --owner $(OWNER) --file ../$(FILE)

import-data-dry:
	@test -n "$(OWNER)" || (echo "Error: OWNER=<email> required" && exit 1)
	@test -n "$(FILE)" || (echo "Error: FILE=<path.json> required" && exit 1)
	cd backend && go run ./cmd/import --owner $(OWNER) --file ../$(FILE) --dry-run

# Storage smoke test — uploads a single file through whichever backend STORAGE_BACKEND points to.
# Usage: make storage-check FILE=path/to/image.png
storage-check:
	@test -n "$(FILE)" || (echo "Error: FILE=<path> required" && exit 1)
	cd backend && go run ./cmd/storage-check --file ../$(FILE)

# Run all unit tests (e2e is a separate target — see test-e2e)
test:
	cd backend && go test ./...
	cd frontend && npm run test:unit

# ── Demo data ──────────────────────────────────────────────────────────────────

# Seed a demo owner covering every state the UI can show — all five bed
# statuses, a bed-less stay, a settled move-out, a pending registration and a
# payment awaiting approval. Backend must be running.
#
# The owner is demo@seed.invalid: .invalid is reserved by RFC 2606 and can
# never be a real address. An earlier version of this script guessed a
# plausible-looking demo email, hit a real account, and wrote fake tenants into
# live data — hence the reserved domain and the refusal to reuse an owner.
seed-demo:
	python3 scripts/seed-demo.py

# Scoped to the reserved seed address, so it cannot reach a real account.
seed-demo-reset:
	psql "postgres://hostel:hostel_dev@localhost:5432/hostel?sslmode=disable" \
	  -c "DELETE FROM owners WHERE email = 'demo@seed.invalid';"
	python3 scripts/seed-demo.py

# ── E2E ────────────────────────────────────────────────────────────────────────

# Download the browser Playwright drives. Run once per machine; `make setup`
# does it for you. Without it, every UI test fails with "Executable doesn't exist".
playwright-install:
	cd frontend && npx playwright install chromium

test-e2e:
	cd frontend && npx playwright test

test-e2e-ui:
	cd frontend && npx playwright test --ui

test-e2e-debug:
	cd frontend && npx playwright test --debug

# ── Fix report from test failures ──────────────────────────────────────────────

fix-tests:
	@test -f test-results/failures.json || (echo "Error: test-results/failures.json not found. Run 'make test-e2e' first." && exit 1)
	cd scripts && npm install --silent && npx tsx fix-tests.ts

# ── Clean e2e test data ─────────────────────────────────────────────────────────

clean-e2e-data:
	docker compose exec -T db psql -U hostel -c \
	  "DELETE FROM owners WHERE email LIKE 'e2e-%@test.local';"
	@echo "→ E2E test data cleaned"
