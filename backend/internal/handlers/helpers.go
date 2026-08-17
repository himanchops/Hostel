package handlers

import "time"

// daysInMonth returns the number of days in the given year/month.
func daysInMonth(year int, month time.Month) int {
	// Day 0 of the next month is the last day of this one.
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// cyclesElapsed returns the number of billing cycles due from startDate to today.
//
// Billing is anchored to the stay's start date, not a calendar boundary: a
// tenant who moves in on the 20th rolls over on the 20th of each month. Rent is
// due at the start of a cycle, so the move-in day itself counts as cycle 1.
//
// For month-end move-ins the anchor day is clamped to the last day of the month
// being measured. Without that, a stay starting on the 31st would never roll
// over in a short month — February has no 31st — and the tenant would not be
// billed for it.
func cyclesElapsed(startDate, today time.Time, cycle string) int {
	if today.Before(startDate) {
		return 0
	}
	switch cycle {
	case "monthly":
		years := today.Year() - startDate.Year()
		months := int(today.Month()) - int(startDate.Month()) + years*12

		anchorDay := startDate.Day()
		if last := daysInMonth(today.Year(), today.Month()); anchorDay > last {
			anchorDay = last
		}
		if today.Day() >= anchorDay {
			months++
		}
		if months < 1 {
			return 1
		}
		return months
	case "weekly":
		days := int(today.Sub(startDate).Hours() / 24)
		return days/7 + 1
	case "daily":
		return int(today.Sub(startDate).Hours()/24) + 1
	}
	return 1
}
