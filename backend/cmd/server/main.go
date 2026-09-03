package main

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/winnow/hostel/internal/auth"
	"github.com/winnow/hostel/internal/database"
	"github.com/winnow/hostel/internal/handlers"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/observability"
	"github.com/winnow/hostel/internal/storage"
)

func main() {
	godotenv.Load()

	// Error tracking first, so that a failure during the startup sequence below
	// is itself reportable. Init is a no-op without SENTRY_DSN and says so on
	// stdout either way — "configured but silently dead" and "healthy" must not
	// look the same.
	observability.Init()
	defer observability.Flush()

	// In production, hosted Postgres providers (Neon, Render, Supabase, Fly)
	// hand out a single DATABASE_URL. Locally we keep the per-field DB_* vars.
	var (
		db  *sqlx.DB
		err error
	)
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		db, err = database.ConnectURL(dbURL)
	} else {
		dbPort, _ := strconv.Atoi(getEnv("DB_PORT", "5432"))
		db, err = database.Connect(database.Config{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     dbPort,
			User:     getEnv("DB_USER", "hostel"),
			Password: getEnv("DB_PASSWORD", "hostel_dev"),
			DBName:   getEnv("DB_NAME", "hostel"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		})
	}
	if err != nil {
		observability.Fatalf(err, "Failed to connect to database")
	}
	defer db.Close()

	jwtSecret := getEnv("JWT_SECRET", "dev-secret-change-in-production")
	authService := auth.NewService(jwtSecret, 24*time.Hour)

	// Storage backend selected by STORAGE_BACKEND env var (s3 or local).
	storageSvc, err := storage.NewFromEnv(context.Background())
	if err != nil {
		observability.Fatalf(err, "Failed to initialize storage backend")
	}

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
	insightsHandler := handlers.NewInsightsHandler(db)
	collectionsHandler := handlers.NewCollectionsHandler(db)
	settlementHandler := handlers.NewSettlementHandler(db)
	uploadHandler := handlers.NewUploadHandler(storageSvc)

	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Logger())

	// Panics do not pass through handlers.serverError — Recover turns them into
	// a 500 before any handler code runs — so without this hook the one class of
	// failure that most needs a stack trace would be the one class that never
	// reaches the tracker. LogErrorFunc returning err preserves Echo's default
	// behaviour of handing the error to the centralized HTTPErrorHandler.
	e.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{
		LogErrorFunc: func(c echo.Context, err error, stack []byte) error {
			c.Logger().Errorf("PANIC %s %s: %v\n%s", c.Request().Method, c.Path(), err, stack)
			observability.CapturePanic(err, c.Request(), c.Request().Method, c.Path())
			return err
		},
	}))

	// Behind Render's proxy the client address is only in X-Forwarded-For.
	// Echo's fallback reads the FIRST entry of that header, which the client
	// writes and can therefore forge — enough to walk straight past the upload
	// rate limiter by rotating a header value. ExtractIPFromXFFHeader walks the
	// chain right-to-left instead, skipping loopback/link-local/private hops,
	// so it lands on the last address the proxy itself observed.
	e.IPExtractor = echo.ExtractIPFromXFFHeader()

	// CORS. FRONTEND_URL accepts a comma-separated list of allowed origins.
	// When it is unset (local dev) we additionally accept loopback and
	// private-range LAN origins on any port, so the app can be opened from a
	// phone on the same Wi-Fi. A rejected origin gets a 204 preflight with no
	// Access-Control-Allow-Origin header, which the browser reports only as a
	// silently dropped request — hence the permissive dev default.
	corsConfig := middleware.CORSConfig{
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAuthorization},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	}
	if frontendURL := os.Getenv("FRONTEND_URL"); frontendURL != "" {
		corsConfig.AllowOrigins = appMiddleware.ParseOrigins(frontendURL)
		log.Printf("CORS: allowing configured origins %v", corsConfig.AllowOrigins)
	} else {
		corsConfig.AllowOriginFunc = appMiddleware.DevOriginAllowed
		log.Print("CORS: FRONTEND_URL unset — allowing localhost/loopback/LAN origins (dev mode)")
	}
	e.Use(middleware.CORSWithConfig(corsConfig))

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
	e.GET("/public/owners/:ownerId", tenantHandler.PublicOwner)
	e.POST("/public/register/:ownerId", tenantHandler.PublicRegister)
	e.POST("/public/upload", uploadHandler.PublicUpload, appMiddleware.PublicUploadRateLimiter())
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

	// Insights — the historical view. Everything else in this API answers
	// "what is true now"; this one answers "what has been happening".
	api.GET("/insights", insightsHandler.GetInsights)

	// Collections
	api.GET("/collections", collectionsHandler.GetCollections)

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
	api.GET("/tenants/:id/settlements", settlementHandler.ListByTenant)

	// Stays
	api.POST("/stays", stayHandler.Create)
	api.GET("/stays/:id", stayHandler.Get)
	api.PUT("/stays/:id", stayHandler.Update)
	api.PUT("/stays/:id/assign-bed", stayHandler.AssignBed)

	// Settlements (move-out money reckoning)
	api.GET("/stays/:id/settlement-preview", settlementHandler.Preview)
	api.POST("/stays/:id/settlement", settlementHandler.Create)

	// Payments (nested under stays)
	api.GET("/stays/:stayId/payments", paymentHandler.List)
	api.POST("/stays/:stayId/payments", paymentHandler.Create)
	api.DELETE("/payments/:id", paymentHandler.Delete)
	api.GET("/payments/pending", paymentHandler.ListPending)
	api.POST("/payments/:id/approve", paymentHandler.Approve)

	port := getEnv("PORT", "8080")
	log.Printf("Starting server on :%s", port)
	// Not e.Logger.Fatal: that calls os.Exit, which skips every deferred Flush
	// and would drop the report explaining why the process died.
	if err := e.Start(":" + port); err != nil {
		observability.Fatalf(err, "Server stopped")
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
