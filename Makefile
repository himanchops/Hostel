export PATH := /opt/homebrew/opt/node/bin:/opt/homebrew/bin:$(PATH)

.PHONY: dev setup db-up db-down migrate backend frontend verify-backend import-data import-data-dry storage-check test-e2e test-e2e-ui test-e2e-debug fix-tests review-design clean-e2e-data

# One-shot setup: install deps, start DB, migrate, then run backend + frontend in parallel
setup:
	@echo "→ Installing Go dependencies..."
	cd backend && go mod download
	@echo "→ Installing Node dependencies..."
	cd frontend && npm install
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

# Run all tests
test:
	cd backend && go test ./...
	cd frontend && npm test

# ── E2E ────────────────────────────────────────────────────────────────────────

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

# ── Design review via Claude Vision ───────────────────────────────────────────

review-design:
	@test -n "$$ANTHROPIC_API_KEY" || (echo "Error: ANTHROPIC_API_KEY is not set" && exit 1)
	cd scripts && npm install --silent && npx tsx review-design.ts
	@echo "→ Design review written to test-results/design-review.md"

# ── Clean e2e test data ─────────────────────────────────────────────────────────

clean-e2e-data:
	docker compose exec -T db psql -U hostel -c \
	  "DELETE FROM owners WHERE email LIKE 'e2e-%@test.local';"
	@echo "→ E2E test data cleaned"
