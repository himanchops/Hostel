package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"time"
)

// LocalStorage saves files to a local directory for development.
//
// Its "signed" links are plain links to the dev server's /uploads route and
// never expire — there is nothing private on a laptop to protect, and faking
// expiry here would only make local debugging harder. Production uses
// S3Storage, whose links do expire.
type LocalStorage struct {
	dir     string // absolute or relative directory path, e.g. "./uploads"
	baseURL string // e.g. "http://localhost:8080"
}

func NewLocalStorage(dir, baseURL string) *LocalStorage {
	os.MkdirAll(dir, 0755)
	return &LocalStorage{dir: dir, baseURL: baseURL}
}

func (s *LocalStorage) Upload(_ context.Context, key, _ string, r io.Reader) error {
	dst := filepath.Join(s.dir, key)
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *LocalStorage) SignedURL(_ context.Context, key string, _ time.Duration) (string, error) {
	return s.baseURL + "/uploads/" + key, nil
}
