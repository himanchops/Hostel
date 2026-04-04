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
	"github.com/winnow/hostel/internal/handlers"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/storage"
)

func main() {
	godotenv.Load()

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

	jwtSecret := getEnv("JWT_SECRET", "dev-secret-change-in-production")
	authService := auth.NewService(jwtSecret, 24*time.Hour)

	// Storage
	storageSvc := storage.NewLocalStorage(
		"./uploads",
		getEnv("BASE_URL", "http://localhost:8080"),
	)

	// Handlers
	authHandler := handlers.NewAuthHandler(db, authService)
	siteHandler := handlers.NewSiteHandler(db)
	roomHandler := handlers.NewRoomHandler(db)
	tenantHandler := handlers.NewTenantHandler(db, authService)
	tenantAuthHandler := handlers.NewTenantAuthHandler(db, authService)
	tenantPortalHandler := handlers.NewTenantPortalHandler(db)
	stayHandler := handlers.NewStayHandler(db)
	paymentHandler := handlers.NewPaymentHandler(db)
	gridHandler := handlers.NewGridHandler(db)
	dashboardHandler := handlers.NewDashboardHandler(db)
	uploadHandler := handlers.NewUploadHandler(storageSvc)

	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{getEnv("FRONTEND_URL", "http://localhost:3000")},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAuthorization},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	}))

	// Serve uploaded files (local dev only; in production files are on S3/R2)
	e.Static("/uploads", "./uploads")

	// Health
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"status": "ok"})
	})

	// Public auth routes
	e.POST("/auth/signup", authHandler.Signup)
	e.POST("/auth/login", authHandler.Login)

	// Public tenant self-registration + auth + upload
	e.POST("/public/register/:ownerId", tenantHandler.PublicRegister)
	e.POST("/public/upload", uploadHandler.PublicUpload)
	e.POST("/tenant-auth/login", tenantAuthHandler.Login)

	// Tenant portal (tenant JWT required)
	portal := e.Group("/tenant")
	portal.Use(appMiddleware.TenantAuthMiddleware(authService))
	portal.GET("/me", tenantAuthHandler.Me)
	portal.GET("/stays", tenantPortalHandler.GetStays)
	portal.POST("/stays/:stayId/payments", tenantPortalHandler.SubmitPayment)
	portal.PUT("/stays/:stayId/notice", tenantPortalHandler.SubmitNotice)
	portal.POST("/upload", uploadHandler.TenantUpload)

	// Protected routes
	api := e.Group("/api")
	api.Use(appMiddleware.AuthMiddleware(authService))

	// Owner
	api.GET("/me", authHandler.Me)

	// Sites
	api.GET("/sites", siteHandler.List)
	api.POST("/sites", siteHandler.Create)
	api.GET("/sites/:id", siteHandler.Get)
	api.PUT("/sites/:id", siteHandler.Update)
	api.DELETE("/sites/:id", siteHandler.Delete)

	// Rooms (nested under sites)
	api.GET("/sites/:siteId/rooms", roomHandler.ListRooms)
	api.POST("/sites/:siteId/rooms", roomHandler.CreateRoom)
	api.PUT("/sites/:siteId/rooms/:id", roomHandler.UpdateRoom)
	api.DELETE("/sites/:siteId/rooms/:id", roomHandler.DeleteRoom)

	// Beds (nested under rooms)
	api.GET("/sites/:siteId/rooms/:roomId/beds", roomHandler.ListBeds)
	api.POST("/sites/:siteId/rooms/:roomId/beds", roomHandler.CreateBed)
	api.PUT("/sites/:siteId/rooms/:roomId/beds/:id", roomHandler.UpdateBed)
	api.DELETE("/sites/:siteId/rooms/:roomId/beds/:id", roomHandler.DeleteBed)

	// Dashboard
	api.GET("/dashboard", dashboardHandler.GetDashboard)

	// Grid
	api.GET("/sites/:siteId/grid", gridHandler.GetGrid)

	// Tenants
	api.GET("/tenants", tenantHandler.List)
	api.POST("/tenants", tenantHandler.Create)
	api.GET("/tenants/:id", tenantHandler.Get)
	api.PUT("/tenants/:id", tenantHandler.Update)
	api.POST("/tenants/:id/approve", tenantHandler.Approve)
	api.DELETE("/tenants/:id/reject", tenantHandler.Reject)
	api.GET("/tenants/:id/stays", stayHandler.ListByTenant)
	api.GET("/tenants/:id/summary", tenantHandler.Summary)

	// Stays
	api.POST("/stays", stayHandler.Create)
	api.GET("/stays/:id", stayHandler.Get)
	api.PUT("/stays/:id", stayHandler.Update)
	api.PUT("/stays/:id/assign-bed", stayHandler.AssignBed)

	// Payments (nested under stays)
	api.GET("/stays/:stayId/payments", paymentHandler.List)
	api.POST("/stays/:stayId/payments", paymentHandler.Create)
	api.DELETE("/payments/:id", paymentHandler.Delete)
	api.GET("/payments/pending", paymentHandler.ListPending)
	api.POST("/payments/:id/approve", paymentHandler.Approve)

	port := getEnv("PORT", "8080")
	log.Printf("Starting server on :%s", port)
	e.Logger.Fatal(e.Start(":" + port))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
