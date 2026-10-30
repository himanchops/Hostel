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

type SiteHandler struct {
	db *sqlx.DB
}

func NewSiteHandler(db *sqlx.DB) *SiteHandler {
	return &SiteHandler{db: db}
}

type siteRequest struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// listedSite is a site with the ledger behind it, so the Sites page knows
// before anyone taps Delete whether the server will refuse. Only the list
// carries the counts; nothing else on a site needs them.
type listedSite struct {
	models.HostelSite
	StayCount    int `db:"stay_count" json:"stay_count"`
	PaymentCount int `db:"payment_count" json:"payment_count"`
}

// siteFootprintSQL is the predicate ledgerFootprint uses for a site. The
// list's counts below must agree with it, as roomSelect and bedSelect agree
// for rooms and beds; `owner/delete-guard.test.ts` checks that they do.
const siteFootprintSQL = "b.room_id IN (SELECT id FROM rooms WHERE site_id = $1)"

func (h *SiteHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var sites []listedSite
	err := h.db.Select(&sites,
		`SELECT hs.id, hs.owner_id, hs.name, hs.address, hs.created_at, hs.updated_at,
		        COUNT(DISTINCT s.id) AS stay_count,
		        COUNT(p.id)          AS payment_count
		 FROM hostel_sites hs
		 LEFT JOIN rooms r    ON r.site_id = hs.id
		 LEFT JOIN beds b     ON b.room_id = r.id
		 LEFT JOIN stays s    ON s.bed_id = b.id
		 LEFT JOIN payments p ON p.stay_id = s.id
		 WHERE hs.owner_id = $1
		 GROUP BY hs.id
		 ORDER BY hs.created_at DESC`,
		ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch sites")
	}
	if sites == nil {
		sites = []listedSite{}
	}

	return c.JSON(http.StatusOK, sites)
}

func (h *SiteHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req siteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var site models.HostelSite
	err := h.db.QueryRowx(
		`INSERT INTO hostel_sites (owner_id, name, address, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4)
		 RETURNING id, owner_id, name, address, created_at, updated_at`,
		ownerID, req.Name, req.Address, time.Now(),
	).StructScan(&site)
	if err != nil {
		return serverError(c, err, "failed to create site")
	}

	return c.JSON(http.StatusCreated, site)
}

func (h *SiteHandler) Get(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	siteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid site id"))
	}

	var site models.HostelSite
	err = h.db.QueryRowx(
		`SELECT id, owner_id, name, address, created_at, updated_at
		 FROM hostel_sites WHERE id = $1 AND owner_id = $2`,
		siteID, ownerID,
	).StructScan(&site)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}

	return c.JSON(http.StatusOK, site)
}

func (h *SiteHandler) Update(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	siteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid site id"))
	}

	var req siteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name is required"))
	}

	var site models.HostelSite
	err = h.db.QueryRowx(
		`UPDATE hostel_sites SET name = $1, address = $2, updated_at = $3
		 WHERE id = $4 AND owner_id = $5
		 RETURNING id, owner_id, name, address, created_at, updated_at`,
		req.Name, req.Address, time.Now(), siteID, ownerID,
	).StructScan(&site)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}

	return c.JSON(http.StatusOK, site)
}

func (h *SiteHandler) Delete(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	siteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid site id"))
	}

	// The same rule as a room or a bed: any stay, ended or not, and the site
	// stays. The cascade runs sites → rooms → beds → stays → payments, so
	// this one DELETE once took every rent record the owner had.
	//
	// Ownership first, so another owner's site is a 404, never a count.
	var owned bool
	if err := h.db.Get(&owned,
		`SELECT EXISTS (SELECT 1 FROM hostel_sites WHERE id = $1 AND owner_id = $2)`,
		siteID, ownerID,
	); err != nil {
		return serverError(c, err, "failed to delete site")
	}
	if !owned {
		return c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}
	stays, payments, err := ledgerFootprint(h.db, siteFootprintSQL, siteID)
	if err != nil {
		return serverError(c, err, "failed to check site occupancy")
	}
	if stays > 0 {
		return c.JSON(http.StatusConflict, occupancyRefusal("site", stays, payments))
	}

	result, err := h.db.Exec(
		`DELETE FROM hostel_sites WHERE id = $1 AND owner_id = $2`,
		siteID, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to delete site")
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("site not found"))
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "site deleted"})
}
