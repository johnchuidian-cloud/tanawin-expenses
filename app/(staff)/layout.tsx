"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, User as UserIcon } from "lucide-react";
import { useCurrentUser, logout } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (user === undefined) return; // still loading session
    if (user === null) {
      router.replace("/login");
    } else if (user.role !== "staff") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  if (!user || user.role !== "staff") {
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
            {user.name} <span className="text-ink-500 font-normal">· Staff</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button aria-label="Notifications" className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-sand-100 relative">
            <Bell className="w-4 h-4 text-ink-700" />
          </button>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            aria-label="Sign out"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-sand-100"
          >
            <UserIcon className="w-4 h-4 text-ink-700" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">{children}</main>

      <BottomNav role="staff" />
    </div>
  );
}
