package handlers

import "time"

// cyclesElapsed returns the number of billing cycles due from startDate to today.
func cyclesElapsed(startDate, today time.Time, cycle string) int {
	if today.Before(startDate) {
		return 0
	}
	switch cycle {
	case "monthly":
		years := today.Year() - startDate.Year()
		months := int(today.Month())-int(startDate.Month()) + years*12
		if today.Day() >= startDate.Day() {
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
