.PHONY: dev db-up db-down migrate backend frontend

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
