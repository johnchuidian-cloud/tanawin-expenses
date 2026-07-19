"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  FileText,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  List,
  Menu,
  PieChart,
  PlusCircle,
  Search,
  Tags,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STAFF_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/entries?focus=search", label: "Search", icon: Search },
  { href: "/entries", label: "Entries", icon: List },
  { href: "/new", label: "New", icon: PlusCircle },
  { href: "/categories", label: "Tags", icon: Tags },
  { href: "/notes", label: "Notes", icon: FileText },
];

// View-only guests (accountants, family): browse and inspect, never write.
// No New, no Notes — the ledger, the category breakdown, and the read-only
// analytics page (their main reason to be here).
const GUEST_NAV: NavItem[] = [
  { href: "/entries", label: "Entries", icon: List },
  { href: "/entries?focus=search", label: "Search", icon: Search },
  { href: "/categories", label: "Tags", icon: Tags },
  { href: "/analytics", label: "Analytics", icon: PieChart },
];

// Lexi also logs expenses (utility bills she pays directly), so "New" is
// in her nav too. Rejected sits next to Review since they're sibling
// queues — pending vs. needs-follow-up. Tags surfaces the category
// breakdown + admin's manage button. The bar got crowded at eight items,
// so only the pinned items (Home/Search/New/Notes) stay on the bar; the rest
// live behind the hamburger menu.
const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/entries?focus=search", label: "Search", icon: Search },
  { href: "/pcf", label: "PCF", icon: Wallet },
  { href: "/new", label: "New", icon: PlusCircle },
  { href: "/categories", label: "Tags", icon: Tags },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/review", label: "Review", icon: AlertCircle },
  { href: "/rejections", label: "Rejected", icon: XCircle },
  { href: "/gallery", label: "Gallery", icon: ImageIcon },
];

// These stay on the bottom bar at all times; everything else for the role is
// reachable through the expanded menu. Matched by label so each role's own
// "Home" target (admin /dashboard vs. staff /home) is respected. Search is
// pinned so every role can jump straight to it without opening the menu.
const PINNED_LABELS = new Set(["Home", "Search", "New", "Notes"]);

const COL_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export default function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items =
    role === "admin" ? ADMIN_NAV : role === "guest" ? GUEST_NAV : STAFF_NAV;

  // Close the menu whenever the route changes (e.g. after tapping a link).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const renderLink = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          "flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors " +
          (active ? "text-leaf-500 font-medium" : "text-ink-500 hover:text-ink-900")
        }
      >
        <Icon className="w-5 h-5" />
        <span>{item.label}</span>
      </Link>
    );
  };

  const pinned = items.filter((item) => PINNED_LABELS.has(item.label));

  // Guests have a short nav (Entries/Search/Tags/Analytics), so they keep the
  // simple inline bar with everything visible — no hamburger needed.
  if (role === "guest") {
    const colClass = COL_CLASS[items.length] ?? "grid-cols-4";
    return (
      <nav className="sticky bottom-0 left-0 right-0 z-30 bg-white border-t border-sand-200">
        <div className={`max-w-screen-sm mx-auto grid ${colClass}`}>
          {items.map(renderLink)}
        </div>
      </nav>
    );
  }

  // pinned items + the menu toggle button
  const barColClass = COL_CLASS[pinned.length + 1] ?? "grid-cols-4";

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/30"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <nav className="sticky bottom-0 left-0 right-0 z-40 bg-white border-t border-sand-200">
        {open && (
          <div className="max-w-screen-sm mx-auto bg-white border-b border-sand-200">
            <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-ink-300">
              Menu
            </p>
            <div className="grid grid-cols-4 gap-1 px-2 pb-3">
              {items.map(renderLink)}
              {/* Admin-only jump to the Tanawin Hub launcher (fleet-wide
                  convention: house glyph + "Hub", admins only). External
                  site, so a plain <a> — Next's <Link>/isActive don't apply.
                  No SSO: each app keeps its own login. */}
              {role === "admin" && (
                <a
                  href="https://tanawin-hub.tanawinbnb.workers.dev/"
                  className="flex flex-col items-center gap-1 py-2.5 text-[10px] text-ink-500 hover:text-ink-900 transition-colors"
                >
                  <Home className="w-5 h-5" />
                  <span>Hub</span>
                </a>
              )}
            </div>
          </div>
        )}
        <div className={`max-w-screen-sm mx-auto grid ${barColClass}`}>
          {pinned.map(renderLink)}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={
              "flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors " +
              (open ? "text-leaf-500 font-medium" : "text-ink-500 hover:text-ink-900")
            }
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            <span>{open ? "Close" : "Menu"}</span>
          </button>
        </div>
      </nav>
    </>
  );
}
