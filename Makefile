export PATH := /opt/homebrew/opt/node/bin:/opt/homebrew/bin:$(PATH)

.PHONY: dev setup db-up db-down migrate backend frontend

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

# Run all tests
test:
	cd backend && go test ./...
	cd frontend && npm test
