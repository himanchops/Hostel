package handlers

import (
	"testing"
	"time"
)

// The owner's three ways to settle a move into a pricier room (26 Oct 2026).
// Moved in 17 Sep at ₹4,500; on 18 Oct, one day into the second month, moves
// to a ₹5,000 room. Nothing paid but September's ₹4,500 on move-in.
var (
	planStart = date(2026, time.September, 17)
	planRef   = date(2026, time.October, 18)
	planToday = date(2026, time.October, 26)
	flat4500  = flatSchedule(planStart, 450000)
)

func steps(s rentSchedule) [][2]any {
	out := make([][2]any, len(s))
	for i, st := range s {
		out[i] = [2]any{st.From.Format("2006-01-02"), st.Rent}
	}
	return out
}

func sameSteps(t *testing.T, got rentSchedule, want [][2]any) {
	t.Helper()
	g := steps(got)
	if len(g) != len(want) {
		t.Fatalf("steps = %v, want %v", g, want)
	}
	for i := range want {
		if g[i] != want[i] {
			t.Fatalf("steps = %v, want %v", g, want)
		}
	}
}

// "The old rent this month": October stays ₹4,500; ₹5,000 from 17 Nov.
func TestPlanRent_OldThisMonth(t *testing.T) {
	got := planRent(flat4500, planStart, "monthly", planRef, rentPlanRequest{NextRent: 500000, ThisCycle: "old"})
	sameSteps(t, got, [][2]any{{"2026-09-17", int64(450000)}, {"2026-11-17", int64(500000)}})
	p := previewRent(got, planStart, "monthly", planRef, planToday, 450000)
	if p.ThisRent != 450000 || p.NextRent != 500000 || p.PaidThis != 0 || p.Balance != 450000 {
		t.Errorf("preview = %+v, want this ₹4,500, next ₹5,000, ₹0 paid of it, ₹4,500 owed", p)
	}
}

// "The new rent this month": October is ₹5,000, and stays so. One step, not
// two: the step at 17 Nov repeats it and is merged away.
func TestPlanRent_NewThisMonth(t *testing.T) {
	got := planRent(flat4500, planStart, "monthly", planRef, rentPlanRequest{NextRent: 500000, ThisCycle: "new"})
	sameSteps(t, got, [][2]any{{"2026-09-17", int64(450000)}, {"2026-10-17", int64(500000)}})
	p := previewRent(got, planStart, "monthly", planRef, planToday, 950000)
	if p.ThisStart != "2026-10-17" || p.ThisEnd != "2026-11-16" || p.NextStart != "2026-11-17" {
		t.Errorf("dates = %s – %s, next %s", p.ThisStart, p.ThisEnd, p.NextStart)
	}
	// Paid ₹9,500: September's ₹4,500 and October's ₹5,000. Square.
	if p.ThisRent != 500000 || p.PaidThis != 500000 || p.Balance != 0 {
		t.Errorf("preview = %+v, want ₹5,000 this month, all paid, square", p)
	}
}

// "An amount you agreed": ₹4,800 for October, ₹5,000 from 17 Nov. With
// September's ₹4,500 paid, ₹4,800 is owed now.
func TestPlanRent_AgreedThisMonth(t *testing.T) {
	got := planRent(flat4500, planStart, "monthly", planRef, rentPlanRequest{NextRent: 500000, ThisCycle: "agreed", Agreed: 480000})
	sameSteps(t, got, [][2]any{
		{"2026-09-17", int64(450000)}, {"2026-10-17", int64(480000)}, {"2026-11-17", int64(500000)},
	})
	p := previewRent(got, planStart, "monthly", planRef, planToday, 450000)
	if p.ThisRent != 480000 || p.Balance != 480000 {
		t.Errorf("preview = %+v, want ₹4,800 this month and ₹4,800 owed", p)
	}
	// Paid ₹4,800 more: ₹300 of it is the difference, and they're square.
	if q := previewRent(got, planStart, "monthly", planRef, planToday, 930000); q.PaidThis != 480000 || q.Balance != 0 {
		t.Errorf("after paying = %+v, want all of October paid and square", q)
	}
}

// A move in the first month reprices from move-in: there is no earlier step.
func TestPlanRent_FirstMonthNew(t *testing.T) {
	got := planRent(flat4500, planStart, "monthly", date(2026, time.September, 18), rentPlanRequest{NextRent: 500000, ThisCycle: "new"})
	sameSteps(t, got, [][2]any{{"2026-09-17", int64(500000)}})
}

// Changing back to what they paid all along leaves a flat rent, no steps.
func TestPlanRent_SameRentIsNoChange(t *testing.T) {
	got := planRent(flat4500, planStart, "monthly", planRef, rentPlanRequest{NextRent: 450000, ThisCycle: "old"})
	sameSteps(t, got, [][2]any{{"2026-09-17", int64(450000)}})
}

// A rise already scheduled for December is replaced: "from next month, rent is
// X" is the owner's word on the rent from then on. Earlier steps stay.
func TestPlanRent_LaterStepsAreReplaced(t *testing.T) {
	old := rentSchedule{
		{From: planStart, Rent: 450000},
		{From: date(2026, time.December, 17), Rent: 520000},
	}
	got := planRent(old, planStart, "monthly", planRef, rentPlanRequest{NextRent: 500000, ThisCycle: "old"})
	sameSteps(t, got, [][2]any{{"2026-09-17", int64(450000)}, {"2026-11-17", int64(500000)}})
}

// A discount agreed up front (owner, 24 Oct): ₹8,000 this month, ₹9,000 after.
func TestPlanRent_DiscountThisMonth(t *testing.T) {
	start := date(2026, time.October, 1)
	got := planRent(flatSchedule(start, 900000), start, "monthly", date(2026, time.October, 3),
		rentPlanRequest{NextRent: 900000, ThisCycle: "agreed", Agreed: 800000})
	sameSteps(t, got, [][2]any{{"2026-10-01", int64(800000)}, {"2026-11-01", int64(900000)}})
}

func TestRentPlanRequest_Validate(t *testing.T) {
	cases := map[string]rentPlanRequest{
		"Enter the new rent.":                         {ThisCycle: "old"},
		"Pick what they pay this month.":              {NextRent: 1, ThisCycle: "later"},
		"Enter the amount you agreed for this month.": {NextRent: 1, ThisCycle: "agreed"},
		"": {NextRent: 1, ThisCycle: "new"},
	}
	for want, req := range cases {
		if got := req.validate(); got != want {
			t.Errorf("%+v: %q, want %q", req, got, want)
		}
	}
}
