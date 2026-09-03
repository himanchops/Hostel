const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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

export type BedStatus = "vacant" | "paid" | "partial" | "overdue" | "vacating_soon";

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
  rent_amount?: number;   // paise
  deposit_amount?: number; // paise
  total_paid?: number;    // paise
  total_expected?: number; // paise
  balance?: number;       // paise — negative = owes money
  start_date?: string;
  end_date?: string;
  notice_date?: string;
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
}

export const tenantsApi = {
  list: (token: string, pending?: boolean) =>
    request<Tenant[]>(`/api/tenants${pending ? "?pending=true" : ""}`, {}, token),
  get: (token: string, id: number) => request<Tenant>(`/api/tenants/${id}`, {}, token),
  create: (token: string, data: TenantUpdateData) =>
    request<Tenant>("/api/tenants", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: number, data: TenantUpdateData) =>
    request<Tenant>(`/api/tenants/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  approve: (token: string, id: number, data: {
    bed_id?: number;
    rent_amount?: number;
    deposit_amount?: number;
    rent_cycle?: string;
    start_date?: string;
  }) => request<Tenant>(`/api/tenants/${id}/approve`, { method: "POST", body: JSON.stringify(data) }, token),
  reject: (token: string, id: number) =>
    request<void>(`/api/tenants/${id}/reject`, { method: "DELETE" }, token),
  stays: (token: string, id: number) =>
    request<Stay[]>(`/api/tenants/${id}/stays`, {}, token),
  summary: (token: string, id: number) =>
    request<TenantSummary>(`/api/tenants/${id}/summary`, {}, token),
};

// ─── File Uploads ─────────────────────────────────────────────────────────────

async function uploadFile(endpoint: string, file: File, token?: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new ApiError(res.status, body.error || "Upload failed");
  }
  const { url } = await res.json();
  return url as string;
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
  created_at: string;
  payments: Payment[];
}

export const tenantPortalApi = {
  stays: (token: string) => request<TenantStay[]>("/tenant/stays", {}, token),
  submitPayment: (token: string, stayId: number, data: { amount: number; notes?: string; proof_url?: string }) =>
    request<Payment>(`/tenant/stays/${stayId}/payments`, { method: "POST", body: JSON.stringify(data) }, token),
  submitNotice: (token: string, stayId: number) =>
    request<Stay>(`/tenant/stays/${stayId}/notice`, { method: "PUT", body: JSON.stringify({}) }, token),
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
  reject: (token: string, id: number) =>
    request<void>(`/api/payments/${id}`, { method: "DELETE" }, token),
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
  created_at: string;
  updated_at: string;
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

  update: (token: string, id: number, data: { end_date?: string; notice_date?: string }) =>
    request<Stay>(`/api/stays/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),

  assignBed: (token: string, stayId: number, data: { bed_id: number }) =>
    request<Stay>(`/api/stays/${stayId}/assign-bed`, { method: "PUT", body: JSON.stringify(data) }, token),

  payments: (token: string, stayId: number) =>
    request<Payment[]>(`/api/stays/${stayId}/payments`, {}, token),

  addPayment: (token: string, stayId: number, data: {
    amount: number;
    payment_type: string;
    payment_date: string;
    notes?: string;
  }) => request<Payment>(`/api/stays/${stayId}/payments`, { method: "POST", body: JSON.stringify(data) }, token),
};

// ─── Payments ────────────────────────────────────────────────────────────────

export interface Payment {
  id: number;
  stay_id: number;
  amount: number; // paise
  payment_type: "cash" | "online";
  payment_date: string;
  proof_url?: string;
  notes?: string;
  is_approved: boolean;
  created_at: string;
}

export const paymentsApi = {
  delete: (token: string, id: number) =>
    request<void>(`/api/payments/${id}`, { method: "DELETE" }, token),
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
  overdue_amount: number;       // paise
}

export interface AlertsSummary {
  pending_tenants: number;
  pending_payments: number;
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
  end_date?: string;
}

export interface RecentPayment {
  /** The PAYMENT's id. Link with tenant_id, never this. */
  id: number;
  tenant_id: number;
  amount: number;
  payment_type: "cash" | "online";
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

// ─── Collections ─────────────────────────────────────────────────────────────

/**
 * One tenant who owes money. Note `balance_paise` is what they OWE, so it is
 * positive — the opposite sign from the grid's balance, and the same as the
 * tenant summary's. Rows with nothing outstanding never reach the client.
 */
export interface CollectionRow {
  stay_id: number;
  tenant_id: number;
  tenant_name: string;
  phone: string;
  site_name: string;
  room_name: string;
  bed_name: string | null;
  rent_amount: number;   // paise
  rent_cycle: "monthly" | "weekly" | "daily";
  balance_paise: number; // paise owed, always > 0
  days_since_due: number;
  last_payment_date: string | null;
}

export const collectionsApi = {
  list: (token: string) => request<CollectionRow[]>("/api/collections", {}, token),
};

// ─── Insights ────────────────────────────────────────────────────────────────

/**
 * The historical view. Every other endpoint answers "what is true now"; this
 * one answers "what has been happening".
 *
 * `expected_paise` is derived from billing cycles the same way the dashboard's
 * card is, so the last point here equals the dashboard's "expected this month".
 * `collected_paise` is keyed by the month the money actually arrived, so
 * arrears cleared in one go show up as a single tall bar.
 */
export interface RevenuePoint {
  month: string;   // "2026-09"
  label: string;   // "Sep 26"
  expected_paise: number;
  collected_paise: number;
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
  vacant_nights: number;
  percentage: number;
  collected_paise: number;
}

export interface InsightsData {
  months: number;
  from_date: string;
  to_date: string;
  revenue: RevenuePoint[];
  occupancy: OccupancyPoint[];
  rooms: RoomInsight[];
}

export const insightsApi = {
  get: (token: string, months = 12) =>
    request<InsightsData>(`/api/insights?months=${months}`, {}, token),
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
  deposit_paise: number;
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
  }) => request<Settlement>(`/api/stays/${stayId}/settlement`, { method: "POST", body: JSON.stringify(data) }, token),

  /** Every settlement across a tenant's stays, so the page badges them in one request. */
  listByTenant: (token: string, tenantId: number) =>
    request<Settlement[]>(`/api/tenants/${tenantId}/settlements`, {}, token),
};
