"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, List, PlusCircle, FileText, LayoutDashboard, Wallet, AlertCircle, Image as ImageIcon } from "lucide-react";
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
  { href: "/notes", label: "Notes", icon: FileText },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/pcf", label: "PCF", icon: Wallet },
  { href: "/review", label: "Review", icon: AlertCircle },
  { href: "/gallery", label: "Gallery", icon: ImageIcon },
];

export default function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = role === "admin" ? ADMIN_NAV : STAFF_NAV;

  return (
    <nav className="sticky bottom-0 left-0 right-0 z-30 bg-white border-t border-sand-200">
      <div className="max-w-screen-sm mx-auto grid grid-cols-4">
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
