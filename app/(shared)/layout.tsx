"use client";

/**
 * Shared shell for pages that BOTH admin and staff can access:
 *   - /entries, /entries/[id]  (browse and view all team expenses)
 *   - /new                     (log a new expense — Lexi pays utilities directly,
 *                               staff log palengke runs)
 *   - /categories              (category breakdown for the month)
 *
 * Renders the same header used by the role-specific layouts, plus the
 * BottomNav appropriate to the current user's role. Logged-out users
 * bounce to /login. The undefined-vs-null distinction in useCurrentUser
 * lets us wait for the session to load instead of redirecting on the
 * first render.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { User as UserIcon } from "lucide-react";
import { useCurrentUser, logout } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import NotificationsBell from "@/components/NotificationsBell";

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (user === undefined) return; // still loading session
    if (user === null) router.replace("/login");
  }, [user, router]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-ink-500 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sand-50 flex flex-col max-w-screen-sm mx-auto">
      <header className="bg-white border-b border-sand-200 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-ink-300 uppercase tracking-wide">Logged in as</p>
          <p className="text-sm font-medium text-ink-900">
            {user.name}{" "}
            <span className="text-ink-500 font-normal">
              · {user.role === "admin" ? "Admin" : user.role === "guest" ? "Viewer" : "Staff"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <NotificationsBell user={user} />
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            aria-label="Sign out or change user"
            className="flex flex-col items-center justify-center px-2 py-1 rounded-lg hover:bg-sand-100"
          >
            <UserIcon className="w-4 h-4 text-ink-700" />
            <span className="text-[9px] text-ink-500 mt-0.5 leading-none">Sign out</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">{children}</main>

      <BottomNav role={user.role} />
    </div>
  );
}
