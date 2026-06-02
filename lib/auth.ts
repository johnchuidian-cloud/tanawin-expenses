/**
 * Mock auth layer.
 *
 * V0: sessionStorage holds the logged-in user ID. Refresh page = stay logged
 * in within the tab; close tab = logged out. Good enough for prototype testing.
 *
 * V1 (Supabase): this file becomes a thin wrapper around Supabase Auth's
 * onAuthStateChange / user() / signInWithPassword. Same exported function
 * names, different bodies.
 */

"use client";

import { useEffect, useState } from "react";
import {
  authenticateByPin,
  bootstrapFromSupabase,
  getUserById,
  isBootstrapComplete,
} from "./store";
import type { User } from "./types";

const STORAGE_KEY = "tanawin.session.userId";

export function login(name: string, pin: string): User | null {
  if (typeof window === "undefined") return null;
  const user = authenticateByPin(name, pin);
  if (user) {
    sessionStorage.setItem(STORAGE_KEY, user.id);
    window.dispatchEvent(new Event("tanawin:auth"));
  }
  return user;
}

export function logout(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("tanawin:auth"));
}

export function getCurrentUserId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function getCurrentUser(): User | null {
  const id = getCurrentUserId();
  if (!id) return null;
  return getUserById(id) ?? null;
}

/**
 * React hook that re-renders when the session changes.
 *
 * Returns `undefined` until the session has been read AND the user lookup
 * succeeds (i.e. Supabase bootstrap has populated the users array). Then
 * resolves to `User` (logged in) or `null` (no session, or session id is
 * stale — user not in DB).
 *
 * Callers must treat `undefined` as "still loading" and avoid redirecting
 * on it — otherwise the first render races ahead of the session read and
 * bounces the user to the login screen.
 *
 * Race-condition note: a navigation that runs before bootstrap finishes
 * would otherwise see "session id present, users array empty, user is
 * null" and redirect. We guard against that by holding `undefined`
 * (loading) until bootstrap has actually completed; once it has, an
 * unrecognised id genuinely means "stale session" and we resolve to null.
 */
export function useCurrentUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    // Kick off bootstrap from here too. The layouts that use this hook
    // gate their children behind `user`, so if we wait for the children
    // to start bootstrap we deadlock (page can't render until user known,
    // user can't be known until page-level bootstrap fires).
    bootstrapFromSupabase();

    function evaluate() {
      const id = getCurrentUserId();
      if (!id) {
        setUser(null);
        return;
      }
      const u = getUserById(id);
      if (u) {
        setUser(u);
        return;
      }
      // Session id present but no matching user. If bootstrap hasn't
      // finished, the user IS valid — we just don't have the row yet.
      // Stay in loading state; the bootstrap-complete handler below
      // will re-fire this when data lands.
      if (!isBootstrapComplete()) {
        setUser(undefined);
        return;
      }
      // Bootstrap done and still no user → stale session.
      setUser(null);
    }
    evaluate();
    window.addEventListener("tanawin:auth", evaluate);
    return () => window.removeEventListener("tanawin:auth", evaluate);
  }, []);
  return user;
}
