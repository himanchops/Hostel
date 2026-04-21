// Bulk import tool for ingesting JSON-encoded ledger data into the hostel DB.
//
// Intended workflow for alpha onboarding:
//   1. Snap a photo of a paper ledger page.
//   2. Paste it into Claude (or any vision LLM) with the prompt at
//      docs/import-prompt.md to get a JSON file matching the schema below.
//   3. Run this CLI to insert tenants, stays, and back-dated payments.
//
// Usage:
//   go run ./cmd/import --owner you@example.com --file ledger-page-1.json
//   go run ./cmd/import --owner you@example.com --file ledger-page-1.json --dry-run
//
// The site referenced by `site_name` must already exist for that owner.
// Rooms (and beds, if `bed_label` is set) must also already exist.
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/joho/godotenv"
	"github.com/winnow/hostel/internal/database"
)

type importFile struct {
	SiteName string         `json:"site_name"`
	Tenants  []importTenant `json:"tenants"`
}

type importTenant struct {
	Name                  string          `json:"name"`
	Phone                 string          `json:"phone"`
	Email                 *string         `json:"email"`
	Address               *string         `json:"address"`
	Workplace             *string         `json:"workplace"`
	EmergencyContactName  *string         `json:"emergency_contact_name"`
	EmergencyContactPhone *string         `json:"emergency_contact_phone"`
	AadhaarNumber         *string         `json:"aadhaar_number"`
	Stay                  *importStay     `json:"stay"`
	Payments              []importPayment `json:"payments"`
}

type importStay struct {
	RoomNumber   string  `json:"room_number"`
	BedLabel     *string `json:"bed_label"`
	RentPaise    int64   `json:"rent_paise"`
	DepositPaise int64   `json:"deposit_paise"`
	RentCycle    string  `json:"rent_cycle"`
	StartDate    string  `json:"start_date"`
}

type importPayment struct {
	Date        string  `json:"date"`
	AmountPaise int64   `json:"amount_paise"`
	Type        string  `json:"type"`
	Note        *string `json:"note"`
}

type stats struct {
	tenantsCreated  int
	tenantsReused   int
	staysCreated    int
	staysSkipped    int
	paymentsAdded   int
	paymentsSkipped int
	tenantErrors    int
}

func main() {
	ownerEmail := flag.String("owner", "", "owner email (must exist)")
	filePath := flag.String("file", "", "path to JSON import file")
	dryRun := flag.Bool("dry-run", false, "parse and validate but don't write")
	flag.Parse()

	if *ownerEmail == "" || *filePath == "" {
		log.Fatal("usage: import --owner <email> --file <path.json> [--dry-run]")
	}

	_ = godotenv.Load()

	dbPort, _ := strconv.Atoi(getEnv("DB_PORT", "5432"))
	db, err := database.Connect(database.Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     dbPort,
		User:     getEnv("DB_USER", "hostel"),
		Password: getEnv("DB_PASSWORD", "hostel_dev"),
		DBName:   getEnv("DB_NAME", "hostel"),
		SSLMode:  getEnv("DB_SSLMODE", "disable"),
	})
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	raw, err := os.ReadFile(*filePath)
	if err != nil {
		log.Fatalf("read file: %v", err)
	}

	var f importFile
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		log.Fatalf("parse json: %v", err)
	}

	var ownerID int64
	err = db.QueryRow("SELECT id FROM owners WHERE email = $1", *ownerEmail).Scan(&ownerID)
	if err != nil {
		log.Fatalf("owner not found for email %q: %v", *ownerEmail, err)
	}

	var siteID int64
	err = db.QueryRow(
		"SELECT id FROM hostel_sites WHERE owner_id = $1 AND name = $2",
		ownerID, f.SiteName,
	).Scan(&siteID)
	if err != nil {
		log.Fatalf("site %q not found for owner %s — create it in the UI first", f.SiteName, *ownerEmail)
	}

	fmt.Printf("Owner: %s (id %d)\n", *ownerEmail, ownerID)
	fmt.Printf("Site:  %s (id %d)\n", f.SiteName, siteID)
	if *dryRun {
		fmt.Println("Mode:  DRY RUN — no writes")
	}
	fmt.Println()

	var st stats
	for _, t := range f.Tenants {
		if err := processTenant(db, ownerID, siteID, t, *dryRun, &st); err != nil {
			fmt.Printf("  ✗ %s: %v\n", t.Name, err)
			st.tenantErrors++
		}
		fmt.Println()
	}

	fmt.Println("─────────── Summary ───────────")
	fmt.Printf("Tenants created:   %d\n", st.tenantsCreated)
	fmt.Printf("Tenants reused:    %d\n", st.tenantsReused)
	fmt.Printf("Stays created:     %d\n", st.staysCreated)
	fmt.Printf("Stays skipped:     %d (active stay already exists)\n", st.staysSkipped)
	fmt.Printf("Payments added:    %d\n", st.paymentsAdded)
	fmt.Printf("Payments skipped:  %d (duplicates)\n", st.paymentsSkipped)
	fmt.Printf("Tenant errors:     %d\n", st.tenantErrors)
}

func processTenant(db *sqlx.DB, ownerID, siteID int64, t importTenant, dryRun bool, st *stats) error {
	t.Name = strings.TrimSpace(t.Name)
	t.Phone = strings.TrimSpace(t.Phone)
	if t.Name == "" || t.Phone == "" {
		return errors.New("name and phone required")
	}

	fmt.Printf("Tenant: %s (%s)\n", t.Name, t.Phone)

	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// 1. Find or create tenant by (owner_id, phone).
	var tenantID int64
	err = tx.QueryRow(
		"SELECT id FROM tenants WHERE owner_id = $1 AND phone = $2",
		ownerID, t.Phone,
	).Scan(&tenantID)

	switch {
	case err == sql.ErrNoRows:
		now := time.Now()
		err = tx.QueryRow(
			`INSERT INTO tenants (owner_id, name, phone, email, address,
			    emergency_contact_name, emergency_contact_phone, workplace, aadhaar_number,
			    is_approved, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $10)
			 RETURNING id`,
			ownerID, t.Name, t.Phone, derefOrEmpty(t.Email),
			t.Address, t.EmergencyContactName, t.EmergencyContactPhone,
			t.Workplace, t.AadhaarNumber, now,
		).Scan(&tenantID)
		if err != nil {
			return fmt.Errorf("insert tenant: %w", err)
		}
		fmt.Printf("  ✓ Created tenant id %d\n", tenantID)
		st.tenantsCreated++
	case err != nil:
		return fmt.Errorf("lookup tenant: %w", err)
	default:
		fmt.Printf("  → Tenant exists (id %d), reusing\n", tenantID)
		st.tenantsReused++
	}

	// 2. Optionally create a stay.
	var stayID int64
	var hasStay bool
	if t.Stay != nil {
		// Check for existing active stay first.
		var activeStayID int64
		err := tx.QueryRow(
			"SELECT id FROM stays WHERE tenant_id = $1 AND end_date IS NULL ORDER BY id DESC LIMIT 1",
			tenantID,
		).Scan(&activeStayID)
		if err == nil {
			fmt.Printf("  ! Active stay id %d already exists, skipping stay creation\n", activeStayID)
			stayID = activeStayID
			hasStay = true
			st.staysSkipped++
		} else if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check active stay: %w", err)
		} else {
			newID, err := createStay(tx, siteID, tenantID, *t.Stay)
			if err != nil {
				return fmt.Errorf("create stay: %w", err)
			}
			stayID = newID
			hasStay = true
			fmt.Printf("  ✓ Created stay id %d\n", stayID)
			st.staysCreated++
		}
	}

	// 3. Insert payments. If no stay was provided in JSON, fall back to the most recent stay.
	if len(t.Payments) > 0 {
		if !hasStay {
			err := tx.QueryRow(
				`SELECT id FROM stays WHERE tenant_id = $1
				 ORDER BY (end_date IS NULL) DESC, start_date DESC LIMIT 1`,
				tenantID,
			).Scan(&stayID)
			if err != nil {
				return fmt.Errorf("payments require a stay but none exists for tenant: %w", err)
			}
		}

		for i, p := range t.Payments {
			added, err := insertPayment(tx, stayID, p)
			if err != nil {
				return fmt.Errorf("payment[%d]: %w", i, err)
			}
			if added {
				st.paymentsAdded++
			} else {
				st.paymentsSkipped++
			}
		}
		fmt.Printf("  ✓ Payments processed: %d total in JSON\n", len(t.Payments))
	}

	if dryRun {
		// Roll back happens via defer.
		return nil
	}
	return tx.Commit()
}

func createStay(tx *sqlx.Tx, siteID, tenantID int64, s importStay) (int64, error) {
	if s.RoomNumber == "" {
		return 0, errors.New("stay.room_number required")
	}
	if s.RentPaise <= 0 {
		return 0, errors.New("stay.rent_paise must be > 0")
	}
	cycle := s.RentCycle
	if cycle == "" {
		cycle = "monthly"
	}
	if cycle != "daily" && cycle != "weekly" && cycle != "monthly" {
		return 0, fmt.Errorf("invalid rent_cycle %q", cycle)
	}
	if s.StartDate == "" {
		return 0, errors.New("stay.start_date required (YYYY-MM-DD)")
	}
	startDate, err := time.Parse("2006-01-02", s.StartDate)
	if err != nil {
		return 0, fmt.Errorf("invalid start_date: %w", err)
	}

	// Resolve room.
	var roomID int64
	err = tx.QueryRow(
		"SELECT id FROM rooms WHERE site_id = $1 AND name = $2",
		siteID, s.RoomNumber,
	).Scan(&roomID)
	if err != nil {
		return 0, fmt.Errorf("room %q not found at this site (create it in the UI)", s.RoomNumber)
	}

	// Resolve bed (optional).
	var bedID *int64
	if s.BedLabel != nil && *s.BedLabel != "" {
		var id int64
		err = tx.QueryRow(
			"SELECT id FROM beds WHERE room_id = $1 AND name = $2",
			roomID, *s.BedLabel,
		).Scan(&id)
		if err != nil {
			return 0, fmt.Errorf("bed %q not found in room %q", *s.BedLabel, s.RoomNumber)
		}

		// Bed must be free.
		var occupied int
		_ = tx.Get(&occupied, "SELECT COUNT(*) FROM stays WHERE bed_id = $1 AND end_date IS NULL", id)
		if occupied > 0 {
			return 0, fmt.Errorf("bed %q in room %q is already occupied", *s.BedLabel, s.RoomNumber)
		}
		bedID = &id
	}

	now := time.Now()
	var newID int64
	err = tx.QueryRow(
		`INSERT INTO stays (tenant_id, bed_id, rent_amount, deposit_amount, rent_cycle, rent_due_day,
		    start_date, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		 RETURNING id`,
		tenantID, bedID, s.RentPaise, s.DepositPaise, cycle, 1, startDate, now,
	).Scan(&newID)
	if err != nil {
		return 0, err
	}
	return newID, nil
}

// insertPayment dedups on (stay_id, payment_date, amount, payment_type) so
// re-running an import doesn't double-insert.
func insertPayment(tx *sqlx.Tx, stayID int64, p importPayment) (bool, error) {
	if p.Date == "" {
		return false, errors.New("payment.date required (YYYY-MM-DD)")
	}
	if p.AmountPaise <= 0 {
		return false, errors.New("payment.amount_paise must be > 0")
	}
	date, err := time.Parse("2006-01-02", p.Date)
	if err != nil {
		return false, fmt.Errorf("invalid date: %w", err)
	}
	pType := p.Type
	if pType == "" {
		pType = "cash"
	}
	if pType != "cash" && pType != "online" {
		return false, fmt.Errorf("invalid payment.type %q", pType)
	}

	var dup int
	err = tx.Get(&dup,
		`SELECT COUNT(*) FROM payments
		 WHERE stay_id = $1 AND payment_date = $2 AND amount = $3 AND payment_type = $4`,
		stayID, date, p.AmountPaise, pType,
	)
	if err != nil {
		return false, fmt.Errorf("dedup check: %w", err)
	}
	if dup > 0 {
		return false, nil
	}

	_, err = tx.Exec(
		`INSERT INTO payments (stay_id, amount, payment_type, payment_date, notes, is_approved, created_at)
		 VALUES ($1, $2, $3, $4, $5, true, NOW())`,
		stayID, p.AmountPaise, pType, date, p.Note,
	)
	if err != nil {
		return false, err
	}
	return true, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
