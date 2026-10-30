package handlers

import (
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/models"
	"github.com/winnow/hostel/internal/observability"
	"github.com/winnow/hostel/internal/storage"
)

// signedURLTTL is how long a file link handed to a browser keeps working.
//
// An hour, not minutes: an owner opens a tenant, leaves the tab, and taps
// "view ID" later — a link that died in the meantime fails with R2's raw XML
// error page rather than anything of ours. An hour still turns a leaked link
// from "a copy of someone's Aadhaar card for ever" into one that is dead by
// the time anyone finds it in a log.
const signedURLTTL = time.Hour

// validFileRef checks a file reference a client sends back after uploading.
// Empty means "no file". Anything else must be a key the upload handler could
// have issued — never a URL, so a stored reference cannot point the owner's
// browser at another host.
func validFileRef(s string) bool {
	return s == "" || storage.ValidKey(s)
}

// signFiles replaces each stored file reference with a link that expires, in
// place. A reference that is neither a key nor a pre-migration URL of ours is
// dropped rather than passed through: it is not a file we stored, and handing
// it to a browser is exactly what private storage exists to stop.
func signFiles(c echo.Context, s storage.Service, refs ...*string) error {
	for _, ref := range refs {
		if ref == nil || *ref == "" {
			continue
		}
		key, ok := storage.KeyFromStored(*ref)
		if !ok {
			// No row id available here, and the value itself may be the
			// thing worth hiding — so say what happened, not what it was.
			c.Logger().Errorf("dropping a stored file reference that is not an upload key")
			*ref = ""
			continue
		}
		link, err := s.SignedURL(c.Request().Context(), key, signedURLTTL)
		if err != nil {
			return err
		}
		*ref = link
	}
	return nil
}

// signTenant signs every file on a tenant: photo and ID scans.
func signTenant(c echo.Context, s storage.Service, t *models.Tenant) error {
	return signFiles(c, s, t.PhotoURL, t.IDProofURL, t.IDProofFrontURL, t.IDProofBackURL)
}

func signTenants(c echo.Context, s storage.Service, ts []models.Tenant) error {
	for i := range ts {
		if err := signTenant(c, s, &ts[i]); err != nil {
			return err
		}
	}
	return nil
}

// signPayment signs a payment's proof screenshot.
func signPayment(c echo.Context, s storage.Service, p *models.Payment) error {
	return signFiles(c, s, p.ProofURL)
}

func signPayments(c echo.Context, s storage.Service, ps []models.Payment) error {
	for i := range ps {
		if err := signPayment(c, s, &ps[i]); err != nil {
			return err
		}
	}
	return nil
}

// tenantFilesSQL lists every file a tenant's row and payments point at: the
// photo, the ID scans and each payment's proof. $1 is the tenant, $2 the
// owner. Read it before deleting the tenant, since the cascade takes the
// payments with it.
const tenantFilesSQL = `
	SELECT ref FROM (
		SELECT unnest(ARRAY[t.photo_url, t.id_proof_url, t.id_proof_front_url, t.id_proof_back_url]) AS ref
		  FROM tenants t WHERE t.id = $1 AND t.owner_id = $2
		UNION ALL
		SELECT p.proof_url
		  FROM payments p
		  JOIN stays s ON s.id = p.stay_id
		  JOIN tenants t ON t.id = s.tenant_id
		 WHERE t.id = $1 AND t.owner_id = $2
	) files
	WHERE ref IS NOT NULL AND ref <> ''`

// fileInUseSQL asks whether any row still points at a key. It is not scoped
// to an owner on purpose: a key names one object in a bucket every owner
// shares, so the question is whether anyone at all still needs it. Equality
// is enough because migration 010 turned every stored URL into a key.
//
// Every file column is here. A new one must be added, or deleting a file it
// shares with a deleted row would break it.
const fileInUseSQL = `
	SELECT EXISTS (SELECT 1 FROM tenants
	                WHERE $1 IN (photo_url, id_proof_url, id_proof_front_url, id_proof_back_url))
	    OR EXISTS (SELECT 1 FROM payments WHERE proof_url = $1)`

// removeFiles deletes uploaded files whose row is gone: a deleted tenant or
// rejected registration, or a photo or ID scan an edit replaced. Call it
// after the change that dropped the reference has committed.
//
// Deleting a payment needs none of this: only a tenant's payment carries a
// proof, and that is marked not accepted, never deleted. Its proof goes when
// the tenant does.
//
// A file another row still points at is kept. Nothing should share a key,
// but a tenant deleted as a duplicate may have been made from the same
// upload, and guessing wrong would delete someone's ID scan.
//
// It never fails the request. The row is already gone, and a file nothing
// points at cannot be reached, so a failure here is a leftover, not a broken
// screen: it is logged and sent to Sentry, and the request carries on.
func removeFiles(c echo.Context, db *sqlx.DB, s storage.Service, refs ...string) {
	ctx := c.Request().Context()
	seen := map[string]bool{}
	for _, ref := range refs {
		key, ok := storage.KeyFromStored(ref)
		if !ok || seen[key] {
			continue
		}
		seen[key] = true

		var inUse bool
		if err := db.GetContext(ctx, &inUse, fileInUseSQL, key); err != nil {
			reportFileError(c, err, "failed to check whether a file is still in use")
			continue
		}
		if inUse {
			continue
		}
		if err := s.Delete(ctx, key); err != nil {
			reportFileError(c, err, "failed to delete a file")
		}
	}
}

// reportFileError is serverError without the response. The key is random
// hex, never a name or a number, so it is safe in the log line.
func reportFileError(c echo.Context, err error, msg string) {
	c.Logger().Errorf("%s %s — %s: %v", c.Request().Method, c.Path(), msg, err)
	observability.CaptureError(err, c.Request(), c.Request().Method, c.Path(), msg, ownerIDForReport(c))
}

// optionalString maps "" to NULL for an optional text column.
func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
