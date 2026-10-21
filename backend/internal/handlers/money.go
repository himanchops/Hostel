package handlers

import (
	"time"

	"github.com/jmoiron/sqlx"
)

// Two different questions get asked of the same money, and they need two
// different answers.
//
//   - "How is the rent doing?" — rent collected against rent billed. A deposit
//     is not rent and must never count here, or a month with three move-ins
//     reads as 108% collected.
//   - "What came in?" — every rupee that arrived, cash and online, rent and
//     deposit, less what went back out at move-out. This is the figure the
//     owner checks against the bank and the cash drawer together.
//
// Both are built from one loader, so the dashboard and Insights cannot drift
// apart on either.
//
// Settlements are money too. Each one is dated on the stay's end_date, the day
// the tenant left. A settlement has no date of its own, only created_at, which
// is when someone typed it in, and for a backfilled leaver that is the wrong
// month entirely. What a settlement contributes:
//
//   - returned: the refund, when there was one. That is money handed back.
//   - depositToRent: the part of the outstanding rent that the held deposit
//     covered. No money moves that day; the deposit arrived months ago. But
//     the rent is paid, and without this a leaver's last month reads as owed
//     forever (BACKLOG → "Insights ignores settlements").
//   - advanceReturned: rent paid ahead and then handed back. It was counted as
//     rent when it arrived, so it comes off rent collected when it leaves.

// moneyMonth is one calendar month's money, in paise.
type moneyMonth struct {
	RentPaid        int64 `json:"rent_paid_paise"`        // approved rent payments
	DepositsIn      int64 `json:"deposits_in_paise"`      // approved deposit payments
	Returned        int64 `json:"returned_paise"`         // refunds at settlement
	DepositToRent   int64 `json:"deposit_to_rent_paise"`  // rent a deposit covered at settlement
	AdvanceReturned int64 `json:"advance_returned_paise"` // rent paid ahead, handed back at settlement
}

// rentCollected answers the rent question: rent received, plus rent a deposit
// paid off, less rent paid ahead and given back.
func (m moneyMonth) rentCollected() int64 {
	return m.RentPaid + m.DepositToRent - m.AdvanceReturned
}

// netIn answers the money question: everything that arrived, less everything
// handed back. A month where two people left and nobody arrived goes negative,
// and that is the truth.
func (m moneyMonth) netIn() int64 {
	return m.RentPaid + m.DepositsIn - m.Returned
}

// settlementRent is how much of a leaver's outstanding rent their deposit
// paid off: all of it when the deposit was enough, the whole deposit when it
// was not. A tenant who had paid ahead (dues ≤ 0) used none of it on rent.
//
// Adjustments are left out on purpose. A charge for a broken chair is taken
// from the deposit too, but it is not rent; a waiver lets rent go unpaid, and
// how that should show is for the corrections design to decide.
func settlementRent(depositHeld, dues int64) int64 {
	if dues <= 0 || depositHeld <= 0 {
		return 0
	}
	if dues < depositHeld {
		return dues
	}
	return depositHeld
}

// settlementFlow is one settlement's contribution, keyed for both the monthly
// series and the per-room table.
type settlementFlow struct {
	Month           string `db:"month"`
	RoomID          int64  `db:"room_id"`
	DepositPaise    int64  `db:"deposit_paise"`
	DuesPaise       int64  `db:"dues_paise"`
	AdvanceReturned int64  `db:"advance_returned_paise"`
	RefundPaise     int64  `db:"refund_paise"`
}

func (f settlementFlow) returned() int64 {
	if f.RefundPaise > 0 {
		return f.RefundPaise
	}
	return 0
}

// rentDelta is what the settlement changes about rent collected.
func (f settlementFlow) rentDelta() int64 {
	return settlementRent(f.DepositPaise, f.DuesPaise) - f.AdvanceReturned
}

func loadSettlementFlows(db *sqlx.DB, ownerID int64, from, to time.Time) ([]settlementFlow, error) {
	var flows []settlementFlow
	err := db.Select(&flows, `
		SELECT to_char(s.end_date, 'YYYY-MM') AS month,
		       COALESCE(r.id, 0) AS room_id,
		       st.deposit_paise, st.dues_paise, st.advance_returned_paise, st.refund_paise
		FROM settlements st
		JOIN stays s     ON s.id = st.stay_id
		JOIN tenants t   ON t.id = s.tenant_id
		LEFT JOIN beds b ON b.id = s.bed_id
		LEFT JOIN rooms r ON r.id = b.room_id
		WHERE t.owner_id = $1
		  AND s.end_date >= $2
		  AND s.end_date <  $3
	`, ownerID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	return flows, err
}

// loadMoneyByMonth returns every month in [from, to) that had any money, keyed
// "2006-01". A month with none is absent; read it as the zero moneyMonth.
func loadMoneyByMonth(db *sqlx.DB, ownerID int64, from, to time.Time) (map[string]moneyMonth, error) {
	var rows []struct {
		Month  string `db:"month"`
		Kind   string `db:"kind"`
		Amount int64  `db:"amount"`
	}
	err := db.Select(&rows, `
		SELECT to_char(p.payment_date, 'YYYY-MM') AS month,
		       p.kind::text AS kind,
		       COALESCE(SUM(p.amount), 0) AS amount
		FROM payments p
		JOIN stays s   ON s.id = p.stay_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		  AND p.payment_date >= $2
		  AND p.payment_date <  $3
		GROUP BY 1, 2
	`, ownerID, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	flows, err := loadSettlementFlows(db, ownerID, from, to)
	if err != nil {
		return nil, err
	}

	out := map[string]moneyMonth{}
	for _, r := range rows {
		m := out[r.Month]
		if r.Kind == "deposit" {
			m.DepositsIn += r.Amount
		} else {
			m.RentPaid += r.Amount
		}
		out[r.Month] = m
	}
	addSettlementFlows(out, flows)
	return out, nil
}

func addSettlementFlows(out map[string]moneyMonth, flows []settlementFlow) {
	for _, f := range flows {
		m := out[f.Month]
		m.Returned += f.returned()
		m.DepositToRent += settlementRent(f.DepositPaise, f.DuesPaise)
		m.AdvanceReturned += f.AdvanceReturned
		out[f.Month] = m
	}
}

// loadDepositsHeld is deposit money the owner is holding right now: every
// approved deposit payment on a stay that has not been settled. A settled
// stay's deposit has been dealt with, refunded or kept against dues. An
// ended-but-unsettled stay's has not, so it still counts.
func loadDepositsHeld(db *sqlx.DB, ownerID int64) (int64, error) {
	var held int64
	err := db.Get(&held, `
		SELECT COALESCE(SUM(p.amount), 0)
		FROM payments p
		JOIN stays s   ON s.id = p.stay_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.owner_id = $1
		  AND p.is_approved = true
		  AND p.kind = 'deposit'
		  AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.stay_id = s.id)
	`, ownerID)
	return held, err
}
