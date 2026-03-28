package storage

import (
	"context"
	"io"
)

// Service is the interface for file storage backends.
type Service interface {
	// Upload stores the reader under the given key and returns a publicly accessible URL.
	Upload(ctx context.Context, key, contentType string, r io.Reader) (url string, err error)
}
