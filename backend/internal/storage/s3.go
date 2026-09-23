package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

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
//
// The bucket should be private — no r2.dev subdomain, no custom domain. Reads
// go through presigned GET links minted by SignedURL, which R2 serves from
// the S3 endpoint with the signature as the only credential.
type S3Storage struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

// S3Config holds the parameters for connecting to an S3-compatible backend.
type S3Config struct {
	Endpoint  string // e.g. https://<account-id>.r2.cloudflarestorage.com
	Region    string // e.g. "auto" for R2, "us-east-1" for AWS
	Bucket    string
	AccessKey string
	SecretKey string
}

// NewS3Storage builds an S3Storage from the given config.
func NewS3Storage(ctx context.Context, cfg S3Config) (*S3Storage, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("s3 storage: bucket is required")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, errors.New("s3 storage: access key and secret key are required")
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
		client:  client,
		presign: s3.NewPresignClient(client),
		bucket:  cfg.Bucket,
	}, nil
}

// Upload implements Service.
func (s *S3Storage) Upload(ctx context.Context, key, contentType string, r io.Reader) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        r,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("s3 upload %q: %w", key, err)
	}
	return nil
}

// SignedURL implements Service. Presigning is local arithmetic over the
// secret key — no request leaves the process — so minting a link per file on
// every tenant list is cheap.
func (s *S3Storage) SignedURL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("s3 presign %q: %w", key, err)
	}
	return req.URL, nil
}
