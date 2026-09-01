package database

import "testing"

// The bug this guards against was live for two weeks and surfaced as three
// unrelated-looking pq errors across different endpoints. The detection has to
// be right about which hosts are pooled, and — more importantly — must not cry
// wolf, because a warning that fires on a correct configuration gets ignored
// and then the real one gets ignored too.
func TestIsPooledEndpoint(t *testing.T) {
	cases := []struct {
		name string
		dsn  string
		want bool
	}{
		{
			name: "neon pooled endpoint, the configuration that broke production",
			dsn:  "postgres://u:p@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/hostel?sslmode=require",
			want: true,
		},
		{
			name: "neon direct endpoint, the fix",
			dsn:  "postgres://u:p@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/hostel?sslmode=require",
			want: false,
		},
		{
			name: "postgresql:// scheme is equally valid",
			dsn:  "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db",
			want: true,
		},
		{
			name: "local development",
			dsn:  "postgres://hostel:hostel_dev@localhost:5432/hostel?sslmode=disable",
			want: false,
		},
		{
			name: "key=value form, as the DB_* local path builds it",
			dsn:  "host=ep-x-pooler.aws.neon.tech port=5432 user=hostel dbname=hostel sslmode=require",
			want: true,
		},
		{
			name: "key=value form, direct",
			dsn:  "host=localhost port=5432 user=hostel dbname=hostel sslmode=disable",
			want: false,
		},
		// Cry-wolf cases. Each of these would fire under a naive
		// strings.Contains(dsn, "pooler") check.
		{
			name: "a database named pooler is not a pooled host",
			dsn:  "postgres://u:p@db.example.com/pooler?sslmode=require",
			want: false,
		},
		{
			name: "a host merely containing the word is not a pooled endpoint",
			dsn:  "postgres://u:p@pooler-test.example.com/db",
			want: false,
		},
		{
			name: "a username containing it does not count either",
			dsn:  "postgres://pooler:p@db.example.com/hostel",
			want: false,
		},
		{
			name: "empty dsn",
			dsn:  "",
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsPooledEndpoint(tc.dsn); got != tc.want {
				t.Errorf("IsPooledEndpoint(%q) = %v, want %v", tc.dsn, got, tc.want)
			}
		})
	}
}
