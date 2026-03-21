package handlers

import (
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
		`SELECT id, site_id, name, floor, created_at, updated_at
		 FROM rooms WHERE site_id = $1 ORDER BY floor, name`,
		siteID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch rooms"))
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

	var room models.Room
	err = h.db.QueryRowx(
		`INSERT INTO rooms (site_id, name, floor, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4)
		 RETURNING id, site_id, name, floor, created_at, updated_at`,
		siteID, req.Name, req.Floor, time.Now(),
	).StructScan(&room)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to create room"))
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

	var room models.Room
	err = h.db.QueryRowx(
		`UPDATE rooms SET name = $1, floor = $2, updated_at = $3
		 WHERE id = $4 AND site_id = $5
		 RETURNING id, site_id, name, floor, created_at, updated_at`,
		req.Name, req.Floor, time.Now(), roomID, siteID,
	).StructScan(&room)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("room not found"))
	}

	return c.JSON(http.StatusOK, room)
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

	result, err := h.db.Exec(
		`DELETE FROM rooms WHERE id = $1 AND site_id = $2`,
		roomID, siteID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to delete room"))
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
		`SELECT id, room_id, name, created_at, updated_at FROM beds WHERE room_id = $1 ORDER BY name`,
		roomID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to fetch beds"))
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

	var bed models.Bed
	err = h.db.QueryRowx(
		`INSERT INTO beds (room_id, name, created_at, updated_at)
		 VALUES ($1, $2, $3, $3)
		 RETURNING id, room_id, name, created_at, updated_at`,
		roomID, req.Name, time.Now(),
	).StructScan(&bed)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to create bed"))
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

	var bed models.Bed
	err = h.db.QueryRowx(
		`UPDATE beds SET name = $1, updated_at = $2
		 WHERE id = $3 AND room_id = $4
		 RETURNING id, room_id, name, created_at, updated_at`,
		req.Name, time.Now(), bedID, roomID,
	).StructScan(&bed)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
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

	result, err := h.db.Exec(
		`DELETE FROM beds WHERE id = $1 AND room_id = $2`,
		bedID, roomID,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errorResponse("failed to delete bed"))
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("bed not found"))
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "bed deleted"})
}
