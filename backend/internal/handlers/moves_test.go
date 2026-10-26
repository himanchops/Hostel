package handlers

import (
	"testing"
	"time"
)

// The owner's case: moved in 17 Sep, moved rooms on 18 Oct.
var (
	moveStart = date(2026, time.September, 17)
	movedOn   = date(2026, time.October, 18)
)

func TestRoomSpans_NoMovesIsOneSpan(t *testing.T) {
	end := date(2026, time.November, 1)
	got := roomSpans(moveStart, end, 7, nil)
	if len(got) != 1 || got[0].RoomID != 7 || !got[0].From.Equal(moveStart) || !got[0].To.Equal(end) {
		t.Errorf("spans = %+v, want one span in room 7", got)
	}
}

func TestRoomSpans_TwoMovesThreeRooms(t *testing.T) {
	end := date(2026, time.December, 1)
	moves := []roomMove{
		{On: date(2026, time.October, 18), FromRoom: 2},
		{On: date(2026, time.November, 5), FromRoom: 4},
	}
	got := roomSpans(moveStart, end, 6, moves)
	want := []roomSpan{
		{RoomID: 2, From: moveStart, To: date(2026, time.October, 18)},
		{RoomID: 4, From: date(2026, time.October, 18), To: date(2026, time.November, 5)},
		{RoomID: 6, From: date(2026, time.November, 5), To: end},
	}
	if len(got) != len(want) {
		t.Fatalf("spans = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i].RoomID != want[i].RoomID || !got[i].From.Equal(want[i].From) || !got[i].To.Equal(want[i].To) {
			t.Errorf("span %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// October, 31 nights: in Room 2 from the 1st to the 17th (17 nights), then in
// Room 4 from the 18th to the 31st (14 nights). Before moves were recorded,
// all 31 counted to Room 4.
func TestComputeRoomInsights_AMoveSplitsTheMonth(t *testing.T) {
	rooms := []insightRoom{
		{RoomID: 2, RoomName: "Room 2", SiteID: 1, SiteName: "Site", TotalBeds: 1},
		{RoomID: 4, RoomName: "Room 4", SiteID: 1, SiteName: "Site", TotalBeds: 1},
	}
	stays := []insightStay{
		{RoomID: 4, RentAmount: 500000, RentCycle: "monthly", StartDate: moveStart,
			Moves: []roomMove{{On: movedOn, FromRoom: 2}}},
	}
	from, to := date(2026, time.October, 1), date(2026, time.November, 1)
	got := computeRoomInsights(rooms, stays, map[int64]int64{}, from, to)
	if got[0].OccupiedNights != 17 {
		t.Errorf("Room 2 occupied = %d, want 17", got[0].OccupiedNights)
	}
	if got[1].OccupiedNights != 14 {
		t.Errorf("Room 4 occupied = %d, want 14", got[1].OccupiedNights)
	}
}
