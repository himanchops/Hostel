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

func (h *SiteHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var sites []models.HostelSite
	err := h.db.Select(&sites,
		`SELECT id, owner_id, name, address, created_at, updated_at
		 FROM hostel_sites WHERE owner_id = $1 ORDER BY created_at DESC`,
		ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to fetch sites")
	}
	if sites == nil {
		sites = []models.HostelSite{}
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
