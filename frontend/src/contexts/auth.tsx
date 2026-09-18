"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi, ApiError, Owner, OWNER_SESSION_ENDED } from "@/lib/api";
import { OWNER_TOKEN_KEY, forgetAllSessions } from "@/lib/session";

interface AuthContextValue {
  owner: Owner | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
  /**
   * Swap in a token the server has just reissued. Changing the password
   * revokes every older token, this device's included, so the new one has to
   * replace it or the next request signs the owner out.
   */
  replaceToken: (token: string) => void;
  /**
   * Forget the token and load `url` from scratch. For when the destination
   * has something to say: logout() flips the signed-in layout, whose own
   * redirect to plain /login races any router.replace and drops the query.
   */
  logoutTo: (url: string) => void;
  /**
   * The server stopped accepting this session mid-use. The owner is still on
   * the page, possibly mid-form, so nothing is torn down: the layout offers to
   * sign in again over the top, and the form underneath keeps what was typed.
   */
  sessionEnded: boolean;
  /** Sign the same owner back in after sessionEnded, without leaving the page. */
  reauthenticate: (password: string) => Promise<void>;
  /** True after the owner chose to sign out, so the redirect need not return them. */
  signedOutByChoice: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = OWNER_TOKEN_KEY;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [signedOutByChoice, setSignedOutByChoice] = useState(false);

  useEffect(() => {
    const onEnded = () => setSessionEnded(true);
    window.addEventListener(OWNER_SESSION_ENDED, onEnded);
    return () => window.removeEventListener(OWNER_SESSION_ENDED, onEnded);
  }, []);

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
        // Nobody is mid-form on a cold load, so there is nothing to keep: the
        // layout sends them to /login?next= instead of the dialog.
        localStorage.removeItem(TOKEN_KEY);
        setSessionEnded(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const persist = useCallback((tok: string, o: Owner) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setOwner(o);
    setSessionEnded(false);
    setSignedOutByChoice(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    persist(res.token, res.owner);
  }, [persist]);

  const signup = useCallback(async (name: string, email: string, password: string, phone?: string) => {
    const res = await authApi.signup({ name, email, password, phone });
    persist(res.token, res.owner);
  }, [persist]);

  // Both sessions, not just this one — see lib/session.ts.
  const logout = useCallback(() => {
    forgetAllSessions();
    setSignedOutByChoice(true);
    setSessionEnded(false);
    setToken(null);
    setOwner(null);
  }, []);

  // Same owner, by construction: the email is the one this session belonged
  // to. Someone else signing in goes through /login, which starts clean.
  const reauthenticate = useCallback(async (password: string) => {
    if (!owner) throw new Error("no owner to sign back in");
    const res = await authApi.login({ email: owner.email, password });
    persist(res.token, res.owner);
  }, [owner, persist]);

  const replaceToken = useCallback((tok: string) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
  }, []);

  const logoutTo = useCallback((url: string) => {
    forgetAllSessions();
    window.location.replace(url);
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
      replaceToken,
      logoutTo,
      sessionEnded,
      reauthenticate,
      signedOutByChoice,
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
