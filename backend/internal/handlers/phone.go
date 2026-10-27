package handlers

import "strings"

// Phone numbers are Indian mobiles, checked strictly (Oct 2026). Before this
// every form took whatever was typed and saved it as typed, so the same person
// could be "+91 98450 12345" on their record and "9845012345" at the sign-in
// box, and the portal turned them away for a password that was right.
//
// normalizePhone accepts the ways a human writes a mobile number — spaces,
// dashes, brackets, a +91, 91 or 0 in front — and returns the ten digits that
// get stored. Anything else is refused rather than guessed at: letters, too
// few or too many digits, or a first digit no Indian mobile starts with.
//
// Numbers already on file in another shape are left as they are; they meet
// this rule only when someone edits that record. Sign-in matches on the last
// ten digits (phoneDigitsSQL), so those still work in the meantime.
func normalizePhone(s string) (string, bool) {
	var digits strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r >= '0' && r <= '9':
			digits.WriteRune(r)
		case r == '+' && digits.Len() == 0:
		case r == ' ' || r == '-' || r == '(' || r == ')':
		default:
			return "", false
		}
	}
	d := digits.String()
	switch {
	case len(d) == 12 && strings.HasPrefix(d, "91"):
		d = d[2:]
	case len(d) == 11 && strings.HasPrefix(d, "0"):
		d = d[1:]
	}
	if len(d) != 10 || d[0] < '6' {
		return "", false
	}
	return d, true
}

// The last ten digits of a stored phone, in SQL, to compare with a
// normalizePhone result. It matches numbers saved before the rule above as
// well as after.
const phoneDigitsSQL = `right(regexp_replace(phone, '\D', '', 'g'), 10)`

// The rule, said out loud. "Enter a 10-digit mobile number" was the reply to
// 1234567899, which has ten digits; what it lacked was a first digit an Indian
// mobile starts with (owner, Oct 2026). lib/phone.ts says the same.
const (
	errPhone          = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."
	errEmergencyPhone = "Enter the emergency contact's 10-digit mobile number, starting with 6, 7, 8 or 9."
)
