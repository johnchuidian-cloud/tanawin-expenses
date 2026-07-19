"use client";

import { Home } from "lucide-react";

/**
 * Admin-only header button linking to the Tanawin Hub launcher, so Lexi can
 * bounce between the fleet's apps from anywhere in one tap (fleet standard:
 * persistent top-bar house glyph + "Hub"; Kitchen has the same in its app
 * bar). Lives in the header's right-side cluster, left of Sign out, styled
 * to match it. Plain external <a> — same tab, no SSO; each app keeps its
 * own login. Callers gate on role: (admin) layout is admin by construction,
 * the (shared) layout must check user.role === "admin".
 */
export default function HubLink() {
  return (
    <a
      href="https://tanawin-hub.tanawinbnb.workers.dev/"
      aria-label="Open the Tanawin Hub"
      className="flex flex-col items-center justify-center px-2 py-1 rounded-lg hover:bg-sand-100"
    >
      <Home className="w-4 h-4 text-ink-700" />
      <span className="text-[9px] text-ink-500 mt-0.5 leading-none">Hub</span>
    </a>
  );
}
