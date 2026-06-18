"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { monthLabel } from "@/lib/format";

/**
 * Shared date-range picker: one month, several months, a whole year, or every
 * record. Used by both the Excel export (ExportButton) and the receipts pack
 * (ReceiptsPackButton) so the two stay in lock-step.
 *
 * It owns the mode/selection state and reports the resolved selection up via
 * onChange. The caller supplies the months that actually have data (which
 * differs per feature — entries for Excel, receipts/photos for the pack) and
 * renders its own live count + download button around it.
 */
export type RangeMode = "months" | "year" | "all";

export interface RangeSelection {
  /** YYYY-MM keys to include. undefined = every record. */
  months?: string[];
  /** Filename suffix, e.g. "2026-06", "2026", "2-months", "all-time". */
  label: string;
}

export default function RangePicker({
  availableMonths,
  onChange,
}: {
  /** YYYY-MM keys with data, newest first. */
  availableMonths: string[];
  onChange: (sel: RangeSelection) => void;
}) {
  const newest = availableMonths[0];
  const [mode, setMode] = useState<RangeMode>("months");
  const [selectedMonths, setSelectedMonths] = useState<string[]>(newest ? [newest] : []);
  const [selectedYear, setSelectedYear] = useState<string>(
    (newest ?? "").slice(0, 4) || String(new Date().getFullYear()),
  );

  const years = useMemo(
    () => Array.from(new Set(availableMonths.map((m) => m.slice(0, 4)))).sort((a, b) => (a < b ? 1 : -1)),
    [availableMonths],
  );

  function toggleMonth(key: string) {
    setSelectedMonths((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const selection = useMemo<RangeSelection>(() => {
    if (mode === "all") return { months: undefined, label: "all-time" };
    if (mode === "year") {
      const ms = Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, "0")}`);
      return { months: ms, label: selectedYear };
    }
    return {
      months: selectedMonths,
      label: selectedMonths.length === 1 ? selectedMonths[0] : `${selectedMonths.length}-months`,
    };
  }, [mode, selectedYear, selectedMonths]);

  // Notify the parent of the resolved selection on mount and whenever it
  // changes. onChange is kept in a ref so an unstable callback identity from
  // the parent can't retrigger the effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const monthsKey = selection.months ? selection.months.join(",") : "all";
  useEffect(() => {
    onChangeRef.current(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey, selection.label]);

  return (
    <div>
      {/* Mode segmented control */}
      <div className="grid grid-cols-3 gap-1 bg-sand-100 rounded-lg p-1 mb-3">
        {([
          ["months", "Months"],
          ["year", "Year"],
          ["all", "All records"],
        ] as [RangeMode, string][]).map(([m, lbl]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              "h-8 rounded-md text-xs font-medium transition-colors " +
              (mode === m ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900")
            }
          >
            {lbl}
          </button>
        ))}
      </div>

      {mode === "months" && (
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {availableMonths.length === 0 && (
            <p className="text-sm text-ink-500">No records yet.</p>
          )}
          {availableMonths.map((key) => {
            const checked = selectedMonths.includes(key);
            const parts = monthLabel(key).split(" ");
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggleMonth(key)}
                className={
                  "inline-flex items-center gap-1 pl-1.5 pr-2.5 h-8 rounded-full border text-xs font-medium transition-colors " +
                  (checked
                    ? "bg-leaf-50 border-leaf-300 text-leaf-700"
                    : "bg-white border-sand-200 text-ink-700 hover:bg-sand-50")
                }
              >
                <span
                  className={
                    "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border " +
                    (checked ? "bg-leaf-500 border-leaf-500 text-white" : "border-sand-300 text-transparent")
                  }
                >
                  <Check className="w-3 h-3" strokeWidth={3} />
                </span>
                {`${parts[0]} '${parts[1].slice(2)}`}
              </button>
            );
          })}
        </div>
      )}

      {mode === "year" && (
        <div className="flex flex-wrap gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedYear(y)}
              className={
                "px-4 h-9 rounded-lg text-sm font-medium transition-colors " +
                (selectedYear === y
                  ? "bg-leaf-500 text-white"
                  : "bg-sand-100 text-ink-700 hover:bg-sand-200")
              }
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {mode === "all" && (
        <p className="text-sm text-ink-700">Includes every record in the books.</p>
      )}
    </div>
  );
}
