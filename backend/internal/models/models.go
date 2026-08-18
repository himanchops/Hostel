package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// Owner represents a hostel/PG owner (tenant in multi-tenant sense)
type Owner struct {
	ID           int64     `db:"id" json:"id"`
	Email        string    `db:"email" json:"email"`
	PasswordHash string    `db:"password_hash" json:"-"`
	Name         string    `db:"name" json:"name"`
	Phone        string    `db:"phone" json:"phone,omitempty"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}

// HostelSite represents a hostel/PG property owned by an owner
type HostelSite struct {
	ID        int64     `db:"id" json:"id"`
	OwnerID   int64     `db:"owner_id" json:"owner_id"`
	Name      string    `db:"name" json:"name"`
	Address   string    `db:"address" json:"address,omitempty"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// Room represents a room within a hostel site
type Room struct {
	ID        int64     `db:"id" json:"id"`
	SiteID    int64     `db:"site_id" json:"site_id"`
	Name      string    `db:"name" json:"name"` // e.g., "Room 101", "A1"
	Floor     int       `db:"floor" json:"floor,omitempty"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// Bed represents a bed within a room
type Bed struct {
	ID        int64     `db:"id" json:"id"`
	RoomID    int64     `db:"room_id" json:"room_id"`
	Name      string    `db:"name" json:"name"` // e.g., "Bed A", "Lower Bunk"
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// RentCycle defines the billing frequency
type RentCycle string

const (
	RentCycleDaily   RentCycle = "daily"
	RentCycleWeekly  RentCycle = "weekly"
	RentCycleMonthly RentCycle = "monthly"
)

// Tenant represents a person renting a bed
type Tenant struct {
	ID                    int64     `db:"id" json:"id"`
	OwnerID               int64     `db:"owner_id" json:"owner_id"` // For multi-tenant isolation
	Name                  string    `db:"name" json:"name"`
	Phone                 string    `db:"phone" json:"phone"`
	Email                 string    `db:"email" json:"email,omitempty"`
	IDProofURL            *string   `db:"id_proof_url" json:"id_proof_url,omitempty"`
	PhotoURL              *string   `db:"photo_url" json:"photo_url,omitempty"`
	Address               *string   `db:"address" json:"address,omitempty"`
	EmergencyContactName  *string   `db:"emergency_contact_name" json:"emergency_contact_name,omitempty"`
	EmergencyContactPhone *string   `db:"emergency_contact_phone" json:"emergency_contact_phone,omitempty"`
	Workplace             *string   `db:"workplace" json:"workplace,omitempty"`
	AadhaarNumber         *string   `db:"aadhaar_number" json:"aadhaar_number,omitempty"`
	IDProofFrontURL       *string   `db:"id_proof_front_url" json:"id_proof_front_url,omitempty"`
	IDProofBackURL        *string   `db:"id_proof_back_url" json:"id_proof_back_url,omitempty"`
	PasswordHash          string    `db:"password_hash" json:"-"`
	IsApproved            bool      `db:"is_approved" json:"is_approved"`
	CreatedAt             time.Time `db:"created_at" json:"created_at"`
	UpdatedAt             time.Time `db:"updated_at" json:"updated_at"`
}

// Stay represents a tenant's occupancy of a bed
type Stay struct {
	ID            int64      `db:"id" json:"id"`
	TenantID      int64      `db:"tenant_id" json:"tenant_id"`
	BedID         *int64     `db:"bed_id" json:"bed_id"`                 // Null if pending bed assignment
	RentAmount    int64      `db:"rent_amount" json:"rent_amount"`       // In paise (INR * 100)
	DepositAmount int64      `db:"deposit_amount" json:"deposit_amount"` // In paise
	RentCycle     RentCycle  `db:"rent_cycle" json:"rent_cycle"`
	StartDate     time.Time  `db:"start_date" json:"start_date"`
	EndDate       *time.Time `db:"end_date" json:"end_date,omitempty"`       // Null if ongoing
	NoticeDate    *time.Time `db:"notice_date" json:"notice_date,omitempty"` // When tenant gave notice
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
}

// PaymentType defines how the payment was made
type PaymentType string

const (
	PaymentTypeCash   PaymentType = "cash"
	PaymentTypeOnline PaymentType = "online"
)

// Payment represents a payment made by a tenant
type Payment struct {
	ID          int64       `db:"id" json:"id"`
	StayID      int64       `db:"stay_id" json:"stay_id"`
	Amount      int64       `db:"amount" json:"amount"` // In paise
	PaymentType PaymentType `db:"payment_type" json:"payment_type"`
	PaymentDate time.Time   `db:"payment_date" json:"payment_date"`
	ProofURL    *string     `db:"proof_url" json:"proof_url,omitempty"`
	Notes       *string     `db:"notes" json:"notes,omitempty"`
	IsApproved  bool        `db:"is_approved" json:"is_approved"` // For tenant-submitted proofs
	CreatedAt   time.Time   `db:"created_at" json:"created_at"`
}

// Adjustment is one manual line on a settlement — something the arithmetic
// cannot know about: a damaged chair, an unpaid electricity share, a goodwill
// discount.
//
// Sign convention: NEGATIVE reduces the refund (a deduction from the tenant),
// POSITIVE increases it (a credit to them). That reads the way the owner says
// it out loud — "minus five hundred for the chair".
type Adjustment struct {
	Label       string `json:"label"`
	AmountPaise int64  `json:"amount_paise"`
}

// Adjustments is the JSONB column. Postgres hands it back as bytes, so it
// needs its own Scan/Value rather than relying on sqlx's defaults.
type Adjustments []Adjustment

func (a *Adjustments) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*a = Adjustments{}
		return nil
	case []byte:
		return json.Unmarshal(v, a)
	case string:
		return json.Unmarshal([]byte(v), a)
	}
	return fmt.Errorf("cannot scan %T into Adjustments", src)
}

func (a Adjustments) Value() (driver.Value, error) {
	if a == nil {
		return []byte("[]"), nil
	}
	return json.Marshal(a)
}

// Settlement is the final money reckoning when a tenant moves out.
//
// DepositPaise and DuesPaise are snapshots taken when the settlement was
// recorded — see migration 005. RefundPaise is negative when the tenant owes
// the owner rather than the other way round.
type Settlement struct {
	ID           int64 `db:"id" json:"id"`
	StayID       int64 `db:"stay_id" json:"stay_id"`
	DepositPaise int64 `db:"deposit_paise" json:"deposit_paise"`
	DuesPaise    int64 `db:"dues_paise" json:"dues_paise"`
	// AdvanceReturnedPaise records how much of a rent advance went back to the
	// tenant. Whether that is all of it, some, or none is the owner's decision
	// at the counter rather than a rule this app gets to make, so the number is
	// stored rather than derived. Always 0 when DuesPaise >= 0.
	AdvanceReturnedPaise int64       `db:"advance_returned_paise" json:"advance_returned_paise"`
	Adjustments          Adjustments `db:"adjustments" json:"adjustments"`
	RefundPaise          int64       `db:"refund_paise" json:"refund_paise"`
	Notes                *string     `db:"notes" json:"notes,omitempty"`
	CreatedAt            time.Time   `db:"created_at" json:"created_at"`
}
