"use client";

/**
 * 4×4 month picker for the dashboard / home pages. Laid out like a phone
 * keypad — top row is year navigation + "All time", then 12 months in a
 * 3×4 grid below.
 *
 *   [ ← ] [ 2026 ] [ All time ] [ → ]
 *   [ Jan ] [ Feb ] [ Mar ] [ Apr ]
 *   [ May ] [ Jun ] [ Jul ] [ Aug ]
 *   [ Sep ] [ Oct ] [ Nov ] [ Dec ]
 *
 * The ← / → arrows browse to other years (only enabled when an adjacent
 * year exists in the data). Months without data are dimmed but visible
 * so the grid layout stays stable — users always see January in the
 * top-left, regardless of which months happen to have entries.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type MonthScope = "all" | string;

interface MonthGridProps {
  scope: MonthScope;
  onChange: (next: MonthScope) => void;
  availableMonths: string[]; // YYYY-MM keys
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr",
  "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec",
];

export function MonthGrid({ scope, onChange, availableMonths }: MonthGridProps) {
  // Year range = years with data + current calendar year, so users can always
  // see the year they're "in" even before any entries land for it.
  const currentYear = new Date().getFullYear();
  const dataYears = availableMonths.map((k) => Number(k.split("-")[0]));
  const minYear = Math.min(currentYear, ...(dataYears.length ? dataYears : [currentYear]));
  const maxYear = Math.max(currentYear, ...(dataYears.length ? dataYears : [currentYear]));

  // Visible year is purely a grid-navigation cursor — flipping it doesn't
  // change the scope until the user actually clicks a month. Initialise to
  // the scope's year so the user opens on the grid that matches their
  // current selection.
  const initialYear = scope === "all" ? currentYear : Number(scope.split("-")[0]);
  const [visibleYear, setVisibleYear] = useState(initialYear);

  const canPrev = visibleYear > minYear;
  const canNext = visibleYear < maxYear;

  const available = new Set(availableMonths);
  const monthKey = (m: number) => `${visibleYear}-${String(m + 1).padStart(2, "0")}`;

  return (
    <div className="px-5 pt-3 space-y-2">
      {/* Row 1: year navigation + "All time" */}
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => canPrev && setVisibleYear(visibleYear - 1)}
          disabled={!canPrev}
          aria-label="Previous year"
          className="h-10 rounded-lg bg-sand-100 text-ink-700 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-sand-200 transition-colors flex items-center justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div
          aria-label={`Year ${visibleYear}`}
          className="h-10 rounded-lg flex items-center justify-center text-sm font-medium text-ink-900 bg-sand-50 border border-sand-200"
        >
          {visibleYear}
        </div>
        <button
          onClick={() => onChange("all")}
          className={
            "h-10 rounded-lg text-xs font-medium transition-colors " +
            (scope === "all"
              ? "bg-leaf-500 text-white"
              : "bg-sand-100 text-ink-700 hover:bg-sand-200")
          }
        >
          All time
        </button>
        <button
          onClick={() => canNext && setVisibleYear(visibleYear + 1)}
          disabled={!canNext}
          aria-label="Next year"
          className="h-10 rounded-lg bg-sand-100 text-ink-700 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-sand-200 transition-colors flex items-center justify-center"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Rows 2-4: 12 months */}
      <div className="grid grid-cols-4 gap-2">
        {MONTH_NAMES.map((name, i) => {
          const key = monthKey(i);
          const hasData = available.has(key);
          const active = scope === key;
          return (
            <button
              key={name}
              onClick={() => onChange(key)}
              disabled={!hasData && !active}
              aria-pressed={active}
              className={
                "h-10 rounded-lg text-xs font-medium transition-colors " +
                (active
                  ? "bg-leaf-500 text-white"
                  : hasData
                    ? "bg-sand-100 text-ink-700 hover:bg-sand-200"
                    : "bg-sand-50 text-ink-300 cursor-not-allowed")
              }
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
