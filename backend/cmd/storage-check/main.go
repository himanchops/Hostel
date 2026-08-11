// Smoke-test CLI for the configured storage backend.
//
// Reads STORAGE_BACKEND and the matching env vars (same as the server),
// uploads a single file, and prints the resulting public URL. Use this
// after a deploy to confirm S3/R2 credentials and bucket config are correct
// without touching the live UI.
//
// Usage:
//   STORAGE_BACKEND=s3 \
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
//   S3_BUCKET=hostel \
//   S3_ACCESS_KEY=... S3_SECRET_KEY=... \
//   S3_PUBLIC_URL=https://pub-xxx.r2.dev \
//     go run ./cmd/storage-check --file path/to/test.png
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/joho/godotenv"
	"github.com/winnow/hostel/internal/storage"
)

func main() {
	file := flag.String("file", "", "path to a local file to upload (any MIME type)")
	flag.Parse()

	if *file == "" {
		log.Fatal("usage: storage-check --file <path>")
	}

	_ = godotenv.Load()

	svc, err := storage.NewFromEnv(context.Background())
	if err != nil {
		log.Fatalf("init storage: %v", err)
	}

	fmt.Printf("Backend: %T\n", svc)

	f, err := os.Open(*file)
	if err != nil {
		log.Fatalf("open file: %v", err)
	}
	defer f.Close()

	// Probe content type — extension first, then sniff first 512 bytes if unknown.
	ext := filepath.Ext(*file)
	ct := mime.TypeByExtension(ext)
	if ct == "" {
		buf := make([]byte, 512)
		n, _ := f.Read(buf)
		ct = http.DetectContentType(buf[:n])
		if _, err := f.Seek(0, 0); err != nil {
			log.Fatalf("seek file: %v", err)
		}
	}

	key := fmt.Sprintf("smoke-test/%d%s", time.Now().Unix(), ext)
	url, err := svc.Upload(context.Background(), key, ct, f)
	if err != nil {
		log.Fatalf("upload failed: %v", err)
	}

	fmt.Println("OK")
	fmt.Printf("Key: %s\n", key)
	fmt.Printf("URL: %s\n", url)
	fmt.Println()
	fmt.Println("Open the URL in a browser to verify it's publicly readable.")
}
