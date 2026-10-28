package handlers

// houseRulesVersion is the version of the house rules the registration form
// shows today. The text itself lives in frontend/src/lib/houseRules.ts, which
// keeps every version ever agreed to; this side only has to know which one
// is current, so a form that was open while the rules changed is sent back to
// read the new ones rather than recording agreement to text nobody is shown
// any more.
//
// Change them together: a new entry in houseRules.ts, then this label, and
// the label scripts/seed-demo.py sends.
// tests/e2e/public/house-rules.test.ts registers through the real form, so
// it fails if they disagree.
const houseRulesVersion = "2026-10-28"

const errRulesChanged = "The house rules have changed since you opened this page. Reload it and read them again."

// rulesAgreed says whether a registration agreed to the current rules.
func rulesAgreed(version string) bool {
	return version == houseRulesVersion
}
