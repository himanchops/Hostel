package storage

import (
	"context"
	"testing"
)

func TestNewFromEnv_DefaultsToLocal(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "")

	svc, err := NewFromEnv(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := svc.(*LocalStorage); !ok {
		t.Fatalf("expected *LocalStorage, got %T", svc)
	}
}

func TestNewFromEnv_S3WhenConfigured(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("S3_ENDPOINT", "https://example.r2.cloudflarestorage.com")
	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_ACCESS_KEY", "AKIAEXAMPLE")
	t.Setenv("S3_SECRET_KEY", "secret")
	t.Setenv("S3_PUBLIC_URL", "https://pub-test.r2.dev")

	svc, err := NewFromEnv(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := svc.(*S3Storage); !ok {
		t.Fatalf("expected *S3Storage, got %T", svc)
	}
}

func TestNewFromEnv_S3MissingCredsErrors(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("S3_ENDPOINT", "https://example.r2.cloudflarestorage.com")
	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_ACCESS_KEY", "")
	t.Setenv("S3_SECRET_KEY", "")
	t.Setenv("S3_PUBLIC_URL", "https://pub-test.r2.dev")

	_, err := NewFromEnv(context.Background())
	if err == nil {
		t.Fatal("expected error when S3 creds are missing")
	}
}

func TestNewFromEnv_UnknownBackendFallsBackToLocal(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "ftp")

	svc, err := NewFromEnv(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := svc.(*LocalStorage); !ok {
		t.Fatalf("expected *LocalStorage fallback, got %T", svc)
	}
}
