"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi, ApiError, Owner } from "@/lib/api";

interface AuthContextValue {
  owner: Owner | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "hostel_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    authApi.me(stored)
      .then((o) => {
        setToken(stored);
        setOwner(o);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const persist = useCallback((tok: string, o: Owner) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setOwner(o);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    persist(res.token, res.owner);
  }, [persist]);

  const signup = useCallback(async (name: string, email: string, password: string, phone?: string) => {
    const res = await authApi.signup({ name, email, password, phone });
    persist(res.token, res.owner);
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setOwner(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      owner,
      token,
      isLoading,
      isAuthenticated: !!token,
      login,
      signup,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Re-export ApiError so callers can import from one place
export { ApiError };
