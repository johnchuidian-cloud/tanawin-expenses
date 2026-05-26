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
import { authenticateByPin, getUserById } from "./store";
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
 * Returns `undefined` until the session has been read on the client, then
 * `User` (logged in) or `null` (logged out). Callers must treat `undefined`
 * as "still loading" and avoid redirecting on it — otherwise the first render
 * (always `undefined`) races ahead of the session read and bounces the user
 * to the login screen.
 */
export function useCurrentUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    setUser(getCurrentUser());
    const onChange = () => setUser(getCurrentUser());
    window.addEventListener("tanawin:auth", onChange);
    return () => window.removeEventListener("tanawin:auth", onChange);
  }, []);
  return user;
}
