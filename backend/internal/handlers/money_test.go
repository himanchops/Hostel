package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Three leavers in one October, each a different shape of settlement:
//
//	short:   deposit ₹2,000 held, ₹4,500 rent owed. The deposit pays ₹2,000 of
//	         it and they leave owing ₹2,500. Nothing is handed back.
//	charged: deposit ₹2,000 held, rent square, ₹500 kept for a broken chair.
//	         ₹1,500 handed back. None of the deposit went on rent.
//	ahead:   deposit ₹2,000 held, ₹5,500 rent paid ahead and all of it
//	         returned. ₹7,500 handed back, and ₹5,500 comes off rent collected.
var (
	flowShort   = settlementFlow{Month: "2026-10", RoomID: 1, DepositPaise: 200000, DuesPaise: 450000, RefundPaise: -250000}
	flowCharged = settlementFlow{Month: "2026-10", RoomID: 2, DepositPaise: 200000, DuesPaise: 0, RefundPaise: 150000}
	flowAhead   = settlementFlow{Month: "2026-10", RoomID: 1, DepositPaise: 200000, DuesPaise: -550000, AdvanceReturned: 550000, RefundPaise: 750000}
)

func TestSettlementRent(t *testing.T) {
	cases := []struct {
		name               string
		deposit, dues, out int64
	}{
		{"deposit covers all the rent owed", 200000, 150000, 150000},
		{"rent owed is more than the deposit", 200000, 450000, 200000},
		{"exactly the deposit", 200000, 200000, 200000},
		{"nothing owed", 200000, 0, 0},
		{"paid ahead", 200000, -550000, 0},
		{"no deposit was ever paid", 0, 450000, 0},
	}
	for _, c := range cases {
		if got := settlementRent(c.deposit, c.dues); got != c.out {
			t.Errorf("%s: settlementRent(%d, %d) = %d, want %d", c.name, c.deposit, c.dues, got, c.out)
		}
	}
}

func TestMoneyMonth_RentAndMoneyAreDifferentQuestions(t *testing.T) {
	out := map[string]moneyMonth{
		"2026-10": {RentPaid: 7050000, DepositsIn: 400000}, // ₹70,500 rent, ₹4,000 deposits
	}
	addSettlementFlows(out, []settlementFlow{flowShort, flowCharged, flowAhead})
	oct := out["2026-10"]

	if oct.Returned != 900000 {
		t.Errorf("returned = %d, want 900000 (₹1,500 + ₹7,500; the short leaver got nothing)", oct.Returned)
	}
	// Of the ₹9,000 handed back, ₹5,500 was the ahead leaver's rent: only
	// ₹3,500 of it was deposit (₹1,500 + ₹2,000).
	if oct.DepositReturned != 350000 {
		t.Errorf("deposit returned = %d, want 350000", oct.DepositReturned)
	}
	if oct.DepositToRent != 200000 {
		t.Errorf("deposit to rent = %d, want 200000 (only the short leaver's deposit went on rent)", oct.DepositToRent)
	}
	if oct.AdvanceReturned != 550000 {
		t.Errorf("advance returned = %d, want 550000", oct.AdvanceReturned)
	}
	// Rent: ₹70,500 paid + ₹2,000 from a deposit − ₹5,500 given back = ₹67,000.
	if got := oct.rentCollected(); got != 6700000 {
		t.Errorf("rent collected = %d, want 6700000", got)
	}
	// Money: ₹70,500 + ₹4,000 in − ₹9,000 out = ₹65,500. The deposit applied
	// to rent moved no money, so it is not in here.
	if got := oct.netIn(); got != 6550000 {
		t.Errorf("net in = %d, want 6550000", got)
	}
}

func TestMoneyMonth_LeaversWithNoArrivalsGoNegative(t *testing.T) {
	out := map[string]moneyMonth{}
	addSettlementFlows(out, []settlementFlow{flowCharged})
	if got := out["2026-10"].netIn(); got != -150000 {
		t.Errorf("net in = %d, want -150000: a refund with nothing coming in is money out", got)
	}
}

// The lines a month lists must add up to its row, under both views.
func TestSettlementEntries_AddUpToTheMonth(t *testing.T) {
	left := date(2026, time.October, 12)
	row := func(f settlementFlow) moneyEntryRow {
		return moneyEntryRow{Date: left, TenantName: "Leaver", DepositPaise: f.DepositPaise,
			DuesPaise: f.DuesPaise, AdvanceReturned: f.AdvanceReturned, RefundPaise: f.RefundPaise}
	}

	var lines []MoneyEntry
	for _, f := range []settlementFlow{flowShort, flowCharged, flowAhead} {
		lines = append(lines, settlementEntries(row(f))...)
	}
	sum := map[string]int64{}
	for _, l := range lines {
		if l.AmountPaise <= 0 {
			t.Errorf("%s line has amount %d: amounts are positive, the kind says the direction", l.Kind, l.AmountPaise)
		}
		if l.Date != "2026-10-12" {
			t.Errorf("%s line dated %s, want the day they left", l.Kind, l.Date)
		}
		sum[l.Kind] += l.AmountPaise
	}

	m := map[string]moneyMonth{}
	addSettlementFlows(m, []settlementFlow{flowShort, flowCharged, flowAhead})
	oct := m["2026-10"]
	if sum["returned"] != oct.Returned || sum["deposit_to_rent"] != oct.DepositToRent ||
		sum["advance_returned"] != oct.AdvanceReturned {
		t.Errorf("lines %v do not add up to the month %+v", sum, oct)
	}
	if len(lines) != 4 {
		t.Errorf("got %d lines, want 4: short → deposit_to_rent; charged → returned; ahead → advance_returned + returned", len(lines))
	}
}

func TestSettlementEntries_NothingMovedMeansNoLines(t *testing.T) {
	// Paid nothing, owed nothing, held nothing: a one-day stay settled square.
	got := settlementEntries(moneyEntryRow{Date: date(2026, time.October, 2)})
	if len(got) != 0 {
		t.Errorf("got %d lines, want none", len(got))
	}
}

func TestRevenueSeries_CarriesBothQuestions(t *testing.T) {
	today := date(2026, time.October, 21)
	money := map[string]moneyMonth{"2026-10": {RentPaid: 7050000, DepositsIn: 400000}}
	addSettlementFlows(money, []settlementFlow{flowShort, flowCharged, flowAhead})

	points := computeRevenueSeries(nil, money, today, 2)
	sep, oct := points[0], points[1]
	if sep.CollectedPaise != 0 || sep.NetInPaise != 0 {
		t.Errorf("September = %+v, want zeros: a month with no money is not missing, it is zero", sep)
	}
	if oct.CollectedPaise != 6700000 || oct.NetInPaise != 6550000 {
		t.Errorf("October collected/net = %d/%d, want 6700000/6550000", oct.CollectedPaise, oct.NetInPaise)
	}

	// The parts travel with the totals, flat, so the table can show them.
	raw, _ := json.Marshal(oct)
	for _, field := range []string{`"deposits_in_paise":400000`, `"returned_paise":900000`,
		`"rent_paid_paise":7050000`, `"deposit_to_rent_paise":200000`, `"net_in_paise":6550000`} {
		if !strings.Contains(string(raw), field) {
			t.Errorf("JSON %s is missing %s", raw, field)
		}
	}
}

func TestSummary_DepositHeldAndDue(t *testing.T) {
	today := date(2026, time.October, 21)
	refund := int64(150000)
	s := summarize([]staySummaryRow{
		// Current stay: ₹2,000 agreed, nothing paid yet.
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.October, 20),
			TotalPaid: 500000, DepositAmount: 200000},
		// An earlier stay, settled: its deposit is dealt with, so not held.
		{RentAmount: 450000, RentCycle: "monthly", StartDate: date(2026, time.June, 1),
			EndDate: ptrTime(date(2026, time.August, 31)), TotalPaid: 1350000,
			DepositAmount: 200000, DepositPaid: 200000, SettlementRefund: &refund},
	}, today)
	if s.DepositHeld != 0 || s.DepositDue != 200000 {
		t.Errorf("held/due = %d/%d, want 0/200000", s.DepositHeld, s.DepositDue)
	}
	if s.TotalPaid != 1850000 {
		t.Errorf("total paid = %d, want 1850000: rent only, unchanged by deposits", s.TotalPaid)
	}

	paid := summarize([]staySummaryRow{
		{RentAmount: 500000, RentCycle: "monthly", StartDate: date(2026, time.October, 14),
			TotalPaid: 500000, DepositAmount: 200000, DepositPaid: 200000},
	}, today)
	if paid.DepositHeld != 200000 || paid.DepositDue != 0 {
		t.Errorf("held/due = %d/%d, want 200000/0", paid.DepositHeld, paid.DepositDue)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
