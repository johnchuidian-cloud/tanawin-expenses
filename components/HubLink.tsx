"use client";

import { Home } from "lucide-react";

/**
 * Header button linking to the Tanawin Hub launcher, so the team can bounce
 * between the fleet's apps from anywhere in one tap (fleet standard:
 * persistent top-bar house glyph + "Hub"; Kitchen has the same in its app
 * bar). Lives in the header's right-side cluster, left of Sign out, styled
 * to match it. Plain external <a> — same tab, no SSO; each app keeps its
 * own login.
 *
 * The target is role-aware: admins get the full hub (all apps, incl. the
 * Lexi-only Payroll app); staff get /staff, a reduced launcher that
 * deliberately excludes Payroll. Callers gate visibility on role — guests
 * never see it: (admin) layout is admin by construction, the (shared)
 * layout must check user.role !== "guest".
 */
const HUB_ROOT = "https://tanawin-hub.tanawinbnb.workers.dev/";
const HUB_STAFF = "https://tanawin-hub.tanawinbnb.workers.dev/staff";

export default function HubLink({ role }: { role: "admin" | "staff" }) {
  return (
    <a
      href={role === "admin" ? HUB_ROOT : HUB_STAFF}
      aria-label="Open the Tanawin Hub"
      className="flex flex-col items-center justify-center px-2 py-1 rounded-lg hover:bg-sand-100"
    >
      <Home className="w-4 h-4 text-ink-700" />
      <span className="text-[9px] text-ink-500 mt-0.5 leading-none">Hub</span>
    </a>
  );
}
