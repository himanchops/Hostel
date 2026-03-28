package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
)

// LocalStorage saves files to a local directory and returns URLs relative to a base URL.
// Used for local development; swap for S3Storage in production.
type LocalStorage struct {
	dir     string // absolute or relative directory path, e.g. "./uploads"
	baseURL string // e.g. "http://localhost:8080"
}

func NewLocalStorage(dir, baseURL string) *LocalStorage {
	os.MkdirAll(dir, 0755)
	return &LocalStorage{dir: dir, baseURL: baseURL}
}

func (s *LocalStorage) Upload(_ context.Context, key, _ string, r io.Reader) (string, error) {
	dst := filepath.Join(s.dir, key)
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return "", err
	}
	f, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", err
	}
	return s.baseURL + "/uploads/" + key, nil
}
