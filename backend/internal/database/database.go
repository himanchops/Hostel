package database

import (
	"fmt"
	"log"
	"net/url"
	"strings"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
	SSLMode  string
}

func Connect(cfg Config) (*sqlx.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode,
	)
	return connectDSN(dsn)
}

// ConnectURL opens a connection using a libpq-style URL such as
// "postgres://user:pass@host:5432/db?sslmode=require". This is the form Neon,
// Render, Supabase, and Fly all hand out via a DATABASE_URL env var.
func ConnectURL(dsn string) (*sqlx.DB, error) {
	if IsPooledEndpoint(dsn) {
		// Loud on purpose, and worth the noise. This exact configuration was
		// live for two weeks and produced intermittent 500s across
		// /api/collections, /api/tenants and anything else that happened to be
		// in flight at the same moment — reported by Sentry as three unrelated
		// pq errors, two of which were each other backwards.
		//
		// Neon's pooled endpoint is PgBouncer in transaction mode. lib/pq uses
		// the extended query protocol with unnamed prepared statements, which
		// are per-session, so the pooler can route a Bind to a different server
		// connection than the Parse that set it up. Two concurrent requests
		// then execute each other's statements.
		//
		// Not fatal: a future driver (pgx with simple_protocol) makes this
		// combination safe, and refusing to boot would be the wrong call on a
		// live service. But it must never again be silent.
		log.Print("DATABASE WARNING: connected via a POOLED endpoint (-pooler) with lib/pq — " +
			"prepared statements can cross connections and cause intermittent " +
			"\"unnamed prepared statement does not exist\" errors. Use the direct " +
			"endpoint. See docs/BACKLOG.md → \"Found by Sentry\".")
	}
	return connectDSN(dsn)
}

// IsPooledEndpoint reports whether a DSN points at a Neon-style pooled
// endpoint, identified by a "-pooler" suffix on the host label.
//
// It never logs, returns or otherwise handles the DSN itself — the string
// carries the database password, and the whole point of the caller is to write
// something to stdout, where Render keeps it. Only the boolean leaves here.
func IsPooledEndpoint(dsn string) bool {
	host := dsn
	if u, err := url.Parse(dsn); err == nil && u.Host != "" {
		host = u.Hostname()
	} else {
		// key=value form ("host=... user=..."), used by the local DB_* path.
		for _, field := range strings.Fields(dsn) {
			if after, found := strings.CutPrefix(field, "host="); found {
				host = after
				break
			}
		}
	}
	// Match the label, not a bare substring: a database legitimately named
	// "pooler-test" should not trip this.
	label, _, _ := strings.Cut(host, ".")
	return strings.HasSuffix(label, "-pooler")
}

func connectDSN(dsn string) (*sqlx.DB, error) {
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}
