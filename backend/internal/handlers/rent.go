package handlers

import (
	"sort"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

// A stay's rent can change partway through (migration 011). Before that, every
// figure in the app was `rent × cycles`, so raising a long tenant's rent from
// next month repriced every month they had already lived there — and turned
// months they had paid in full into arrears.
//
// rentSchedule is the rent over time. Each step applies to every billing cycle
// that BEGINS on or after its date, so a change dated mid-cycle takes effect
// from the next due date, never splitting a cycle. A stay that has never
// changed rent has one step, from its start date, and bills exactly as before.
type rentStep struct {
	From time.Time
	Rent int64 // paise per cycle
}

type rentSchedule []rentStep

// flatSchedule is the schedule of a stay whose rent has never changed.
func flatSchedule(start time.Time, rent int64) rentSchedule {
	return rentSchedule{{From: dateOnly(start), Rent: rent}}
}

// at returns the rent for a cycle beginning on d: the latest step dated on or
// before it. A date before the first step gets the first step's rent, so a
// schedule can never bill a cycle at zero.
func (s rentSchedule) at(d time.Time) int64 {
	if len(s) == 0 {
		return 0
	}
	d = dateOnly(d)
	rent := s[0].Rent
	for _, step := range s {
		if step.From.After(d) {
			break
		}
		rent = step.Rent
	}
	return rent
}

// billed is the rent due for cycles from+1 through to of a stay — the first
// `to` cycles when from is 0. With one step it is the old multiplication, so
// a stay with no rent changes cannot come out different by a paisa.
func (s rentSchedule) billed(start time.Time, cycle string, from, to int) int64 {
	if to <= from {
		return 0
	}
	if len(s) == 1 {
		return s[0].Rent * int64(to-from)
	}
	if len(s) == 0 {
		return 0
	}
	var total int64
	for n := from + 1; n <= to; n++ {
		total += s.at(cycleStart(dateOnly(start), n, cycle))
	}
	return total
}

// paidThrough is how many whole cycles `paid` covers, in order from the first —
// the cycle a part-payment falls short in is the first unpaid one. Collections
// uses it to say how long someone has been overdue.
func (s rentSchedule) paidThrough(start time.Time, cycle string, paid int64, maxCycles int) int {
	n := 0
	for n < maxCycles {
		rent := s.at(cycleStart(dateOnly(start), n+1, cycle))
		if rent <= 0 || paid < rent {
			break
		}
		paid -= rent
		n++
	}
	return n
}

// rentSchedules loads the schedule of every stay in ids that has ever had its
// rent changed. A stay missing from the result has a flat schedule; callers
// get it through scheduleFor, which falls back to the stay's own rent.
func rentSchedules(db *sqlx.DB, ids []int64) (map[int64]rentSchedule, error) {
	out := map[int64]rentSchedule{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []struct {
		StayID int64     `db:"stay_id"`
		From   time.Time `db:"effective_date"`
		Rent   int64     `db:"rent_amount"`
	}
	if err := db.Select(&rows,
		`SELECT stay_id, effective_date, rent_amount FROM stay_rent_changes
		 WHERE stay_id = ANY($1) ORDER BY stay_id, effective_date`,
		pq.Array(ids),
	); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.StayID] = append(out[r.StayID], rentStep{From: dateOnly(r.From), Rent: r.Rent})
	}
	for id := range out {
		sort.Slice(out[id], func(i, j int) bool { return out[id][i].From.Before(out[id][j].From) })
	}
	return out, nil
}

// scheduleFor returns the loaded schedule for a stay, or the flat one.
func scheduleFor(m map[int64]rentSchedule, stayID int64, start time.Time, rent int64) rentSchedule {
	if s, ok := m[stayID]; ok && len(s) > 0 {
		return s
	}
	return flatSchedule(start, rent)
}
