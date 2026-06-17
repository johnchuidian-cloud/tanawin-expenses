"use client";

import { useMemo, useState } from "react";
import { Check, Download, X } from "lucide-react";
import { countEntriesInRange, downloadExcelExport } from "@/lib/export";
import { getEntries } from "@/lib/store";
import { monthLabel, toMonthKey } from "@/lib/format";

/**
 * Excel export with a date-range picker. The user chooses one month, several
 * months, a whole year, or every record before downloading — instead of always
 * dumping the entire history. See lib/export.ts for the workbook itself.
 */
type Mode = "months" | "year" | "all";

export default function ExportButton({
  variant = "default",
}: {
  /** "default" = full btn, "sm" = compact for tight headers */
  variant?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [lastFilename, setLastFilename] = useState<string | null>(null);

  const entries = getEntries();
  const thisMonth = toMonthKey(new Date());

  // Months with data (plus the current month), newest first; and the distinct
  // years, newest first.
  const availableMonths = useMemo(() => {
    const set = new Set<string>([thisMonth]);
    for (const e of entries) set.add(toMonthKey(e.date));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);
  const years = useMemo(
    () => Array.from(new Set(availableMonths.map((m) => m.slice(0, 4)))).sort((a, b) => (a < b ? 1 : -1)),
    [availableMonths],
  );

  const [mode, setMode] = useState<Mode>("months");
  const [selectedMonths, setSelectedMonths] = useState<string[]>([thisMonth]);
  const [selectedYear, setSelectedYear] = useState<string>(thisMonth.slice(0, 4));

  function toggleMonth(key: string) {
    setSelectedMonths((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // The months list + filename label for the current selection.
  const { months, label } = useMemo<{ months?: string[]; label: string }>(() => {
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

  const entryCount = countEntriesInRange(months);
  const canDownload = mode !== "months" || selectedMonths.length > 0;

  function handleDownload() {
    if (!canDownload) return;
    const filename = downloadExcelExport({ months, label });
    setLastFilename(filename);
    setOpen(false);
    setTimeout(() => setLastFilename((cur) => (cur === filename ? null : cur)), 6000);
  }

  const isSm = variant === "sm";

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className={isSm ? "btn btn-sm bg-white border-sand-200 text-ink-700" : "btn-primary"}
      >
        <Download className={isSm ? "w-3.5 h-3.5" : "w-4 h-4"} />
        {isSm ? "Excel" : "Download Excel"}
      </button>
      {lastFilename && (
        <p className="text-[11px] text-leaf-600 mt-1">Saved {lastFilename}</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 mb-4 sm:mb-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-leaf-600" />
                <p className="text-base font-medium text-ink-900">Download Excel</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cancel"
                className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center hover:bg-sand-100"
              >
                <X className="w-4 h-4 text-ink-500" />
              </button>
            </div>

            <p className="text-xs text-ink-500 mb-3">Choose what to include.</p>

            {/* Mode segmented control */}
            <div className="grid grid-cols-3 gap-1 bg-sand-100 rounded-lg p-1 mb-3">
              {([
                ["months", "Months"],
                ["year", "Year"],
                ["all", "All records"],
              ] as [Mode, string][]).map(([m, lbl]) => (
                <button
                  key={m}
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
              <p className="text-sm text-ink-700">Exports every record in the books.</p>
            )}

            <p className="text-[11px] text-ink-500 mt-4">
              {entryCount} expense{entryCount === 1 ? "" : "s"} in this selection.
            </p>

            <div className="flex gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="btn btn-sm flex-1">
                Cancel
              </button>
              <button
                onClick={handleDownload}
                disabled={!canDownload}
                className="btn-primary flex-1 h-9 text-sm disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
