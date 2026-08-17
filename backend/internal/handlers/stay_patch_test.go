package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

func patchFrom(t *testing.T, body string) stayPatch {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	c := e.NewContext(req, httptest.NewRecorder())

	p, err := parseStayPatch(c)
	if err != nil {
		t.Fatalf("parseStayPatch(%s) errored: %v", body, err)
	}
	return p
}

// The regression: PUT used to write every column from the request body, so
// sending only end_date wrote notice_date = NULL and silently erased a recorded
// notice. An absent key must be distinguishable from an explicit null.
func TestStayPatch_AbsentIsNotNull(t *testing.T) {
	p := patchFrom(t, `{"end_date":"2026-08-05"}`)

	if !p.has("end_date") {
		t.Error("end_date was sent but has() says otherwise")
	}
	if p.has("notice_date") {
		t.Error("notice_date was absent but has() reports it as present — this is the data-loss bug")
	}
	if p.EndDate == nil || !p.EndDate.Equal(date(2026, time.August, 5)) {
		t.Errorf("EndDate = %v, want 2026-08-05", p.EndDate)
	}
}

func TestStayPatch_ExplicitNullClears(t *testing.T) {
	p := patchFrom(t, `{"notice_date":null}`)

	if !p.has("notice_date") {
		t.Error("explicit null should count as present, so the field gets cleared")
	}
	if p.NoticeDate != nil {
		t.Errorf("NoticeDate = %v, want nil", p.NoticeDate)
	}
}

func TestStayPatch_EmptyBodyChangesNothing(t *testing.T) {
	p := patchFrom(t, `{}`)

	for _, f := range []string{"start_date", "end_date", "notice_date", "rent_amount", "deposit_amount", "rent_cycle"} {
		if p.has(f) {
			t.Errorf("%s reported present for an empty body", f)
		}
	}
}

func TestStayPatch_CorrectableFields(t *testing.T) {
	p := patchFrom(t, `{"start_date":"2026-02-20","rent_amount":850000,"rent_cycle":"weekly","deposit_amount":0}`)

	if p.StartDate == nil || !p.StartDate.Equal(date(2026, time.February, 20)) {
		t.Errorf("StartDate = %v, want 2026-02-20", p.StartDate)
	}
	if p.RentAmount == nil || *p.RentAmount != 850000 {
		t.Errorf("RentAmount = %v, want 850000", p.RentAmount)
	}
	if p.RentCycle == nil || *p.RentCycle != "weekly" {
		t.Errorf("RentCycle = %v, want weekly", p.RentCycle)
	}
	// Zero must be treated as a real value, not as "unset".
	if !p.has("deposit_amount") || p.DepositAmount == nil || *p.DepositAmount != 0 {
		t.Errorf("deposit_amount 0 should be present and zero, got has=%v val=%v", p.has("deposit_amount"), p.DepositAmount)
	}
}

func TestStayPatch_RejectsBadInput(t *testing.T) {
	e := echo.New()
	bad := []string{
		`{"start_date":"05-08-2026"}`,
		`{"end_date":"not a date"}`,
		`{"rent_amount":"lots"}`,
		`not json`,
	}
	for _, body := range bad {
		req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		c := e.NewContext(req, httptest.NewRecorder())

		if _, err := parseStayPatch(c); err == nil {
			t.Errorf("parseStayPatch(%s) should have errored", body)
		}
	}
}

// Correcting a start date must change what the tenant owes — that is the whole
// point of making it editable.
func TestSummary_CorrectingStartDateChangesExpected(t *testing.T) {
	today := date(2026, time.August, 11)

	wrong := summarize([]staySummaryInput{
		{RentAmount: 700000, RentCycle: "monthly", StartDate: date(2026, time.July, 1), TotalPaid: 0},
	}, today)
	corrected := summarize([]staySummaryInput{
		{RentAmount: 700000, RentCycle: "monthly", StartDate: date(2026, time.April, 1), TotalPaid: 0},
	}, today)

	if corrected.TotalExpected <= wrong.TotalExpected {
		t.Errorf("an earlier start date should owe more: %d vs %d", corrected.TotalExpected, wrong.TotalExpected)
	}
	if corrected.DurationDays <= wrong.DurationDays {
		t.Errorf("an earlier start date should be a longer stay: %d vs %d", corrected.DurationDays, wrong.DurationDays)
	}
}
