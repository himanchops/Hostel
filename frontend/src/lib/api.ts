import type { Due, DueState } from "./due";
import { shrinkImage } from "@/lib/shrinkImage";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Fired on window when an owner request comes back 401: the token expired,
 * or was revoked by a password change or "sign out everywhere" elsewhere.
 * The signed-in layout listens and offers to sign in again in place.
 */
export const OWNER_SESSION_ENDED = "hostel:owner-session-ended";

/**
 * What a form shows when its save failed for that reason. The server's own
 * words were "invalid token", which is true and useless — and the audit's
 * tester reloaded to escape it, losing a half-typed tenant profile (M10).
 */
export const SESSION_ENDED_MESSAGE =
  "You were signed out. Sign in again and save once more — what you typed is still here.";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    // Every 401 under /api/ is the session, never the request: a wrong
    // current password on change-password is a 400. Login itself lives under
    // /auth/, so a mistyped password there still reads as one.
    if (res.status === 401 && token && path.startsWith("/api/")) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(OWNER_SESSION_ENDED));
      throw new ApiError(401, SESSION_ENDED_MESSAGE);
    }
    throw new ApiError(res.status, body.error || "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface Owner {
  id: number;
  email: string;
  name: string;
  phone?: string;
  /** Where tenants pay; WhatsApp reminders add it (migration 015). */
  upi_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  owner: Owner;
}

export const authApi = {
  signup: (data: { name: string; email: string; password: string; phone?: string }) =>
    request<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  me: (token: string) => request<Owner>("/api/me", {}, token),

  /**
   * Returns a fresh token. The change revokes every token issued before it,
   * this device's included, so the caller must swap the new one in or be
   * signed out on its next request.
   */
  changePassword: (token: string, data: { current_password: string; new_password: string }) =>
    request<{ token: string }>("/api/me/password", { method: "PUT", body: JSON.stringify(data) }, token),

  /** Sets the UPI ID reminders carry; "" clears it. */
  setUpi: (token: string, upi_id: string) =>
    request<{ upi_id: string | null }>("/api/me/upi", { method: "PUT", body: JSON.stringify({ upi_id }) }, token),

  /** Revokes every token this owner holds — the caller's too. */
  signOutEverywhere: (token: string) =>
    request<void>("/api/me/sign-out-everywhere", { method: "POST" }, token),
};

// ─── Sites ───────────────────────────────────────────────────────────────────

export interface Site {
  id: number;
  owner_id: number;
  name: string;
  address?: string;
  created_at: string;
  updated_at: string;
}

export const sitesApi = {
  list: (token: string) => request<Site[]>("/api/sites", {}, token),
  get: (token: string, id: number) => request<Site>(`/api/sites/${id}`, {}, token),
  create: (token: string, data: { name: string; address?: string }) =>
    request<Site>("/api/sites", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: number, data: { name: string; address?: string }) =>
    request<Site>(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  delete: (token: string, id: number) =>
    request<void>(`/api/sites/${id}`, { method: "DELETE" }, token),
};

// ─── Rooms ───────────────────────────────────────────────────────────────────

export interface Room {
  id: number;
  site_id: number;
  name: string;
  floor: number;
  /**
   * What a delete would destroy, aggregated across the room's beds. Any stay
   * at all — ended or not — makes the room undeletable, so `stay_count === 0`
   * is the whole test. Present on every Room the API returns, including the
   * one a rename hands back, so it is always safe to trust.
   */
  stay_count: number;
  payment_count: number;
  created_at: string;
  updated_at: string;
}

export const roomsApi = {
  list: (token: string, siteId: number) =>
    request<Room[]>(`/api/sites/${siteId}/rooms`, {}, token),
  create: (token: string, siteId: number, data: { name: string; floor?: number }) =>
    request<Room>(`/api/sites/${siteId}/rooms`, { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, siteId: number, id: number, data: { name: string; floor?: number }) =>
    request<Room>(`/api/sites/${siteId}/rooms/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  delete: (token: string, siteId: number, id: number) =>
    request<void>(`/api/sites/${siteId}/rooms/${id}`, { method: "DELETE" }, token),
};

// ─── Beds ────────────────────────────────────────────────────────────────────

export interface Bed {
  id: number;
  room_id: number;
  name: string;
  /** The same footprint as Room's, for this bed alone. */
  stay_count: number;
  payment_count: number;
  created_at: string;
  updated_at: string;
}

export const bedsApi = {
  list: (token: string, siteId: number, roomId: number) =>
    request<Bed[]>(`/api/sites/${siteId}/rooms/${roomId}/beds`, {}, token),
  create: (token: string, siteId: number, roomId: number, data: { name: string }) =>
    request<Bed>(`/api/sites/${siteId}/rooms/${roomId}/beds`, { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, siteId: number, roomId: number, id: number, data: { name: string }) =>
    request<Bed>(`/api/sites/${siteId}/rooms/${roomId}/beds/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  delete: (token: string, siteId: number, roomId: number, id: number) =>
    request<void>(`/api/sites/${siteId}/rooms/${roomId}/beds/${id}`, { method: "DELETE" }, token),
};

// ─── Grid ────────────────────────────────────────────────────────────────────

export type BedStatus = "vacant" | "paid" | "partial" | "overdue" | "vacating_soon" | "departure_due";

export interface GridTenant {
  id: number;
  name: string;
  phone: string;
}

export interface GridBed {
  id: number;
  name: string;
  status: BedStatus;
  stay_id?: number;
  tenant?: GridTenant;
  rent_amount?: number;   // paise, the rent of the cycle billed now
  rent_cycle?: "daily" | "weekly" | "monthly";
  deposit_amount?: number; // paise
  total_paid?: number;    // paise
  total_expected?: number; // paise
  balance?: number;       // paise — negative = owes money
  start_date?: string;
  end_date?: string;
  notice_date?: string;
  expected_end_date?: string;
  /** When rent is next due (handlers/due.go); worded by lib/due.ts. */
  due_date?: string;
  due_paise?: number;
  due_state?: DueState;
}

export interface GridRoom {
  id: number;
  name: string;
  floor: number;
  beds: GridBed[];
}

export const gridApi = {
  get: (token: string, siteId: number) =>
    request<GridRoom[]>(`/api/sites/${siteId}/grid`, {}, token),
};

// ─── Tenants ─────────────────────────────────────────────────────────────────

export interface Tenant {
  /** The tenant list only: when their last stay ended, if none is open. */
  left_on?: string;
  id: number;
  owner_id: number;
  name: string;
  phone: string;
  email?: string;
  id_proof_url?: string;
  photo_url?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  workplace?: string;
  aadhaar_number?: string;
  id_proof_front_url?: string;
  id_proof_back_url?: string;
  /** The owner's own notes. Never sent to the tenant portal (migration 012). */
  notes?: string;
  /**
   * Whether this person can sign in at /my at all. Computed server-side from
   * the password hash, which never leaves the backend. False for every tenant
   * an owner typed in by hand until the owner sets one.
   */
  has_portal_login: boolean;
  /** Only on the tenant's own sign-in and /tenant/me: what the portal header calls the place. */
  hostel_name?: string;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantUpdateData {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  workplace?: string;
  aadhaar_number?: string;
  notes?: string;
  id_proof_url?: string;
  id_proof_front_url?: string;
  id_proof_back_url?: string;
  photo_url?: string;
}

export interface TenantSummary {
  total_paid: number;      // paise
  total_expected: number;  // paise
  balance: number;         // paise (positive = owes)
  duration_days: number;
  /** total_paid is rent only. Deposit paid and not yet settled: */
  deposit_held: number;    // paise
  /** Deposit agreed on a current stay and not yet paid: */
  deposit_due: number;     // paise
  /** The current stay's next due rent; absent when no stay is open. */
  due_date?: string;
  due_paise?: number;
  due_state?: DueState;
  /** Each stay that makes up balance, so "Let some go…" knows which. */
  owing: StayOwed[];
}

export interface StayOwed {
  stay_id: number;
  owed: number;     // paise
  /** A settlement's shortfall: they have left. */
  settled: boolean;
}

/**
 * Rent the owner let go (migration 017). Never a payment: it comes off what
 * they owe, oldest month first, and never counts as collected.
 */
export interface LetGo {
  id: number;
  stay_id: number;
  amount: number;    // paise
  for_month: string; // the month it came off
  notes?: string;
  created_at: string;
  /** A settlement was worked out from it; undo that to take it back. */
  settled: boolean;
}

export const letGoApi = {
  list: (token: string, stayId: number) => request<LetGo[]>(`/api/stays/${stayId}/let-go`, {}, token),
  create: (token: string, stayId: number, data: { amount: number; notes?: string }) =>
    request<LetGo>(`/api/stays/${stayId}/let-go`, { method: "POST", body: JSON.stringify(data) }, token),
  /** They owe it again. */
  takeBack: (token: string, id: number) => request<void>(`/api/let-go/${id}`, { method: "DELETE" }, token),
};

export const tenantsApi = {
  list: (token: string, pending?: boolean) =>
    request<Tenant[]>(`/api/tenants${pending ? "?pending=true" : ""}`, {}, token),
  get: (token: string, id: number) => request<Tenant>(`/api/tenants/${id}`, {}, token),
  create: (token: string, data: TenantUpdateData) =>
    request<Tenant>("/api/tenants", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: number, data: TenantUpdateData) =>
    request<Tenant>(`/api/tenants/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  /** Puts a pending registration on the books. The stay, if any, is made
   *  afterwards with staysApi.create, the same way Add tenant does it. */
  approve: (token: string, id: number, data: { notes?: string } = {}) => request<Tenant>(`/api/tenants/${id}/approve`, { method: "POST", body: JSON.stringify(data) }, token),
  reject: (token: string, id: number) =>
    request<void>(`/api/tenants/${id}/reject`, { method: "DELETE" }, token),
  /** Permanently deletes the tenant with every stay, payment and settlement. */
  delete: (token: string, id: number) =>
    request<{ message: string }>(`/api/tenants/${id}`, { method: "DELETE" }, token),
  stays: (token: string, id: number) =>
    request<Stay[]>(`/api/tenants/${id}/stays`, {}, token),
  summary: (token: string, id: number) =>
    request<TenantSummary>(`/api/tenants/${id}/summary`, {}, token),

  /**
   * Set or reset this tenant's portal password.
   *
   * A set, not a change — the owner never knew the old one. This is the only
   * way a tenant the owner created by hand ever gets into /my, and therefore
   * the only thing keeping portal-only capabilities from being unreachable
   * for them.
   */
  setPortalPassword: (token: string, id: number, password: string) =>
    request<Tenant>(
      `/api/tenants/${id}/portal-password`,
      { method: "PUT", body: JSON.stringify({ password }) },
      token,
    ),
};

// ─── File Uploads ─────────────────────────────────────────────────────────────

async function uploadFile(endpoint: string, file: File, token?: string): Promise<string> {
  const form = new FormData();
  // Every upload passes through here, so this one line covers registration,
  // the owner's forms and payment proofs alike. See shrinkImage.ts.
  form.append("file", await shrinkImage(file));
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new ApiError(res.status, body.error || "Upload failed");
  }
  // A storage key, not a link: uploads are private. The caller sends it back
  // in the registration or payment; the server returns an expiring link
  // whenever the file is read.
  const { key } = await res.json();
  return key as string;
}

export const uploadApi = {
  /** Upload a file (no auth required) — used for tenant self-registration. */
  publicUpload: (file: File) => uploadFile("/public/upload", file),
  /** Upload a payment proof screenshot from the tenant portal. */
  tenantUpload: (file: File, token: string) => uploadFile("/tenant/upload", file, token),
};

// ─── Public Registration ──────────────────────────────────────────────────────

export interface PublicRegisterData {
  name: string;
  phone: string;
  email?: string;
  password: string;
  id_proof_url?: string;        // legacy
  id_proof_front_url?: string;
  id_proof_back_url?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  workplace?: string;
  aadhaar_number?: string;
  photo_url?: string;
}

export const registrationApi = {
  register: (ownerId: number, data: PublicRegisterData) =>
    request<Tenant>(`/public/register/${ownerId}`, { method: "POST", body: JSON.stringify(data) }),

  /**
   * The property's name, for the registration page header. Name only by
   * design — owner ids are enumerable, so this must not grow contact details.
   */
  owner: (ownerId: number) =>
    request<{ name: string }>(`/public/owners/${ownerId}`),
};

// ─── Tenant Auth ──────────────────────────────────────────────────────────────

export interface TenantAuthResponse {
  token: string;
  tenant: Tenant;
}

export const tenantAuthApi = {
  login: (data: { phone: string; password: string }) =>
    request<TenantAuthResponse>("/tenant-auth/login", { method: "POST", body: JSON.stringify(data) }),
  me: (token: string) => request<Tenant>("/tenant/me", {}, token),
};

// ─── Tenant Portal ────────────────────────────────────────────────────────────

export interface TenantStay {
  id: number;
  bed_id?: number;
  bed_name: string;
  room_name: string;
  site_name: string;
  rent_amount: number;
  deposit_amount: number;
  rent_cycle: "daily" | "weekly" | "monthly";
  start_date: string;
  end_date?: string;
  notice_date?: string;
  expected_end_date?: string;
  created_at: string;
  payments: Payment[];
}

export const tenantPortalApi = {
  stays: (token: string) => request<TenantStay[]>("/tenant/stays", {}, token),
  /** The same figures the owner sees on this tenant's page. */
  summary: (token: string) => request<TenantSummary>("/tenant/summary", {}, token),
  submitPayment: (token: string, stayId: number, data: { amount: number; payment_type: "cash" | "online"; notes?: string; proof_url?: string }) =>
    request<Payment>(`/tenant/stays/${stayId}/payments`, { method: "POST", body: JSON.stringify(data) }, token),
  /** `expectedEndDate` is optional — a tenant may know they are going without
   *  knowing exactly when. Omitted leaves any existing date untouched. */
  submitNotice: (token: string, stayId: number, expectedEndDate?: string) =>
    request<Stay>(
      `/tenant/stays/${stayId}/notice`,
      { method: "PUT", body: JSON.stringify({ expected_end_date: expectedEndDate ?? "" }) },
      token,
    ),
  /** Takes the notice back, both dates, like the owner's "They're staying". */
  withdrawNotice: (token: string, stayId: number) =>
    request<Stay>(`/tenant/stays/${stayId}/notice`, { method: "DELETE" }, token),
};

// ─── Pending Payments (owner) ─────────────────────────────────────────────────

export interface PendingPayment extends Payment {
  tenant_name: string;
  bed_name: string;
  room_name: string;
  site_name: string;
}

export const pendingPaymentsApi = {
  list: (token: string) => request<PendingPayment[]>("/api/payments/pending", {}, token),
  approve: (token: string, id: number) =>
    request<void>(`/api/payments/${id}/approve`, { method: "POST", body: JSON.stringify({}) }, token),
  /** Marks a proof "not accepted", with a reason the tenant can read. Never deletes. */
  reject: (token: string, id: number, reason: string) =>
    request<Payment>(`/api/payments/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }, token),
};

// ─── Stays ───────────────────────────────────────────────────────────────────

export interface Stay {
  id: number;
  tenant_id: number;
  bed_id: number | null;  // null = pending bed assignment
  rent_amount: number;   // paise
  deposit_amount: number; // paise
  rent_cycle: "daily" | "weekly" | "monthly";
  start_date: string;
  end_date?: string;
  notice_date?: string;
  expected_end_date?: string;
  created_at: string;
  updated_at: string;
  /**
   * Where the stay is. Only the tenant's stay list sends these — every other
   * stay endpoint returns the bare row — and they are null while the stay is
   * waiting for a bed. A screen that patches a stay from another endpoint's
   * response keeps them with `withPlace`.
   */
  site_name?: string | null;
  room_name?: string | null;
  bed_name?: string | null;
  /**
   * The rent over time, oldest first, when it has ever changed from a date
   * (migration 011). The first entry is the original rent from move-in.
   * Absent when the rent never changed — rent_amount is then the whole story.
   */
  rent_changes?: RentChange[];
  /**
   * Every move to another bed during the stay, oldest first (migration 014).
   * Only the tenant's stay list and a move's response send it.
   */
  moves?: StayMove[];
}

/**
 * A rent change as the owner says it: from next cycle the rent is next_rent,
 * and this cycle they pay the old rent, the new rent, or an agreed amount
 * (handlers/rentplan.go). Amounts in paise.
 */
export interface RentPlan {
  next_rent: number;
  this_cycle: "old" | "new" | "agreed";
  agreed?: number;
}

/** What a rent change will mean, worked out by the server. Paise. */
export interface RentPreview {
  this_start: string;
  this_end: string;
  next_start: string;
  this_rent: number;
  next_rent: number;
  /** How much of this cycle's rent is already paid. */
  paid_this: number;
  /** Billed so far less paid: positive is owed now, negative paid ahead. */
  balance: number;
}

/** One move to another bed. Names are null for a bed deleted since. */
export interface StayMove {
  moved_on: string;
  from_bed_id: number | null;
  from_room_name: string | null;
  from_bed_name: string | null;
  to_bed_id: number | null;
  to_room_name: string | null;
  to_bed_name: string | null;
}

export interface RentChange {
  effective_date: string;
  rent_amount: number; // paise
}

/**
 * `updated` with the place names carried over from `previous`, for replacing a
 * listed stay with another endpoint's response.
 *
 * Not `{ ...previous, ...updated }`: the stay endpoints omit empty dates from
 * their JSON, so a date that was just cleared is absent from `updated`, and the
 * spread would bring the old one back. "They're staying" did exactly that.
 */
export function withPlace(updated: Stay, previous: Stay): Stay {
  return { ...updated, site_name: previous.site_name, room_name: previous.room_name, bed_name: previous.bed_name };
}

export const staysApi = {
  create: (token: string, data: {
    tenant_id: number;
    bed_id?: number;      // optional: null = pending assignment
    rent_amount: number;
    deposit_amount: number;
    rent_cycle: string;
    start_date: string;
  }) => request<Stay>("/api/stays", { method: "POST", body: JSON.stringify(data) }, token),

  update: (
    token: string,
    id: number,
    /**
     * Three different dates, and they mean three different things:
     * notice_date is when they told you, expected_end_date is when they say
     * they are going, end_date is when they actually went. Only the last one
     * ends the stay. null clears a field. start_date moves the move-in day,
     * as when someone who booked arrives early or late.
     */
    data: {
      start_date?: string;
      end_date?: string | null;
      notice_date?: string | null;
      expected_end_date?: string | null;
    },
  ) =>
    request<Stay>(`/api/stays/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),

  /**
   * New rent from a date. Cycles that began before it keep the rent they were
   * billed at. This is the everyday way to change rent.
   */
  changeRent: (token: string, id: number, data: { rent_amount: number; effective_date: string }) =>
    request<Stay>(`/api/stays/${id}/rent-changes`, { method: "POST", body: JSON.stringify(data) }, token),

  /**
   * The rent was entered wrong: bill the whole stay, from move-in, at this
   * figure, discarding any changes from a date. Not for a rent rise.
   */
  correctRent: (token: string, id: number, rentAmount: number) =>
    request<Stay>(`/api/stays/${id}`, { method: "PUT", body: JSON.stringify({ rent_amount: rentAmount }) }, token),

  get: (token: string, id: number) => request<Stay>(`/api/stays/${id}`, {}, token),

  /**
   * Move an active stay to another bed. The stay carries on. With a rent
   * plan, "this cycle" is the one the move day falls in. A second move on
   * the same day corrects the first.
   */
  move: (token: string, stayId: number, data: { bed_id: number; moved_on: string; rent?: RentPlan }) =>
    request<Stay>(`/api/stays/${stayId}/move`, { method: "POST", body: JSON.stringify(data) }, token),

  /** Change rent the owner's way, from today. */
  setRent: (token: string, stayId: number, plan: RentPlan) =>
    request<Stay>(`/api/stays/${stayId}/rent`, { method: "POST", body: JSON.stringify(plan) }, token),

  /** What a rent plan would mean, changing nothing. No plan: the rent as it stands. */
  rentPreview: (token: string, stayId: number, refDate: string, plan?: RentPlan) =>
    request<RentPreview>(`/api/stays/${stayId}/rent-preview`, {
      method: "POST", body: JSON.stringify({ ref_date: refDate, ...plan }),
    }, token),

  assignBed: (token: string, stayId: number, data: { bed_id: number }) =>
    request<Stay>(`/api/stays/${stayId}/assign-bed`, { method: "PUT", body: JSON.stringify(data) }, token),

  payments: (token: string, stayId: number) =>
    request<Payment[]>(`/api/stays/${stayId}/payments`, {}, token),

  addPayment: (token: string, stayId: number, data: {
    amount: number;
    payment_type: string;
    /** Omitted means rent. */
    kind?: PaymentKind;
    payment_date: string;
    notes?: string;
  }) => request<Payment>(`/api/stays/${stayId}/payments`, { method: "POST", body: JSON.stringify(data) }, token),
};

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * What a payment is FOR — `payment_type` is how it arrived. Rent counts
 * against what the tenant owes; a deposit is held, counts against nothing, and
 * is the only money a settlement refunds as a deposit.
 */
export type PaymentKind = "rent" | "deposit";

export interface Payment {
  id: number;
  stay_id: number;
  amount: number; // paise
  payment_type: "cash" | "online";
  kind: PaymentKind;
  payment_date: string;
  proof_url?: string;
  notes?: string;
  is_approved: boolean;
  /**
   * Set when the owner did not accept a tenant's proof. The row is kept so
   * the tenant sees the answer; it is never money (migration 009).
   */
  rejected_at?: string;
  rejection_reason?: string;
  /** Sent by the tenant from the portal: never deleted, only not accepted. */
  from_tenant: boolean;
  created_at: string;
  /** What it said before its latest change; owner ledgers only (migration 016). */
  last_edit?: PaymentEdit;
  /** A settlement was saved after it, so it can't change until that is undone. */
  settled?: boolean;
}

export interface PaymentEdit {
  amount: number;
  payment_type: "cash" | "online";
  kind: PaymentKind;
  payment_date: string;
  notes?: string;
  edited_at: string;
}

export interface PaymentChange {
  amount: number;
  payment_type: "cash" | "online";
  kind: PaymentKind;
  payment_date: string;
  notes: string;
}

export const paymentsApi = {
  /** The owner's own entries only; a tenant's is marked not accepted instead. */
  delete: (token: string, id: number) =>
    request<void>(`/api/payments/${id}`, { method: "DELETE" }, token),

  /** Corrects an accepted payment, keeping what it said before. */
  update: (token: string, id: number, data: PaymentChange) =>
    request<Payment>(`/api/payments/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface SiteOccupancy {
  site_id: number;
  site_name: string;
  total_beds: number;
  occupied_beds: number;
  percentage: number;
}

export interface OccupancySummary {
  sites: SiteOccupancy[];
  total_beds: number;
  occupied_beds: number;
  percentage: number;
}

export interface RevenueSummary {
  expected_this_month: number;  // paise
  collected_this_month: number; // paise
  overdue_amount: number;       // paise, including moved_out_owed
  /** Everyone billed now, and how many of them owe anything: "18 of 21 paid up". */
  stays_open: number;
  stays_owing: number;
  /** The part of overdue_amount owed by tenants who moved out and settled short. */
  moved_out_owed: number;       // paise
  /** Money beside rent (backend money.go): deposits in, refunds out, and the net. */
  deposits_in_this_month: number; // paise
  returned_this_month: number;    // paise
  net_in_this_month: number;      // paise, may be negative
}

export interface AlertsSummary {
  pending_tenants: number;
  pending_payments: number;
  /** Expected departures that have passed with nobody confirming either way. */
  departures_due: number;
}

export interface VacatingTenant {
  /** The stay's id, not the tenant's — one tenant can hold two active stays. */
  stay_id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_phone: string;
  bed_name: string;
  room_name: string;
  site_name: string;
  notice_date?: string;
  expected_end_date?: string;
  end_date?: string;
  /** Positive once the expected departure has passed, measured server-side. */
  days_overdue: number;
}

export interface RecentPayment {
  /** The PAYMENT's id. Link with tenant_id, never this. */
  id: number;
  tenant_id: number;
  amount: number;
  payment_type: "cash" | "online";
  /** Deposits are listed here but left out of "collected this month". */
  kind: PaymentKind;
  payment_date: string;
  tenant_name: string;
  bed_name: string;
  room_name: string;
  site_name: string;
}

export interface DashboardData {
  occupancy: OccupancySummary;
  revenue: RevenueSummary;
  alerts: AlertsSummary;
  vacating_soon: VacatingTenant[];
  recent_payments: RecentPayment[];
  /** True when the server capped the list — there are more than are shown. */
  vacating_truncated: boolean;
  recent_payments_truncated: boolean;
}

export const dashboardApi = {
  get: (token: string) => request<DashboardData>("/api/dashboard", {}, token),
};

// ─── The Payments screen ─────────────────────────────────────────────────────

/**
 * One tenant's stay as the Payments screen lists it. Note `balance_paise` is
 * what they OWE, so it is never negative — the opposite sign from the grid's
 * balance, and the same as the tenant summary's: 0 when paid up or ahead.
 *
 * The due fields (`Due`) come from the backend's dueFor, on active rows only.
 */
export interface CollectionRow extends Due {
  stay_id: number;
  tenant_id: number;
  tenant_name: string;
  phone: string;
  site_name: string;
  room_name: string;
  bed_name: string | null;
  rent_amount: number;   // paise
  rent_cycle: "monthly" | "weekly" | "daily";
  balance_paise: number; // paise owed, 0 when paid up
  /** For a moved-out row, days since the settlement that left them owing. */
  days_since_due: number;
  last_payment_date: string | null;
  /**
   * They have left, settled, and still owe (UX audit M12). Settling used to
   * drop them off this list. The server sends these after the active rows.
   */
  moved_out: boolean;
  /** When a moved-out tenant left. Absent on active rows. */
  end_date?: string;
  /** When an active stay began. Absent on moved-out rows. */
  start_date?: string;
  /** How their last rent arrived, to prefill the next. Absent if never paid. */
  last_payment_type?: "cash" | "online";
}

/** Everything the Payments screen shows, in one request. */
export interface PaymentsBoard {
  /** Every open stay, soonest due first: overdue, then today, then ahead. */
  stays: CollectionRow[];
  /** Left, settled short, still owe. */
  moved_out: CollectionRow[];
  /** Payments entered in the last seven days, newest entry first. */
  recorded: RecentPayment[];
  /** Portal proofs waiting for approval. */
  pending_proofs: number;
}

export const paymentsBoardApi = {
  get: (token: string) => request<PaymentsBoard>("/api/payments/board", {}, token),
};

// ─── Insights ────────────────────────────────────────────────────────────────

/**
 * The historical view. Every other endpoint answers "what is true now"; this
 * one answers "what has been happening".
 *
 * Each month answers two questions (backend money.go):
 *  - Rent: `expected_paise` against `collected_paise`. Collected is rent
 *    received, plus rent a deposit paid off at move-out, less rent paid ahead
 *    and handed back. The last month equals the dashboard's tile.
 *  - Money: `net_in_paise`, which is every rupee in (rent and deposits, cash
 *    and online) less refunds handed back. It is what the bank and the cash
 *    drawer together should show, and it can be negative.
 * Money is keyed by the month it moved. A settlement is dated the day the
 * tenant left.
 */
export interface RevenuePoint {
  month: string;   // "2026-09"
  label: string;   // "Sep 26"
  expected_paise: number;
  /** Rent let go off this month, already out of expected_paise. */
  let_go_paise: number;
  collected_paise: number;
  net_in_paise: number;
  rent_paid_paise: number;
  deposits_in_paise: number;
  returned_paise: number;
  /** The deposit part of returned_paise; the rest was rent paid ahead. */
  deposit_returned_paise: number;
  deposit_to_rent_paise: number;
  advance_returned_paise: number;
}

/** Occupancy measured in bed-nights, so a mid-month move-in counts as a fraction. */
export interface OccupancyPoint {
  month: string;
  label: string;
  occupied_nights: number;
  available_nights: number;
  percentage: number;
}

export interface RoomInsight {
  room_id: number;
  room_name: string;
  site_id: number;
  site_name: string;
  total_beds: number;
  occupied_nights: number;
  available_nights: number;
  percentage: number;
  /** Beds taken today: an open stay in this room. */
  occupied_now: number;
  collected_paise: number;
}

export interface InsightsData {
  months: number;
  /** Rent billed in the range, and how much of it is paid by today, stay by stay. */
  rent_billed_paise: number;
  rent_paid_paise: number;
  from_date: string;
  to_date: string;
  revenue: RevenuePoint[];
  occupancy: OccupancyPoint[];
  rooms: RoomInsight[];
  /** Held right now, not over the window: owed back at move-out. */
  deposits_held_paise: number;
}

/**
 * One line of a month. `amount_paise` is always positive; `kind` says which way
 * it went. `deposit_to_rent` moved no money (the deposit arrived earlier), so
 * it belongs to the rent view only.
 */
export type MoneyEntryKind = "rent" | "deposit" | "returned" | "deposit_to_rent" | "advance_returned" | "let_go";

export interface MoneyEntry {
  date: string;
  kind: MoneyEntryKind;
  amount_paise: number;
  payment_type?: "cash" | "online";
  stay_id: number;
  tenant_id: number;
  tenant_name: string;
  room_name?: string;
  bed_name?: string;
}

export interface MonthDetail {
  month: string;
  label: string;
  from_date: string;
  to_date: string;
  entries: MoneyEntry[];
}

export const insightsApi = {
  get: (token: string, months = 12) =>
    request<InsightsData>(`/api/insights?months=${months}`, {}, token),
  month: (token: string, month: string) =>
    request<MonthDetail>(`/api/insights/months/${month}`, {}, token),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format paise as ₹ with comma separators */
export function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

/** YYYY-MM-DD of today */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "31 Aug 2026" from a YYYY-MM-DD or ISO timestamp — the tenant portal's
 * format, which the UX audit picked as the best of the app's four. Read in UTC,
 * the zone the server writes dates in, so a browser west of Greenwich does not
 * print the day before.
 */
export function formatDay(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * The latest date a payment may carry — tomorrow, in UTC — mirroring the
 * server's validatePaymentDate. One day of slack because today() is UTC and
 * the owner is in IST: just after midnight in Pune, their today is tomorrow.
 */
export function latestPaymentDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Mask aadhaar to show only last 4 digits: XXXX-XXXX-1234 */
export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX-XXXX-XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

// ─── Settlements ─────────────────────────────────────────────────────────────

/**
 * One manual line on a settlement.
 *
 * Sign convention: NEGATIVE reduces the refund (a deduction from the tenant),
 * POSITIVE increases it. The drawer never asks the owner to type a minus sign —
 * it offers "Deduct"/"Add back" and applies the sign itself.
 */
export interface Adjustment {
  label: string;
  amount_paise: number;
}

/** The calculator's opening position, before any adjustment is typed. */
export interface SettlementPreview {
  stay_id: number;
  tenant_name: string;
  /** The deposit RECEIVED — approved deposit payments. The refund uses this. */
  deposit_paise: number;
  /** The deposit agreed at intake. A label, never money; shown when it differs. */
  deposit_agreed_paise: number;
  dues_paise: number;    // signed: negative = tenant paid ahead
  advance_paise: number; // rent paid beyond what was billed; 0 if they owe
  refund_paise: number;  // the opening position, before adjustments
  end_date: string;      // the date rent is billed up to
  already_ended: boolean;
  rent_amount: number;
  rent_cycle: "daily" | "weekly" | "monthly";
  start_date: string;
  cycles_billed: number;
  total_expected: number;
  total_paid: number;
  /** When they told you, and when they said they would go. */
  notice_date?: string;
  expected_end_date?: string;
  /** Notice counts as on time up to this day: the start of their last rent month. */
  notice_by: string;
  notice_on_time: boolean;
}

/** A recorded settlement. `refund_paise` negative = the tenant owes the owner. */
export interface Settlement {
  id: number;
  stay_id: number;
  deposit_paise: number;
  dues_paise: number;
  /** How much of a rent advance went back. Always 0 when dues_paise >= 0. */
  advance_returned_paise: number;
  adjustments: Adjustment[];
  refund_paise: number;
  /** How the refund went back; absent when nothing did, or before Oct 2026. */
  refund_method?: "cash" | "online";
  notes?: string;
  created_at: string;
}

export const settlementsApi = {
  /** `endDate` moves the date rent is billed to; omitted means today. */
  preview: (token: string, stayId: number, endDate?: string) =>
    request<SettlementPreview>(
      `/api/stays/${stayId}/settlement-preview${endDate ? `?end_date=${endDate}` : ""}`,
      {},
      token
    ),

  create: (token: string, stayId: number, data: {
    adjustments: Adjustment[];
    notes?: string;
    refund_paise: number;
    end_date?: string;
    /** Omit to return a rent advance in full; send 0 to keep it. */
    advance_returned_paise?: number;
    /** How the refund went back, when something did. */
    refund_method?: "cash" | "online";
  }) => request<Settlement>(`/api/stays/${stayId}/settlement`, { method: "POST", body: JSON.stringify(data) }, token),

  /**
   * Takes the settlement off so its payments can be corrected and the stay
   * settled again. The stay stays ended on the same day.
   */
  undo: (token: string, stayId: number) =>
    request<void>(`/api/stays/${stayId}/settlement`, { method: "DELETE" }, token),

  /** Every settlement across a tenant's stays, so the page badges them in one request. */
  listByTenant: (token: string, tenantId: number) =>
    request<Settlement[]>(`/api/tenants/${tenantId}/settlements`, {}, token),
};
