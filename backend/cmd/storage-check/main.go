// Smoke-test CLI for the configured storage backend.
//
// Reads STORAGE_BACKEND and the matching env vars (same as the server),
// uploads a single file, and proves the two things private storage promises:
// the signed link the app would hand a browser opens the file, and the
// file's plain address does not. Use it after a deploy, or after changing
// the bucket's public-access setting, without touching the live UI.
//
// Usage:
//
//	STORAGE_BACKEND=s3 \
//	S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
//	S3_BUCKET=hostel \
//	S3_ACCESS_KEY=... S3_SECRET_KEY=... \
//	  go run ./cmd/storage-check --file path/to/test.png \
//	    [--public-url https://pub-xxx.r2.dev]
//
// --public-url is the bucket's old public base, if it ever had one. With it,
// the check also fetches <public-url>/<key> and fails if that still works —
// the proof that turning public access off actually took.
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
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/winnow/hostel/internal/storage"
)

func main() {
	file := flag.String("file", "", "path to a local file to upload (any MIME type)")
	publicURL := flag.String("public-url", "", "the bucket's former public base URL; if set, checks it no longer serves the file")
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
	if err := svc.Upload(context.Background(), key, ct, f); err != nil {
		log.Fatalf("upload failed: %v", err)
	}
	fmt.Printf("Uploaded: %s\n", key)

	link, err := svc.SignedURL(context.Background(), key, 5*time.Minute)
	if err != nil {
		log.Fatalf("sign failed: %v", err)
	}
	if status := get(link); status != http.StatusOK {
		log.Fatalf("FAIL: the signed link returned %d, want 200 — the app's images would be broken.\n"+
			"Check that the API token has Object Read, not only Write.", status)
	}
	fmt.Println("OK: signed link opens the file")

	if *publicURL == "" {
		fmt.Println("Skipped: public-access check (pass --public-url to run it)")
		return
	}
	plain := strings.TrimRight(*publicURL, "/") + "/" + key
	if status := get(plain); status == http.StatusOK {
		log.Fatalf("FAIL: %s is still publicly readable — public access is still on for this bucket.", plain)
	} else {
		fmt.Printf("OK: plain link refused (%d) — the bucket is private\n", status)
	}
}

// get returns the HTTP status for url, treating a transport failure (e.g. a
// disabled r2.dev subdomain that no longer resolves) as "not served".
func get(url string) int {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		fmt.Printf("  (%v)\n", err)
		return 0
	}
	resp.Body.Close()
	return resp.StatusCode
}
