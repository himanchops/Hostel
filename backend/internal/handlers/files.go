package handlers

import (
	"time"

	"github.com/labstack/echo/v4"
	"github.com/winnow/hostel/internal/models"
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

// optionalString maps "" to NULL for an optional text column.
func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
