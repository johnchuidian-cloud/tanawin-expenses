"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  FileText,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  List,
  PlusCircle,
  Tags,
  Wallet,
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
  { href: "/entries", label: "Entries", icon: List },
  { href: "/new", label: "New", icon: PlusCircle },
  { href: "/categories", label: "Tags", icon: Tags },
  { href: "/notes", label: "Notes", icon: FileText },
];

// View-only guests (accountants, family): browse and inspect, never write.
// No New, no Notes — just the ledger and the category breakdown.
const GUEST_NAV: NavItem[] = [
  { href: "/entries", label: "Entries", icon: List },
  { href: "/categories", label: "Tags", icon: Tags },
];

// Lexi also logs expenses (utility bills she pays directly), so "New" is
// in her nav too. Rejected sits next to Review since they're sibling
// queues — pending vs. needs-follow-up. Tags surfaces the category
// breakdown + admin's manage button. Seven items is the upper end of
// what mobile thumbs can hit cleanly; we'll keep an eye on this.
const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/pcf", label: "PCF", icon: Wallet },
  { href: "/new", label: "New", icon: PlusCircle },
  { href: "/categories", label: "Tags", icon: Tags },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/review", label: "Review", icon: AlertCircle },
  { href: "/rejections", label: "Rejected", icon: XCircle },
  { href: "/gallery", label: "Gallery", icon: ImageIcon },
];

const COL_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export default function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items =
    role === "admin" ? ADMIN_NAV : role === "guest" ? GUEST_NAV : STAFF_NAV;
  const colClass = COL_CLASS[items.length] ?? "grid-cols-4";

  return (
    <nav className="sticky bottom-0 left-0 right-0 z-30 bg-white border-t border-sand-200">
      <div className={`max-w-screen-sm mx-auto grid ${colClass}`}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
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
        })}
      </div>
    </nav>
  );
}
