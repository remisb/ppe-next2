// Package files keeps uploaded files (ADR 0001's Files platform, first used by
// Company Assets' signed copies, ADR 0004): a Store, either an S3-compatible
// bucket (DigitalOcean Spaces in production) or a folder for development and
// tests, and the checks every upload passes: a known type, read from the
// file's own bytes, and no photo metadata.
package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ErrNotFound is a key the store does not have.
var ErrNotFound = errors.New("files: not found")

// Store keeps files by key. Keys are made by the application, never by a user.
type Store interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	// String names where files go, for logs; never the keys.
	String() string
}

// Open returns the store a target names: "s3://bucket/prefix?endpoint=host&region=r"
// with its access key and secret, or a folder, "file:///absolute/folder" or
// "file:relative/folder" (from the working directory). An empty target is no
// store (nil): uploads are then refused.
func Open(target, accessKey, secretKey string) (Store, error) {
	return open(target, accessKey, secretKey, true)
}

// Check reports what Open would refuse, without creating a folder or
// contacting a bucket: for checking settings at start-up.
func Check(target, accessKey, secretKey string) error {
	_, err := open(target, accessKey, secretKey, false)
	return err
}

func open(target, accessKey, secretKey string, create bool) (Store, error) {
	if target == "" {
		return nil, nil
	}
	u, err := url.Parse(target)
	if err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}
	switch u.Scheme {
	case "s3":
		return openS3(u, accessKey, secretKey)
	case "file":
		folder := u.Path
		if u.Opaque != "" {
			if folder, err = filepath.Abs(u.Opaque); err != nil {
				return nil, fmt.Errorf("files: %w", err)
			}
		} else if u.Host != "" || !filepath.IsAbs(u.Path) {
			return nil, fmt.Errorf("files: want file:///absolute/folder or file:relative/folder, got %q", target)
		}
		if !create {
			return &Dir{root: folder}, nil
		}
		return NewDir(folder)
	}
	return nil, fmt.Errorf("files: want s3://bucket?endpoint=host or file:///folder, got %q", target)
}

// S3 is a private bucket: DigitalOcean Spaces, AWS S3, MinIO.
type S3 struct {
	client         *minio.Client
	bucket, prefix string
	endpoint       string
}

func openS3(u *url.URL, accessKey, secretKey string) (*S3, error) {
	if u.Host == "" || u.User != nil {
		return nil, errors.New("files: want s3://bucket/prefix?endpoint=host, with the keys in their own settings")
	}
	q := u.Query()
	endpoint := q.Get("endpoint")
	if endpoint == "" {
		return nil, errors.New("files: an s3:// target needs ?endpoint=<host>")
	}
	if accessKey == "" || secretKey == "" {
		return nil, errors.New("files: an s3:// target needs its access key and secret")
	}
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: q.Get("insecure") != "true",
		Region: q.Get("region"),
	})
	if err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}
	return &S3{client: client, bucket: u.Host, prefix: strings.Trim(u.Path, "/"), endpoint: endpoint}, nil
}

func (s *S3) key(k string) string {
	if s.prefix == "" {
		return k
	}
	return s.prefix + "/" + k
}

func (s *S3) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, s.key(key), body, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, s.key(key), minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	// GetObject is lazy: Stat reports a missing key now, not on the first Read.
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if minio.ToErrorResponse(err).Code == minio.NoSuchKey {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, key)
		}
		return nil, err
	}
	return obj, nil
}

func (s *S3) String() string { return fmt.Sprintf("s3://%s (%s)", s.bucket, s.endpoint) }

// Dir is a folder on this machine: development and tests only, as files on
// the droplet's disk would be lost with it (ADR 0001).
type Dir struct{ root string }

func NewDir(root string) (*Dir, error) {
	if err := os.MkdirAll(root, 0o750); err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}
	return &Dir{root: root}, nil
}

func (d *Dir) path(key string) (string, error) {
	p := filepath.Join(d.root, filepath.FromSlash(key))
	if !strings.HasPrefix(p, filepath.Clean(d.root)+string(filepath.Separator)) {
		return "", fmt.Errorf("files: key %q leaves the folder", key)
	}
	return p, nil
}

func (d *Dir) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	// Written aside, then renamed: a failed upload leaves nothing under the key.
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return err
	}
	if _, err := io.Copy(tmp, body); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (d *Dir) Get(_ context.Context, key string) (io.ReadCloser, error) {
	p, err := d.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, key)
	}
	return f, err
}

func (d *Dir) String() string { return "file://" + d.root }
