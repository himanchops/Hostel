package middleware

import (
	"net"
	"net/url"
	"strings"
)

// ParseOrigins splits a comma-separated origin list (the FRONTEND_URL env var)
// into individual origins, trimming whitespace and any trailing slash. Browsers
// send the Origin header without a trailing slash, so an entry like
// "https://app.example.com/" would otherwise never match.
func ParseOrigins(csv string) []string {
	parts := strings.Split(csv, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.TrimSuffix(p, "/")
		if p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}

// DevOriginAllowed reports whether an origin should be accepted in local
// development. It permits localhost, loopback addresses, and private-range LAN
// addresses on any port, so the app can be opened from a phone on the same
// Wi-Fi network (http://192.168.x.x:3000) without extra configuration.
//
// This is only wired up when FRONTEND_URL is unset. In production the allow
// list is explicit and this function is not used.
//
// The signature matches Echo's CORSConfig.AllowOriginFunc. The error return is
// always nil: an unparseable or non-matching origin is a plain "not allowed",
// not a server error.
func DevOriginAllowed(origin string) (bool, error) {
	u, err := url.Parse(origin)
	if err != nil {
		return false, nil
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false, nil
	}

	host := u.Hostname()
	if host == "localhost" {
		return true, nil
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false, nil
	}
	return ip.IsLoopback() || ip.IsPrivate(), nil
}
