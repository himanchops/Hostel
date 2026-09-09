package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
)

type RoomHandler struct {
	db *sqlx.DB
}

func NewRoomHandler(db *sqlx.DB) *RoomHandler {
	return &RoomHandler{db: db}
}

// roomSelect and bedSelect carry the ledger footprint on every row.
//
// They exist so the UI can refuse a delete BEFORE offering it. Without them the
// only way to learn that a bed has history was to attempt the delete and read
// the 409 — which is what the confirm dialog used to do: warn that a bed with
// history "cannot be deleted" and then show a red Delete button anyway, because
// the client had no idea which case it was in.
//
// These MUST agree with ledgerFootprint, which is what actually enforces the
// rule. Same joins, same predicate — a stay counts whether or not it has ended,
// and a NULL bed_id belongs to no bed. `owner/delete-guard.test.ts` asserts the
// two never disagree: whatever these counts say is deletable must actually
// delete, and whatever they say is not must 409.
//
// COUNT(DISTINCT s.id) is required because the payments join fans stays out;
// COUNT(p.id) needs no DISTINCT because a payment belongs to exactly one stay.
const roomSelect = `
	SELECT r.id, r.site_id, r.name, r.floor, r.created_at, r.updated_at,
	       COUNT(DISTINCT s.id) AS stay_count,
	       COUNT(p.id)          AS payment_count
	FROM rooms r
	LEFT JOIN beds b     ON b.room_id = r.id
	LEFT JOIN stays s    ON s.bed_id = b.id
	LEFT JOIN payments p ON p.stay_id = s.id
	WHERE `

const bedSelect = `
	SELECT b.id, b.room_id, b.name, b.created_at, b.updated_at,
	       COUNT(DISTINCT s.id) AS stay_count,
	       COUNT(p.id)          AS payment_count
	FROM beds b
	LEFT JOIN stays s    ON s.bed_id = b.id
	LEFT JOIN payments p ON p.stay_id = s.id
	WHERE `

type roomRequest struct {
	Name  string `json:"name"`
	Floor int    `json:"floor"`
}

type bedRequest struct {
	Name string `json:"name"`
}

// siteOwnerCheck returns (siteID, error) — 404 if site not owned by caller.
func (h *RoomHandler) siteOwnerCheck(c echo.Context) (int64, error) {
	ownerID := appMiddleware.GetOwnerID(c)
	siteID, err := strconv.ParseInt(c.Param("siteId"), 10, 64)
	if err != nil {
		return 0, c.JSON(http.StatusBadRequest, errorResponse("invalid site id"))
	}

	var count int
	err = h.db.Get(&count,
		`SELECT COUNT(*) FROM hostel_sites WHERE id = $1 AND owner_id = $2`,
		siteID, ownerID,
	)
	if err != nil || count == 0 {
		return 0, c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}

	return siteID, nil
}

// --- Rooms ---

func (h *RoomHandler) ListRooms(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}

	var rooms []models.Room
	err = h.db.Select(&rooms,
		roomSelect+`r.site_id = $1 GROUP BY r.id ORDER BY r.floor, r.name`,
		siteID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch rooms")
	}
	if rooms == nil {
		rooms = []models.Room{}
	}

	return c.JSON(http.StatusOK, rooms)
}

func (h *RoomHandler) CreateRoom(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}

	var req roomRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var roomID int64
	err = h.db.QueryRow(
		`INSERT INTO rooms (site_id, name, floor, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		siteID, req.Name, req.Floor, time.Now(),
	).Scan(&roomID)
	if err != nil {
		return serverError(c, err, "failed to create room")
	}

	// Re-read through roomSelect rather than RETURNING the row directly: every
	// Room this API hands out carries a real footprint, so a client never has
	// to know which endpoint produced it. A new room's is genuinely zero.
	var room models.Room
	if err := h.db.Get(&room, roomSelect+`r.id = $1 GROUP BY r.id`, roomID); err != nil {
		return serverError(c, err, "failed to create room")
	}

	return c.JSON(http.StatusCreated, room)
}

func (h *RoomHandler) UpdateRoom(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}

	roomID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid room id"))
	}

	var req roomRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var updatedID int64
	err = h.db.QueryRow(
		`UPDATE rooms SET name = $1, floor = $2, updated_at = $3
		 WHERE id = $4 AND site_id = $5 RETURNING id`,
		req.Name, req.Floor, time.Now(), roomID, siteID,
	).Scan(&updatedID)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("room not found"))
	}

	// Counts recomputed rather than assumed zero. A rename response replaces
	// the row in the client's state, so a stripped-down one would quietly turn
	// an undeletable room into a deletable-looking one.
	var room models.Room
	if err := h.db.Get(&room, roomSelect+`r.id = $1 GROUP BY r.id`, updatedID); err != nil {
		return serverError(c, err, "failed to load room")
	}

	return c.JSON(http.StatusOK, room)
}

// ledgerFootprint counts what a cascading delete would destroy.
//
// The FK chain is beds → stays → payments and every link is ON DELETE CASCADE
// (001_init.up.sql), so `DELETE FROM beds` takes a tenant's whole rent history
// with it, silently and unrecoverably. These counts turn that into a refusal
// the owner can read.
//
// `where` is the predicate against `stays s`, with the id as $1 — the bed and
// room cases differ only in how they reach the stay.
func (h *RoomHandler) ledgerFootprint(where string, id int64) (stays, payments int, err error) {
	var row struct {
		Stays    int `db:"stays"`
		Payments int `db:"payments"`
	}
	err = h.db.Get(&row, `
		SELECT COUNT(DISTINCT s.id) AS stays,
		       COUNT(p.id)          AS payments
		FROM stays s
		LEFT JOIN beds b     ON b.id = s.bed_id
		LEFT JOIN payments p ON p.stay_id = s.id
		WHERE `+where, id)
	return row.Stays, row.Payments, err
}

// occupancyRefusal is the 409 body. It never names a tenant — counts are
// structural and safe to put in a string, a name is not.
func occupancyRefusal(kind string, stays, payments int) map[string]string {
	return errorResponse(fmt.Sprintf(
		"this %s has %s and %s on record — deleting it would destroy that ledger permanently. "+
			"End the stay from the grid instead; a former tenant's payment history is worth keeping.",
		kind, plural(stays, "stay", "stays"), plural(payments, "payment", "payments"),
	))
}

func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

func (h *RoomHandler) DeleteRoom(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}

	roomID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid room id"))
	}

	// Refuse if ANY bed in the room has stay history, ended or not. A former
	// tenant's ledger is exactly the record you get sued over, so "they moved
	// out" is not a reason to let it be destroyed.
	stays, payments, err := h.ledgerFootprint("b.room_id = $1", roomID)
	if err != nil {
		return serverError(c, err, "failed to check room occupancy")
	}
	if stays > 0 {
		return c.JSON(http.StatusConflict, occupancyRefusal("room", stays, payments))
	}

	result, err := h.db.Exec(
		`DELETE FROM rooms WHERE id = $1 AND site_id = $2`,
		roomID, siteID,
	)
	if err != nil {
		return serverError(c, err, "failed to delete room")
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("room not found"))
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "room deleted"})
}

// --- Beds ---

func (h *RoomHandler) roomOwnerCheck(c echo.Context, siteID int64) (int64, error) {
	roomID, err := strconv.ParseInt(c.Param("roomId"), 10, 64)
	if err != nil {
		return 0, c.JSON(http.StatusBadRequest, errorResponse("invalid room id"))
	}

	var count int
	err = h.db.Get(&count,
		`SELECT COUNT(*) FROM rooms WHERE id = $1 AND site_id = $2`,
		roomID, siteID,
	)
	if err != nil || count == 0 {
		return 0, c.JSON(http.StatusNotFound, errorResponse("room not found"))
	}

	return roomID, nil
}

func (h *RoomHandler) ListBeds(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}
	roomID, err := h.roomOwnerCheck(c, siteID)
	if err != nil {
		return err
	}

	var beds []models.Bed
	err = h.db.Select(&beds,
		bedSelect+`b.room_id = $1 GROUP BY b.id ORDER BY b.name`,
		roomID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch beds")
	}
	if beds == nil {
		beds = []models.Bed{}
	}

	return c.JSON(http.StatusOK, beds)
}

func (h *RoomHandler) CreateBed(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}
	roomID, err := h.roomOwnerCheck(c, siteID)
	if err != nil {
		return err
	}

	var req bedRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var bedID int64
	err = h.db.QueryRow(
		`INSERT INTO beds (room_id, name, created_at, updated_at)
		 VALUES ($1, $2, $3, $3) RETURNING id`,
		roomID, req.Name, time.Now(),
	).Scan(&bedID)
	if err != nil {
		return serverError(c, err, "failed to create bed")
	}

	var bed models.Bed
	if err := h.db.Get(&bed, bedSelect+`b.id = $1 GROUP BY b.id`, bedID); err != nil {
		return serverError(c, err, "failed to create bed")
	}

	return c.JSON(http.StatusCreated, bed)
}

func (h *RoomHandler) UpdateBed(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}
	roomID, err := h.roomOwnerCheck(c, siteID)
	if err != nil {
		return err
	}

	bedID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid bed id"))
	}

	var req bedRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var updatedID int64
	err = h.db.QueryRow(
		`UPDATE beds SET name = $1, updated_at = $2
		 WHERE id = $3 AND room_id = $4 RETURNING id`,
		req.Name, time.Now(), bedID, roomID,
	).Scan(&updatedID)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}

	// See UpdateRoom: a rename must not hand back a row that looks deletable.
	var bed models.Bed
	if err := h.db.Get(&bed, bedSelect+`b.id = $1 GROUP BY b.id`, updatedID); err != nil {
		return serverError(c, err, "failed to load bed")
	}

	return c.JSON(http.StatusOK, bed)
}

func (h *RoomHandler) DeleteBed(c echo.Context) error {
	siteID, err := h.siteOwnerCheck(c)
	if err != nil {
		return err
	}
	roomID, err := h.roomOwnerCheck(c, siteID)
	if err != nil {
		return err
	}

	bedID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid bed id"))
	}

	stays, payments, err := h.ledgerFootprint("s.bed_id = $1", bedID)
	if err != nil {
		return serverError(c, err, "failed to check bed occupancy")
	}
	if stays > 0 {
		return c.JSON(http.StatusConflict, occupancyRefusal("bed", stays, payments))
	}

	result, err := h.db.Exec(
		`DELETE FROM beds WHERE id = $1 AND room_id = $2`,
		bedID, roomID,
	)
	if err != nil {
		return serverError(c, err, "failed to delete bed")
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "bed deleted"})
}
