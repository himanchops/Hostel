package storage

import (
	"context"
	"os"
)

// NewFromEnv returns the storage backend selected by the STORAGE_BACKEND env var.
//
// STORAGE_BACKEND=s3   → S3Storage (requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY,
//                       S3_SECRET_KEY, S3_PUBLIC_URL; S3_REGION optional, defaults "auto")
// STORAGE_BACKEND=""   → LocalStorage (default for local dev; uses UPLOADS_DIR
//                       and BASE_URL, defaulting to "./uploads" and "http://localhost:8080")
//
// Any other value falls back to local with no error so a typo can't accidentally
// disable uploads in production silently — the smoke-test CLI will still log
// which backend was selected.
func NewFromEnv(ctx context.Context) (Service, error) {
	switch os.Getenv("STORAGE_BACKEND") {
	case "s3":
		return NewS3Storage(ctx, S3Config{
			Endpoint:  os.Getenv("S3_ENDPOINT"),
			Region:    envOr("S3_REGION", "auto"),
			Bucket:    os.Getenv("S3_BUCKET"),
			AccessKey: os.Getenv("S3_ACCESS_KEY"),
			SecretKey: os.Getenv("S3_SECRET_KEY"),
			PublicURL: os.Getenv("S3_PUBLIC_URL"),
		})
	default:
		return NewLocalStorage(
			envOr("UPLOADS_DIR", "./uploads"),
			envOr("BASE_URL", "http://localhost:8080"),
		), nil
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
