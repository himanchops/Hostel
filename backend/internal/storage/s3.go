package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Storage stores files in any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, etc.).
//
// For Cloudflare R2:
//   - Endpoint: https://<account-id>.r2.cloudflarestorage.com
//   - Region:   auto
//   - PublicURL: the public R2 dev URL (https://pub-<hash>.r2.dev) or your custom domain.
//     The bucket must be configured to expose objects publicly via that URL.
type S3Storage struct {
	client    *s3.Client
	bucket    string
	publicURL string // base URL where objects are publicly served; no trailing slash
}

// S3Config holds the parameters for connecting to an S3-compatible backend.
type S3Config struct {
	Endpoint  string // e.g. https://<account-id>.r2.cloudflarestorage.com
	Region    string // e.g. "auto" for R2, "us-east-1" for AWS
	Bucket    string
	AccessKey string
	SecretKey string
	PublicURL string // public base URL for built object URLs, e.g. https://pub-xxx.r2.dev
}

// NewS3Storage builds an S3Storage from the given config.
func NewS3Storage(ctx context.Context, cfg S3Config) (*S3Storage, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("s3 storage: bucket is required")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, errors.New("s3 storage: access key and secret key are required")
	}
	if cfg.PublicURL == "" {
		return nil, errors.New("s3 storage: public URL is required")
	}
	region := cfg.Region
	if region == "" {
		region = "auto"
	}

	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKey, cfg.SecretKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("s3 storage: load config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		// Path-style addressing is the most portable across S3-compatible services
		// (MinIO requires it; R2 and AWS both support it).
		o.UsePathStyle = true
	})

	return &S3Storage{
		client:    client,
		bucket:    cfg.Bucket,
		publicURL: strings.TrimRight(cfg.PublicURL, "/"),
	}, nil
}

// Upload implements Service.
func (s *S3Storage) Upload(ctx context.Context, key, contentType string, r io.Reader) (string, error) {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        r,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", fmt.Errorf("s3 upload %q: %w", key, err)
	}
	return s.publicURL + "/" + strings.TrimLeft(key, "/"), nil
}
