package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/storage"
)

const maxUploadSize = 10 << 20 // 10 MB

var allowedMIME = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"application/pdf": ".pdf",
}

type UploadHandler struct {
	storage storage.Service
}

func NewUploadHandler(s storage.Service) *UploadHandler {
	return &UploadHandler{storage: s}
}

// PublicUpload handles file uploads that require no authentication (e.g. tenant registration).
func (h *UploadHandler) PublicUpload(c echo.Context) error {
	return h.handle(c, "public")
}

// TenantUpload handles file uploads authenticated by tenant JWT (e.g. payment proofs).
func (h *UploadHandler) TenantUpload(c echo.Context) error {
	return h.handle(c, "tenant")
}

func (h *UploadHandler) handle(c echo.Context, prefix string) error {
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxUploadSize)

	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("file is required"))
	}
	if file.Size > maxUploadSize {
		return c.JSON(http.StatusBadRequest, errorResponse("file too large (max 10 MB)"))
	}

	// Validate MIME type
	ct := file.Header.Get("Content-Type")
	// Strip parameters (e.g. "image/jpeg; charset=utf-8")
	ct = strings.Split(ct, ";")[0]
	ct = strings.TrimSpace(ct)
	ext, ok := allowedMIME[ct]
	if !ok {
		return c.JSON(http.StatusBadRequest, errorResponse("unsupported file type (jpeg, png, webp, pdf allowed)"))
	}

	src, err := file.Open()
	if err != nil {
		return serverError(c, err, "failed to read file")
	}
	defer src.Close()

	key := fmt.Sprintf("%s/%s%s", prefix, randomHex(16), ext)
	url, err := h.storage.Upload(context.Background(), key, ct, src)
	if err != nil {
		return serverError(c, err, "failed to store file")
	}

	return c.JSON(http.StatusOK, map[string]string{"url": url})
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ValidateUploadedURL checks that a URL ends with a known image/pdf extension.
// Used to sanity-check client-supplied URLs before saving to DB.
func ValidateUploadedURL(url string) bool {
	if url == "" {
		return true // optional field
	}
	ext := strings.ToLower(filepath.Ext(url))
	for _, allowed := range allowedMIME {
		if ext == allowed {
			return true
		}
	}
	return false
}
