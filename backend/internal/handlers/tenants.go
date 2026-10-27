package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/auth"
	appMiddleware "github.com/winnow/hostel/internal/middleware"
	"github.com/winnow/hostel/internal/models"
	"github.com/winnow/hostel/internal/storage"
)

type TenantHandler struct {
	db          *sqlx.DB
	authService *auth.Service
	storage     storage.Service
}

func NewTenantHandler(db *sqlx.DB, authService *auth.Service, s storage.Service) *TenantHandler {
	return &TenantHandler{db: db, authService: authService, storage: s}
}

// respondTenant sends one tenant with its file keys turned into expiring
// links. Every tenant that leaves this handler goes through here or
// signTenants — a tenant returned any other way ships raw keys, which render
// as broken images rather than leaking anything, but still render broken.
func (h *TenantHandler) respondTenant(c echo.Context, status int, t *models.Tenant) error {
	if err := signTenant(c, h.storage, t); err != nil {
		return serverError(c, err, "failed to prepare tenant files")
	}
	return c.JSON(status, t)
}

// tenantCols is the SELECT column list for all tenant queries.
//
// has_portal_login is derived here rather than stored: the hash is the only
// place the fact lives, and the hash itself is `json:"-"` and must stay that
// way. Owner-created tenants have no hash at all, so without this the owner
// side has no way to tell a tenant who can sign in from one who never could.
const tenantCols = `id, owner_id, name, phone, email, id_proof_url, photo_url,
	address, emergency_contact_name, emergency_contact_phone,
	workplace, aadhaar_number, id_proof_front_url, id_proof_back_url, notes,
	(password_hash IS NOT NULL AND password_hash <> '') AS has_portal_login,
	is_approved, created_at, updated_at`

type tenantRequest struct {
	Name                  string  `json:"name"`
	Phone                 string  `json:"phone"`
	Email                 string  `json:"email"`
	Address               *string `json:"address"`
	EmergencyContactName  *string `json:"emergency_contact_name"`
	EmergencyContactPhone *string `json:"emergency_contact_phone"`
	Workplace             *string `json:"workplace"`
	AadhaarNumber         *string `json:"aadhaar_number"`
	Notes                 *string `json:"notes"`
	IDProofURL            *string `json:"id_proof_url"`
	IDProofFrontURL       *string `json:"id_proof_front_url"`
	IDProofBackURL        *string `json:"id_proof_back_url"`
	PhotoURL              *string `json:"photo_url"`
}

// normalizePhones applies the phone rule (phone.go) to both numbers on the
// form, storing the ten digits. The emergency number may be left out here:
// only public registration requires one.
func (r *tenantRequest) normalizePhones() string {
	phone, ok := normalizePhone(r.Phone)
	if !ok {
		return errPhone
	}
	r.Phone = phone
	if r.EmergencyContactPhone != nil && strings.TrimSpace(*r.EmergencyContactPhone) != "" {
		emergency, ok := normalizePhone(*r.EmergencyContactPhone)
		if !ok {
			return errEmergencyPhone
		}
		r.EmergencyContactPhone = &emergency
	}
	return ""
}

// invalidFileRef names the first file field that is not an upload key, or
// returns "". The owner's forms only ever send keys they just uploaded; an
// edit that omits a field leaves the stored file alone (COALESCE in Update).
func (r tenantRequest) invalidFileRef() string {
	fields := []struct {
		name string
		v    *string
	}{
		{"id_proof_url", r.IDProofURL},
		{"id_proof_front_url", r.IDProofFrontURL},
		{"id_proof_back_url", r.IDProofBackURL},
		{"photo_url", r.PhotoURL},
	}
	for _, f := range fields {
		if f.v != nil && !validFileRef(*f.v) {
			return "invalid " + f.name
		}
	}
	return ""
}

func (h *TenantHandler) List(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	query := `SELECT ` + tenantCols + ` FROM tenants WHERE owner_id = $1`
	if c.QueryParam("pending") == "true" {
		query += " AND is_approved = false ORDER BY created_at DESC"
	} else {
		query = `SELECT ` + tenantCols + `,
		        CASE WHEN EXISTS (SELECT 1 FROM stays o WHERE o.tenant_id = tenants.id AND o.end_date IS NULL)
		             THEN NULL
		             ELSE (SELECT to_char(MAX(s.end_date), 'YYYY-MM-DD') FROM stays s WHERE s.tenant_id = tenants.id)
		        END AS left_on
		 FROM tenants WHERE owner_id = $1 AND is_approved = true ORDER BY name`
	}

	var tenants []models.Tenant
	err := h.db.Select(&tenants, query, ownerID)
	if err != nil {
		return serverError(c, err, "failed to fetch tenants")
	}
	if tenants == nil {
		tenants = []models.Tenant{}
	}
	if err := signTenants(c, h.storage, tenants); err != nil {
		return serverError(c, err, "failed to prepare tenant files")
	}
	return c.JSON(http.StatusOK, tenants)
}

func (h *TenantHandler) Get(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`SELECT `+tenantCols+` FROM tenants WHERE id = $1 AND owner_id = $2`,
		tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return h.respondTenant(c, http.StatusOK, &tenant)
}

func (h *TenantHandler) Create(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)

	var req tenantRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}
	if msg := req.normalizePhones(); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}
	if msg := req.invalidFileRef(); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	var tenant models.Tenant
	err := h.db.QueryRowx(
		`INSERT INTO tenants (owner_id, name, phone, email,
			address, emergency_contact_name, emergency_contact_phone,
			workplace, aadhaar_number, id_proof_url, id_proof_front_url, id_proof_back_url, photo_url,
			notes, is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15, $15)
		 RETURNING `+tenantCols,
		ownerID, req.Name, req.Phone, req.Email,
		req.Address, req.EmergencyContactName, req.EmergencyContactPhone,
		req.Workplace, req.AadhaarNumber, req.IDProofURL, req.IDProofFrontURL, req.IDProofBackURL, req.PhotoURL,
		req.Notes, time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return serverError(c, err, "failed to create tenant")
	}
	return h.respondTenant(c, http.StatusCreated, &tenant)
}

type publicRegisterRequest struct {
	Name                  string `json:"name"`
	Phone                 string `json:"phone"`
	Email                 string `json:"email"`
	Password              string `json:"password"`
	IDProofURL            string `json:"id_proof_url"` // legacy
	IDProofFrontURL       string `json:"id_proof_front_url"`
	IDProofBackURL        string `json:"id_proof_back_url"`
	Address               string `json:"address"`
	EmergencyContactName  string `json:"emergency_contact_name"`
	EmergencyContactPhone string `json:"emergency_contact_phone"`
	Workplace             string `json:"workplace"`
	AadhaarNumber         string `json:"aadhaar_number"`
	PhotoURL              string `json:"photo_url"`
}

// PublicOwner returns just enough about an owner to make a registration link
// look legitimate to the stranger who scanned it.
//
// Deliberately name-only. The registration page is the one screen in the
// product shown to someone with no account, reached by pointing a phone at a
// sticker in a corridor — without the property's name on it, the form is
// indistinguishable from a phishing page, which is the whole problem Phase F
// exists to fix. Email, phone and everything else stay behind auth: owner ids
// are small integers and therefore enumerable, so this endpoint is a directory
// of hostel names and must never become a directory of contact details.
// GET /public/owners/:ownerId
// hostelName is what an owner's tenants call the place: the site's name when
// there is exactly one, else empty (see PublicOwner for why never the
// owner's own name). sql.ErrNoRows means no such owner.
func hostelName(db *sqlx.DB, ownerID int64) (string, error) {
	var name string
	err := db.Get(&name,
		`SELECT CASE WHEN (SELECT COUNT(*) FROM hostel_sites WHERE owner_id = o.id) = 1
		             THEN (SELECT name FROM hostel_sites WHERE owner_id = o.id)
		             ELSE '' END
		 FROM owners o WHERE o.id = $1`, ownerID)
	return name, err
}

func (h *TenantHandler) PublicOwner(c echo.Context) error {
	ownerID, err := strconv.ParseInt(c.Param("ownerId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid owner id"))
	}

	// The property's name, never the account holder's: "Welcome to Chopra
	// Boys Hostel" is what a stranger at the door expects to read, and the
	// owner's personal name on a public, enumerable page is both less
	// reassuring and more than it needs to say. With no site, or several,
	// there is no single property this link belongs to, so the name is empty
	// and the page says "Welcome" alone until links are per site. It once fell
	// back to the owner's own name, which read as "Welcome to Rahul Shetty"
	// (Oct 2026).
	name, err := hostelName(h.db, ownerID)
	if err != nil {
		// Only a genuinely absent row is a bad link. Mapping every error here
		// to 404 told a tenant standing in a corridor that the sticker they
		// just scanned was invalid whenever Neon was asleep or unreachable —
		// and logged nothing, so the complaint was unreproducible. This is the
		// same family as the errors PR #17 fixed: the error was checked, just
		// not classified.
		if !errors.Is(err, sql.ErrNoRows) {
			return serverError(c, err, "failed to load registration link")
		}
		return c.JSON(http.StatusNotFound, errorResponse("registration link not found"))
	}
	return c.JSON(http.StatusOK, map[string]string{"name": name})
}

func (h *TenantHandler) PublicRegister(c echo.Context) error {
	ownerID, err := strconv.ParseInt(c.Param("ownerId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid owner id"))
	}

	var exists bool
	// SELECT EXISTS always returns exactly one row, so err here is a real
	// database failure rather than a missing owner — `err != nil || !exists`
	// conflated the two and turned an outage into "your link is invalid".
	if err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM owners WHERE id = $1)", ownerID).Scan(&exists); err != nil {
		return serverError(c, err, "failed to verify registration link")
	}
	if !exists {
		return c.JSON(http.StatusNotFound, errorResponse("registration link not found"))
	}

	var req publicRegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}
	phone, ok := normalizePhone(req.Phone)
	if !ok {
		return c.JSON(http.StatusBadRequest, errorResponse(errPhone))
	}
	req.Phone = phone
	if msg := validatePassword(req.Password, 6); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	hash, err := h.authService.HashPassword(req.Password)
	if err != nil {
		return serverError(c, err, "failed to process password")
	}

	// The front of an ID is the one upload registration insists on. The owner
	// has to be able to say who is living in the building — police tenant
	// verification asks for exactly this — and the person is standing there
	// with a phone at this moment and at no later one. The back and the photo
	// stay optional. Owner-created tenants are not held to this: the owner
	// may have the paper copy in a drawer.
	if req.IDProofFrontURL == "" && req.IDProofURL == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("Add a photo of the front of your ID."))
	}
	// So is someone to call. The owner asked for it on every registration
	// (Oct 2026); like the ID, it is asked at the one moment the person is
	// standing there, and owner-created tenants are not held to it.
	req.EmergencyContactName = strings.TrimSpace(req.EmergencyContactName)
	req.EmergencyContactPhone = strings.TrimSpace(req.EmergencyContactPhone)
	if req.EmergencyContactName == "" || req.EmergencyContactPhone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("Add an emergency contact and their phone."))
	}
	emergency, ok := normalizePhone(req.EmergencyContactPhone)
	if !ok {
		return c.JSON(http.StatusBadRequest, errorResponse(errEmergencyPhone))
	}
	req.EmergencyContactPhone = emergency
	files := []struct {
		name string
		v    string
	}{
		{"id_proof_url", req.IDProofURL},
		{"id_proof_front_url", req.IDProofFrontURL},
		{"id_proof_back_url", req.IDProofBackURL},
		{"photo_url", req.PhotoURL},
	}
	for _, f := range files {
		if !validFileRef(f.v) {
			return c.JSON(http.StatusBadRequest, errorResponse("invalid "+f.name))
		}
	}
	idProofURL := optionalString(req.IDProofURL)
	idProofFrontURL := optionalString(req.IDProofFrontURL)
	idProofBackURL := optionalString(req.IDProofBackURL)
	photoURL := optionalString(req.PhotoURL)

	var address, emergencyName, emergencyPhone, workplace, aadhaar *string
	if req.Address != "" {
		address = &req.Address
	}
	if req.EmergencyContactName != "" {
		emergencyName = &req.EmergencyContactName
	}
	if req.EmergencyContactPhone != "" {
		emergencyPhone = &req.EmergencyContactPhone
	}
	if req.Workplace != "" {
		workplace = &req.Workplace
	}
	if req.AadhaarNumber != "" {
		aadhaar = &req.AadhaarNumber
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`INSERT INTO tenants (owner_id, name, phone, email, password_hash,
			id_proof_url, id_proof_front_url, id_proof_back_url, photo_url,
			address, emergency_contact_name, emergency_contact_phone,
			workplace, aadhaar_number,
			is_approved, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, $15, $15)
		 RETURNING `+tenantCols,
		ownerID, req.Name, req.Phone, req.Email, hash,
		idProofURL, idProofFrontURL, idProofBackURL, photoURL,
		address, emergencyName, emergencyPhone, workplace, aadhaar,
		time.Now(),
	).StructScan(&tenant)
	if err != nil {
		return serverError(c, err, "failed to register")
	}
	return h.respondTenant(c, http.StatusCreated, &tenant)
}

type approveRequest struct {
	// Notes is the owner's own note, written while approving. Nil leaves
	// whatever is there (nothing, for a fresh registration).
	Notes *string `json:"notes"`
}

// Approve puts a pending registration on the owner's books, and that is all
// it does. It once made the stay as well, from a bed and terms in the body,
// which was a second copy of POST /api/stays: the pending queue now approves
// and then makes the stay and records what was paid through the same calls as
// Add tenant, so a bed check or booking rule cannot hold in one and not the
// other (Oct 2026).
func (h *TenantHandler) Approve(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var req approveRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	var notes *string
	if req.Notes != nil {
		if trimmed := strings.TrimSpace(*req.Notes); trimmed != "" {
			notes = &trimmed
		}
	}

	// Only a registration still waiting: approving someone already on the
	// books did nothing useful and answered as if it had.
	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants SET is_approved = true, notes = COALESCE($1, notes), updated_at = $2
		 WHERE id = $3 AND owner_id = $4 AND is_approved = false
		 RETURNING `+tenantCols,
		notes, time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return serverError(c, err, "failed to approve tenant")
		}
		return c.JSON(http.StatusNotFound, errorResponse("pending tenant not found"))
	}
	return h.respondTenant(c, http.StatusOK, &tenant)
}

func (h *TenantHandler) Reject(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	res, err := h.db.Exec(
		`DELETE FROM tenants WHERE id = $1 AND owner_id = $2 AND is_approved = false`,
		tenantID, ownerID,
	)
	if err != nil {
		return serverError(c, err, "failed to reject")
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("pending tenant not found"))
	}
	return c.JSON(http.StatusNoContent, nil)
}

func (h *TenantHandler) Update(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var req tenantRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Name == "" || req.Phone == "" {
		return c.JSON(http.StatusBadRequest, errorResponse("name and phone are required"))
	}
	if msg := req.normalizePhones(); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	if msg := req.invalidFileRef(); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants
		 SET name = $1, phone = $2, email = $3,
		     address = $4, emergency_contact_name = $5, emergency_contact_phone = $6,
		     workplace = $7, aadhaar_number = $8,
		     id_proof_url = COALESCE($9, id_proof_url),
		     id_proof_front_url = COALESCE($10, id_proof_front_url),
		     id_proof_back_url = COALESCE($11, id_proof_back_url),
		     photo_url = COALESCE($12, photo_url),
		     notes = $13,
		     updated_at = $14
		 WHERE id = $15 AND owner_id = $16
		 RETURNING `+tenantCols,
		req.Name, req.Phone, req.Email,
		req.Address, req.EmergencyContactName, req.EmergencyContactPhone,
		req.Workplace, req.AadhaarNumber,
		req.IDProofURL, req.IDProofFrontURL, req.IDProofBackURL, req.PhotoURL,
		req.Notes, time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return h.respondTenant(c, http.StatusOK, &tenant)
}

// Delete removes a tenant and, through ON DELETE CASCADE, every stay,
// payment and settlement they have. Their bed becomes vacant because the stay
// that held it is gone.
//
// This is the one place the app destroys money records, so the guard is on
// the screen: the confirm dialog says how many stays and payments go with the
// tenant before it offers the button. It exists because an owner who added a
// test tenant, or a duplicate, had no way to remove them at all.
//
// Uploaded photos and ID scans stay in the bucket. They are private and
// unreferenced, so nothing can reach them; removing them is noted in
// docs/BACKLOG.md rather than done halfway here.
//
// DELETE /api/tenants/:id
func (h *TenantHandler) Delete(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	res, err := h.db.Exec(`DELETE FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID)
	if err != nil {
		return serverError(c, err, "failed to delete tenant")
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return serverError(c, err, "failed to delete tenant")
	}
	if rows == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "tenant deleted"})
}

type portalPasswordRequest struct {
	Password string `json:"password"`
}

// SetPortalPassword gives an owner-created tenant a way into /my, or resets a
// forgotten one.
//
// Until this existed, `TenantAuthHandler.Login` required a password_hash and
// only the public registration form ever wrote one — so every tenant an owner
// typed in by hand was locked out of the portal permanently, and any
// capability that lived only in the portal was unreachable for them forever
// rather than merely inconvenient. That is the rule this endpoint enforces:
// nothing may be tenant-portal-exclusive.
//
// Deliberately a set, not a change: the owner does not know the old password
// and should not need to. That makes this an owner power over a tenant's
// account, which is why it is owner-scoped like every other write here — the
// UPDATE's `owner_id = $3` is the whole authorisation story.
//
// The minimum matches public registration (6), not owner signup (8): the same
// person ends up typing it, and two minimums for one credential is how the
// bcrypt-72 bug came to exist on two paths at once.
//
// PUT /api/tenants/:id/portal-password
func (h *TenantHandler) SetPortalPassword(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	var req portalPasswordRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid request body"))
	}
	if msg := validatePassword(req.Password, 6); msg != "" {
		return c.JSON(http.StatusBadRequest, errorResponse(msg))
	}

	hash, err := h.authService.HashPassword(req.Password)
	if err != nil {
		return serverError(c, err, "failed to process password")
	}

	var tenant models.Tenant
	err = h.db.QueryRowx(
		`UPDATE tenants SET password_hash = $1, updated_at = $2
		 WHERE id = $3 AND owner_id = $4
		 RETURNING `+tenantCols,
		hash, time.Now(), tenantID, ownerID,
	).StructScan(&tenant)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
		}
		return serverError(c, err, "failed to set portal password")
	}
	return h.respondTenant(c, http.StatusOK, &tenant)
}

// TenantSummary holds aggregate stats for a tenant's stays and payments.
type TenantSummary struct {
	TotalPaid     int64 `json:"total_paid"`
	TotalExpected int64 `json:"total_expected"`
	Balance       int64 `json:"balance"`
	DurationDays  int64 `json:"duration_days"`
	// TotalPaid is rent only, so a deposit recorded on this page never moves
	// it. These say where the deposit went instead: held now (paid, not yet
	// settled), and still to come (agreed on a current stay, not yet paid).
	DepositHeld int64 `json:"deposit_held"`
	DepositDue  int64 `json:"deposit_due"`
	// The current stay's next due rent (due.go). Absent when no stay is open.
	DueDate  *string `json:"due_date,omitempty"`
	DuePaise *int64  `json:"due_paise,omitempty"`
	DueState *string `json:"due_state,omitempty"`
}

// dateOnly strips the time component so day arithmetic isn't skewed by the
// timezone Postgres hands back for a DATE column.
func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// staySummaryRow is one stay's contribution to a tenant's summary.
// SettlementRefund is nil when the stay was never settled.
type staySummaryRow struct {
	StayID           int64      `db:"stay_id"`
	RentAmount       int64      `db:"rent_amount"`
	RentCycle        string     `db:"rent_cycle"`
	StartDate        time.Time  `db:"start_date"`
	EndDate          *time.Time `db:"end_date"`
	Booking          bool       `db:"booking"` // never had a bed: see endedCycles
	TotalPaid        int64      `db:"total_paid"`
	DepositAmount    int64      `db:"deposit_amount"` // agreed at intake
	DepositPaid      int64      `db:"deposit_paid"`   // approved deposit payments
	SettlementRefund *int64     `db:"settlement_refund"`
	// PaidAfterSettlement is money received on the stay since it was settled,
	// which goes against a shortfall — see settledOwed.
	PaidAfterSettlement int64 `db:"paid_after_settlement"`
	// Schedule is the rent over time when it has ever changed (migration
	// 011). Nil means flat at RentAmount.
	Schedule rentSchedule `db:"-"`
}

// computeTenantSummary rolls a tenant's stays into the figures on their page.
//
// TotalPaid and TotalExpected are history and always accumulate. Balance is a
// question about the present — "what does this person still owe me" — and a
// SETTLED stay has already answered it.
//
// That distinction is the bug this function was extracted to fix. Balance used
// to be TotalExpected − TotalPaid across every stay, which meant a tenant who
// settled up — deposit applied, remainder written off, refund zero — still read
// as owing the amount the settlement had just resolved. Collections got it
// right by accident, because it only ever looks at active stays.
//
// The settled case is deliberately asymmetric:
//
//   - refund < 0 — the tenant owed money at the counter, so it counts, less
//     anything they have paid since (settledOwed — the same rule Collections
//     uses, so the tenant page and the chase list agree).
//   - refund > 0 — the OWNER owed the tenant, and recording a settlement is
//     recording that handover. It is not a tenant credit, so it counts as zero
//     rather than making them look "ahead" forever.
//
// Billing cycles use cyclesElapsed so this agrees with the grid and the
// dashboard. Computing it separately in SQL previously made the tenant page
// disagree with the grid about what the same tenant owed.
func computeTenantSummary(stays []staySummaryRow, today time.Time) TenantSummary {
	var summary TenantSummary
	today = dateOnly(today)

	for _, s := range stays {
		start := dateOnly(s.StartDate)
		until := today
		cycles := 0
		if s.EndDate != nil {
			until = dateOnly(*s.EndDate)
			cycles = endedCycles(start, until, s.RentCycle, s.Booking)
		} else {
			cycles = cyclesElapsed(start, until, s.RentCycle)
		}

		sched := s.Schedule
		if len(sched) == 0 {
			sched = flatSchedule(start, s.RentAmount)
		}
		expected := sched.billed(start, s.RentCycle, 0, cycles)
		summary.TotalPaid += s.TotalPaid
		summary.TotalExpected += expected
		if days := int64(until.Sub(start).Hours() / 24); days > 0 {
			summary.DurationDays += days
		}

		if s.SettlementRefund != nil {
			summary.Balance += settledOwed(*s.SettlementRefund, s.PaidAfterSettlement)
			continue
		}
		summary.DepositHeld += s.DepositPaid
		if s.EndDate == nil && s.DepositAmount > s.DepositPaid {
			summary.DepositDue += s.DepositAmount - s.DepositPaid
		}
		if s.EndDate == nil {
			// One open stay per tenant (idx_stays_active_tenant), so this is set
			// at most once.
			if due := dueFor(sched, start, s.RentCycle, s.TotalPaid, today); due.State != "" {
				d := due.Date.Format("2006-01-02")
				summary.DueDate, summary.DuePaise, summary.DueState = &d, &due.Paise, &due.State
			}
		}
		summary.Balance += expected - s.TotalPaid
	}

	return summary
}

func (h *TenantHandler) Summary(c echo.Context) error {
	ownerID := appMiddleware.GetOwnerID(c)
	tenantID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, errorResponse("invalid tenant id"))
	}

	// Verify tenant belongs to owner
	var count int
	if err := h.db.Get(&count, `SELECT COUNT(*) FROM tenants WHERE id = $1 AND owner_id = $2`, tenantID, ownerID); err != nil {
		return serverError(c, err, "failed to compute summary")
	}
	if count == 0 {
		return c.JSON(http.StatusNotFound, errorResponse("tenant not found"))
	}

	summary, err := loadTenantSummary(h.db, tenantID)
	if err != nil {
		return serverError(c, err, "failed to compute summary")
	}
	return c.JSON(http.StatusOK, summary)
}

// loadTenantSummary is the tenant page's money figures. The owner's tenant
// page and the tenant's own portal both read it, so the two can never tell
// one person different amounts. Callers check the tenant is theirs first.
func loadTenantSummary(db *sqlx.DB, tenantID int64) (TenantSummary, error) {
	// One row per stay. Payment totals come from a correlated subquery rather
	// than a JOIN: joining stays to payments yields one row per payment, and
	// summing per-stay values (expected rent, duration) across those rows
	// multiplied them by the payment count.
	//
	// settlements is a plain LEFT JOIN — stay_id is UNIQUE there, so it cannot
	// fan out the way payments would.
	var stays []staySummaryRow
	err := db.Select(&stays, `
		SELECT
			s.id AS stay_id,
			s.rent_amount,
			s.rent_cycle,
			s.start_date,
			s.end_date,
			s.bed_id IS NULL AS booking,
			s.deposit_amount,
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.kind = 'deposit'
			), 0) AS deposit_paid,
			st.refund_paise AS settlement_refund,
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.created_at > st.created_at
			), 0) AS paid_after_settlement,
			COALESCE((
				SELECT SUM(p.amount) FROM payments p
				WHERE p.stay_id = s.id AND p.is_approved = true AND p.kind = 'rent'
			), 0) AS total_paid
		FROM stays s
		LEFT JOIN settlements st ON st.stay_id = s.id
		WHERE s.tenant_id = $1`,
		tenantID,
	)
	if err != nil {
		return TenantSummary{}, err
	}
	stayIDs := make([]int64, len(stays))
	for i := range stays {
		stayIDs[i] = stays[i].StayID
	}
	schedules, err := rentSchedules(db, stayIDs)
	if err != nil {
		return TenantSummary{}, err
	}
	for i := range stays {
		stays[i].Schedule = schedules[stays[i].StayID]
	}

	return computeTenantSummary(stays, dateOnly(time.Now())), nil
}
