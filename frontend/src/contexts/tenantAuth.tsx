"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { tenantAuthApi, Tenant } from "@/lib/api";

interface TenantAuthContextValue {
  tenant: Tenant | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const TenantAuthContext = createContext<TenantAuthContextValue | null>(null);

const TOKEN_KEY = "hostel_tenant_token";

export function TenantAuthProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    tenantAuthApi.me(stored)
      .then((t) => {
        setToken(stored);
        setTenant(t);
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setIsLoading(false));
  }, []);

  const persist = useCallback((tok: string, t: Tenant) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setTenant(t);
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await tenantAuthApi.login({ phone, password });
    persist(res.token, res.tenant);
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTenant(null);
  }, []);

  return (
    <TenantAuthContext.Provider value={{
      tenant,
      token,
      isLoading,
      isAuthenticated: !!token,
      login,
      logout,
    }}>
      {children}
    </TenantAuthContext.Provider>
  );
}

export function useTenantAuth(): TenantAuthContextValue {
  const ctx = useContext(TenantAuthContext);
  if (!ctx) throw new Error("useTenantAuth must be used within TenantAuthProvider");
  return ctx;
}
