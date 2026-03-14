package main

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/winnow/hostel/internal/auth"
	"github.com/winnow/hostel/internal/database"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
)

func main() {
	// Load .env file if it exists
	godotenv.Load()

	// Database config
	dbPort, _ := strconv.Atoi(getEnv("DB_PORT", "5432"))
	dbConfig := database.Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     dbPort,
		User:     getEnv("DB_USER", "hostel"),
		Password: getEnv("DB_PASSWORD", "hostel_dev"),
		DBName:   getEnv("DB_NAME", "hostel"),
		SSLMode:  getEnv("DB_SSLMODE", "disable"),
	}

	db, err := database.Connect(dbConfig)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Auth service
	jwtSecret := getEnv("JWT_SECRET", "dev-secret-change-in-production")
	authService := auth.NewService(jwtSecret, 24*time.Hour)

	// Echo instance
	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	// Health check
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"status": "ok"})
	})

	// Public routes
	// TODO: Add signup/login routes

	// Protected routes
	api := e.Group("/api")
	api.Use(appMiddleware.AuthMiddleware(authService))

	// TODO: Add protected routes
	// - Sites CRUD
	// - Rooms CRUD
	// - Beds CRUD
	// - Tenants CRUD
	// - Stays CRUD
	// - Payments CRUD

	// Start server
	port := getEnv("PORT", "8080")
	log.Printf("Starting server on :%s", port)
	e.Logger.Fatal(e.Start(":" + port))

	_ = db // Will be used when we add handlers
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
