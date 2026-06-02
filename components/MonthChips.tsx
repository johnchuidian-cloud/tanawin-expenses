"use client";

/**
 * Shared month-scope chip row. Used by the dashboard / home / categories /
 * entries pages so the time-filter UI feels identical everywhere.
 *
 * Behaviour:
 *  - "All time" chip first (optional via `includeAllTime`, default true).
 *  - One chip per `availableMonths` entry, in the order supplied (callers
 *    pass them newest first).
 *  - When the chip row crosses a calendar-year boundary going backwards,
 *    a non-clickable "← {year}" separator slips between the chips so the
 *    user has a visual marker that they're scrolling into an older year.
 *  - Chip labels render as e.g. "May '26" — abbreviated to fit a phone.
 */

import { ChevronLeft } from "lucide-react";
import { monthLabel } from "@/lib/format";

export type MonthScope = "all" | string;

interface MonthChipsProps {
  scope: MonthScope;
  onChange: (next: MonthScope) => void;
  availableMonths: string[]; // YYYY-MM keys, newest first
  includeAllTime?: boolean;
}

export function MonthChips({
  scope,
  onChange,
  availableMonths,
  includeAllTime = true,
}: MonthChipsProps) {
  type Item =
    | { kind: "all" }
    | { kind: "month"; key: string }
    | { kind: "yearSep"; year: number };

  const items: Item[] = [];
  if (includeAllTime) items.push({ kind: "all" });

  let prevYear: number | null = null;
  for (const key of availableMonths) {
    const year = Number(key.split("-")[0]);
    if (prevYear !== null && year !== prevYear) {
      // The transition is always "newer → older" since the list is newest-first,
      // so the back arrow + older year reads correctly.
      items.push({ kind: "yearSep", year });
    }
    items.push({ kind: "month", key });
    prevYear = year;
  }

  return (
    <div className="px-5 pt-3 flex gap-2 overflow-x-auto">
      {items.map((item, idx) => {
        if (item.kind === "all") {
          const active = scope === "all";
          return (
            <button
              key="__all"
              onClick={() => onChange("all")}
              className={
                "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
                (active
                  ? "bg-leaf-500 text-white"
                  : "bg-sand-100 text-ink-700 hover:bg-sand-200")
              }
            >
              All time
            </button>
          );
        }
        if (item.kind === "yearSep") {
          return (
            <div
              key={`__sep-${item.year}-${idx}`}
              aria-hidden="true"
              className="flex items-center gap-0.5 text-[11px] text-ink-500 px-1 whitespace-nowrap select-none"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {item.year}
            </div>
          );
        }
        const active = scope === item.key;
        // "May 2026" -> "May '26" — compact so a year of months fits on a phone.
        const parts = monthLabel(item.key).split(" ");
        const shortLabel = `${parts[0]} '${parts[1].slice(2)}`;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={
              "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
              (active
                ? "bg-leaf-500 text-white"
                : "bg-sand-100 text-ink-700 hover:bg-sand-200")
            }
          >
            {shortLabel}
          </button>
        );
      })}
    </div>
  );
}
