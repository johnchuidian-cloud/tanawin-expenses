"use client";

import { useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { countEntriesInRange, downloadExcelExport } from "@/lib/export";
import { getEntries } from "@/lib/store";
import { toMonthKey } from "@/lib/format";
import RangePicker, { type RangeSelection } from "@/components/RangePicker";

/**
 * Excel export with a date-range picker. The user chooses one month, several
 * months, a whole year, or every record before downloading — instead of always
 * dumping the entire history. See lib/export.ts for the workbook itself, and
 * RangePicker for the (shared) range UI.
 */
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

  // Months with data (plus the current month), newest first.
  const availableMonths = useMemo(() => {
    const set = new Set<string>([thisMonth]);
    for (const e of entries) set.add(toMonthKey(e.date));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);

  const [sel, setSel] = useState<RangeSelection>({ months: [thisMonth], label: thisMonth });

  const entryCount = countEntriesInRange(sel.months);
  const canDownload = sel.months === undefined || sel.months.length > 0;

  function handleDownload() {
    if (!canDownload) return;
    const filename = downloadExcelExport({ months: sel.months, label: sel.label });
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

            <RangePicker availableMonths={availableMonths} onChange={setSel} />

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
