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
// cyclesThroughEnd is how many rent cycles a stay that ended on end is billed:
// every cycle that began before the day they left. A cycle beginning on the
// leaving day itself is not billed — their last paid month covers them up to
// that day — so someone whose rent falls on the 23rd and who leaves on the
// 23rd owes nothing for the month starting then. The owner's rule, Oct 2026;
// it used to bill that month in full. A stay is always billed its first cycle.
//
// Everything that bills an ENDED stay goes through this: the settlement, the
// tenant summary and Insights, so the three cannot disagree about a leaver.
func cyclesThroughEnd(startDate, end time.Time, cycle string) int {
	n := cyclesElapsed(dateOnly(startDate), dateOnly(end).AddDate(0, 0, -1), cycle)
	if n < 1 {
		return 1
	}
	return n
}

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
