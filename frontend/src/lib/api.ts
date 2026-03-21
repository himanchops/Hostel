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
  is_approved: boolean;
  created_at: string;
  updated_at: string;
}

export const tenantsApi = {
  list: (token: string) => request<Tenant[]>("/api/tenants", {}, token),
  get: (token: string, id: number) => request<Tenant>(`/api/tenants/${id}`, {}, token),
  create: (token: string, data: { name: string; phone: string; email?: string }) =>
    request<Tenant>("/api/tenants", { method: "POST", body: JSON.stringify(data) }, token),
  update: (token: string, id: number, data: { name: string; phone: string; email?: string }) =>
    request<Tenant>(`/api/tenants/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),
  stays: (token: string, id: number) =>
    request<Stay[]>(`/api/tenants/${id}/stays`, {}, token),
};

// ─── Stays ───────────────────────────────────────────────────────────────────

export interface Stay {
  id: number;
  tenant_id: number;
  bed_id: number;
  rent_amount: number;   // paise
  deposit_amount: number; // paise
  rent_cycle: "daily" | "weekly" | "monthly";
  rent_due_day: number;
  start_date: string;
  end_date?: string;
  notice_date?: string;
  created_at: string;
  updated_at: string;
}

export const staysApi = {
  create: (token: string, data: {
    tenant_id: number;
    bed_id: number;
    rent_amount: number;
    deposit_amount: number;
    rent_cycle: string;
    rent_due_day: number;
    start_date: string;
  }) => request<Stay>("/api/stays", { method: "POST", body: JSON.stringify(data) }, token),

  update: (token: string, id: number, data: { end_date?: string; notice_date?: string }) =>
    request<Stay>(`/api/stays/${id}`, { method: "PUT", body: JSON.stringify(data) }, token),

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
