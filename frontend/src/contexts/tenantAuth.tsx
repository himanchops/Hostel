"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { tenantAuthApi, Tenant, isUnreachable } from "@/lib/api";
import { TENANT_TOKEN_KEY, forgetAllSessions } from "@/lib/session";

interface TenantAuthContextValue {
  tenant: Tenant | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  /** The saved sign-in could not be checked: the server never answered. */
  unreachable: boolean;
  /** Check the saved sign-in again, after `unreachable`. */
  retryRestore: () => void;
}

const TenantAuthContext = createContext<TenantAuthContextValue | null>(null);

const TOKEN_KEY = TENANT_TOKEN_KEY;

export function TenantAuthProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        setUnreachable(false);
      })
      .catch((err) => {
        // Only the server saying no ends the sign-in; no answer keeps it.
        if (isUnreachable(err)) setUnreachable(true);
        else localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setIsLoading(false));
  }, [attempt]);

  const retryRestore = useCallback(() => {
    setUnreachable(false);
    setIsLoading(true);
    setAttempt((n) => n + 1);
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

  // Both sessions, not just this one — see lib/session.ts.
  const logout = useCallback(() => {
    forgetAllSessions();
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
      unreachable,
      retryRestore,
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
