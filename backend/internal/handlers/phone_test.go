package handlers

import "testing"

func TestNormalizePhone(t *testing.T) {
	ok := map[string]string{
		"9845012345":        "9845012345",
		"98450 12345":       "9845012345",
		"+91 98450 12345":   "9845012345",
		"+919845012345":     "9845012345",
		"919845012345":      "9845012345",
		"09845012345":       "9845012345",
		"(+91) 98450-12345": "9845012345",
		"  6000000000 ":     "6000000000",
		// Ten digits that happen to start 91 are a number, not a prefix.
		"9100000000": "9100000000",
	}
	for in, want := range ok {
		got, valid := normalizePhone(in)
		if !valid || got != want {
			t.Errorf("normalizePhone(%q) = %q, %v; want %q", in, got, valid, want)
		}
	}

	bad := []string{
		"",
		"98450",            // too short
		"98450123456",      // eleven digits, no leading 0
		"9198450123456",    // thirteen
		"5845012345",       // no Indian mobile starts with 5
		"0000000000",       // nor 0
		"98450l2345",       // a letter l for a 1
		"9845012345 ext 2", // words
		"98+45012345",      // a + anywhere but the front
		"+1 415 555 0100",  // not Indian
		"91 5845012345",    // prefix stripped, then a bad first digit
	}
	for _, in := range bad {
		if got, valid := normalizePhone(in); valid {
			t.Errorf("normalizePhone(%q) = %q, accepted; want refused", in, got)
		}
	}
}
