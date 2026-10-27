package handlers

import (
	"net/http"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
	"github.com/winnow/hostel/internal/storage"
)

type TenantAuthHandler struct {
	db          *sqlx.DB
	authService *auth.Service
	storage     storage.Service
}

func NewTenantAuthHandler(db *sqlx.DB, authService *auth.Service, s storage.Service) *TenantAuthHandler {
	return &TenantAuthHandler{db: db, authService: authService, storage: s}
}

type tenantLoginRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

type tenantAuthResponse struct {
	Token  string        `json:"token"`
	Tenant models.Tenant `json:"tenant"`
}

// errAwaitingApproval is what a registered tenant hears at sign-in before the
// owner has approved them: their password was right, and "invalid phone or
// password" sent them off to reset something that was not wrong.
const errAwaitingApproval = "The hostel hasn't approved your registration yet. You can sign in once they do."

func (h *TenantAuthHandler) Login(c echo.Context) error {
	var req tenantLoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("Something went wrong. Please try again."))
	}
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Phone == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("Enter your phone number and password."))
	}
	phone, ok := normalizePhone(req.Phone)
	if !ok {
		return c.JSON(http.StatusBadRequest, errorResponse(errPhone))
	}

	// Matched on the last ten digits, not as typed: a tenant saved as
	// "+91 98450 12345" signing in with "9845012345" is the same person, and
	// was once turned away as a wrong password. The same number can be on
	// more than one record — someone who left and came back, or who lives at
	// two hostels on this app — so each is tried, newest first, and the
	// password decides which one this is.
	//
	// `password_hash <> ''` rather than `IS NOT NULL`: NULL <> '' is NULL, so
	// this excludes both, and it is the same predicate has_portal_login is
	// computed from. Two spellings of "can this person sign in?" is one more
	// than the codebase can keep honest.
	//
	// Records still waiting for approval are tried too, after the approved
	// ones, so that someone who registered and typed the right password is
	// told why they cannot sign in yet instead of "wrong password". Only a
	// correct password learns that, so it tells a stranger nothing.
	var candidates []models.Tenant
	if err := h.db.Select(&candidates,
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url, password_hash,
		        (password_hash IS NOT NULL AND password_hash <> '') AS has_portal_login,
		        is_approved, created_at, updated_at
		 FROM tenants WHERE `+phoneDigitsSQL+` = $1 AND password_hash <> ''
		 ORDER BY is_approved DESC, created_at DESC`,
		phone,
	); err != nil {
		return serverError(c, err, "failed to sign in")
	}
	var tenant models.Tenant
	found := false
	for _, t := range candidates {
		if h.authService.CheckPassword(req.Password, t.PasswordHash) {
			tenant, found = t, true
			break
		}
	}
	if !found {
		return c.JSON(http.StatusUnauthorized, errorResponse("That phone number and password don't match."))
	}
	if !tenant.IsApproved {
		return c.JSON(http.StatusForbidden, errorResponse(errAwaitingApproval))
	}

	token, err := h.authService.GenerateTenantToken(tenant.ID)
	if err != nil {
		return serverError(c, err, "failed to generate token")
	}
	if err := signTenant(c, h.storage, &tenant); err != nil {
		return serverError(c, err, "failed to prepare tenant files")
	}
	if tenant.HostelName, err = hostelName(h.db, tenant.OwnerID); err != nil {
		return serverError(c, err, "failed to load the hostel's name")
	}

	return c.JSON(http.StatusOK, tenantAuthResponse{Token: token, Tenant: tenant})
}

func (h *TenantAuthHandler) Me(c echo.Context) error {
	tenantID := appMiddleware.GetTenantID(c)

	var tenant models.Tenant
	err := h.db.QueryRowx(
		`SELECT id, owner_id, name, phone, email, id_proof_url, photo_url,
		        (password_hash IS NOT NULL AND password_hash <> '') AS has_portal_login,
		        is_approved, created_at, updated_at
		 FROM tenants WHERE id = $1`,
		tenantID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	if err := signTenant(c, h.storage, &tenant); err != nil {
		return serverError(c, err, "failed to prepare tenant files")
	}
	if tenant.HostelName, err = hostelName(h.db, tenant.OwnerID); err != nil {
		return serverError(c, err, "failed to load the hostel's name")
	}
	return c.JSON(http.StatusOK, tenant)
}
