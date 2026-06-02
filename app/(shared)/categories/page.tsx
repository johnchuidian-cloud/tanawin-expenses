"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { getCategoryDefs, getEntries } from "@/lib/store";
import {
  entryInMonth,
  monthLabel,
  peso,
  toMonthKey,
} from "@/lib/format";
import type { Category } from "@/lib/types";
import { iconFor, staffCategoryLabel } from "@/lib/category-meta";
import { Settings2 } from "lucide-react";

type Scope = "this-month" | "all-time";

export default function CategoriesPage() {
  useStoreTick();
  const me = useCurrentUser();
  const router = useRouter();

  const [scope, setScope] = useState<Scope>("this-month");
  const entries = getEntries();

  const thisMonthKey = toMonthKey(new Date());

  const scoped = useMemo(() => {
    if (scope === "all-time") return entries;
    return entries.filter((e) => entryInMonth(e.date, thisMonthKey));
  }, [entries, scope, thisMonthKey]);

  // Total per category; seed with the current category list so unused
  // ones still show at ₱0. Use the live def list so admins see custom
  // categories as soon as they create them.
  const defs = getCategoryDefs();
  const rows = useMemo(() => {
    const map = new Map<Category, { total: number; count: number }>();
    for (const d of defs) map.set(d.id, { total: 0, count: 0 });
    for (const e of scoped) {
      const cur = map.get(e.category) ?? { total: 0, count: 0 };
      map.set(e.category, { total: cur.total + e.total, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [scoped, defs]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const maxCategoryTotal = rows[0]?.total ?? 1;

  // For staff (Maria, Joel, Rolly) use bilingual labels; for admin (Lexi)
  // stick to English to match the rest of her views.
  const isStaff = me?.role === "staff";
  const formatLabel = (c: Category) =>
    isStaff ? staffCategoryLabel(c) : c;

  return (
    <div className="pb-4">
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-ink-900">Categories</p>
          <p className="text-[11px] text-ink-500">
            Spend breakdown across all team members
          </p>
        </div>
        {me?.role === "admin" && (
          <Link
            href="/categories/manage"
            className="flex flex-col items-center justify-center px-3 py-2 rounded-lg bg-white border border-sand-200 text-ink-700 hover:bg-sand-50 transition-colors"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Settings2 className="w-4 h-4" /> Manage
            </span>
            <span className="text-[10px] text-ink-500 mt-0.5 leading-tight">
              (Add, delete, or edit categories)
            </span>
          </Link>
        )}
      </div>

      {/* Scope toggle */}
      <div className="px-5 pt-3 flex gap-2">
        {(
          [
            { key: "this-month", label: monthLabel(thisMonthKey) },
            { key: "all-time", label: "All time" },
          ] as { key: Scope; label: string }[]
        ).map((chip) => {
          const active = scope === chip.key;
          return (
            <button
              key={chip.key}
              onClick={() => setScope(chip.key)}
              className={
                "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
                (active
                  ? "bg-ink-900 text-white"
                  : "bg-sand-100 text-ink-700 hover:bg-sand-200")
              }
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Total */}
      <div className="px-5 pt-3">
        <p className="text-[11px] text-ink-500">Total {scope === "all-time" ? "" : `for ${monthLabel(thisMonthKey)}`}</p>
        <p className="text-lg font-medium text-ink-900">{peso(grandTotal)}</p>
      </div>

      {/* Rows */}
      <div className="px-5 pt-4 space-y-3">
        {rows.map(({ category, total, count }) => {
          const Icon = iconFor(category);
          const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
          return (
            <Link
              key={category}
              href={`/entries?category=${encodeURIComponent(category)}`}
              className="block p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sand-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-ink-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {formatLabel(category)}
                  </p>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {count} entr{count === 1 ? "y" : "ies"} · {pct}%
                  </p>
                </div>
                <p className="text-sm font-medium text-ink-900 flex-shrink-0">
                  {peso(total)}
                </p>
              </div>
              <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-leaf-300"
                  style={{ width: `${(total / maxCategoryTotal) * 100}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
