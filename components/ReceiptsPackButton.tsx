"use client";

import { useMemo, useState } from "react";
import { FileArchive, Loader2, X } from "lucide-react";
import { getEntries, getReceipts } from "@/lib/store";
import { countReceiptsInRange, downloadReceiptsPack } from "@/lib/receipts-pack";
import { toMonthKey } from "@/lib/format";
import RangePicker, { type RangeSelection } from "@/components/RangePicker";

/**
 * Downloads a ZIP of receipt photos + a CSV index for the accountant. Opens a
 * modal so the user picks a month, several months, a year, or all time — the
 * same RangePicker the Excel export uses, so the two downloads behave alike.
 *
 * Available to every role (admins, staff, and view-only guests/accountants),
 * so it sits alongside ExportButton on the shared entries page.
 *
 * Sibling to ExportButton (Excel): numbers there, supporting images here.
 */
export default function ReceiptsPackButton({
  variant = "default",
}: {
  variant?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<RangeSelection>({ months: [], label: "all-time" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Months that actually have a receipt or a standalone receipt photo,
  // newest first. Drives the picker so we never offer an empty month.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const r of getReceipts()) set.add(toMonthKey(r.date));
    for (const e of getEntries()) {
      if (!e.receiptId && (e.photoUrls?.length ?? 0) > 0) set.add(toMonthKey(e.date));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [open]); // recompute each time the modal opens

  function openModal() {
    setResult(null);
    setOpen(true);
  }

  const receiptCount = countReceiptsInRange(sel.months);
  const canDownload = !busy && (sel.months === undefined || sel.months.length > 0);

  async function handleDownload() {
    if (!canDownload) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await downloadReceiptsPack({ months: sel.months, label: sel.label });
      if (!res) {
        setResult("No receipts to pack for that period.");
      } else {
        setResult(
          `Saved ${res.filename} · ${res.count} receipt${res.count === 1 ? "" : "s"}, ${res.photoCount} photo${res.photoCount === 1 ? "" : "s"}.`,
        );
      }
    } catch (err) {
      setResult(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't build the pack. Try a smaller period.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isSm = variant === "sm";

  return (
    <>
      <button
        onClick={openModal}
        className={
          isSm
            ? "btn btn-sm bg-white border-sand-200 text-ink-700"
            : "btn bg-white border-sand-200 text-ink-700"
        }
      >
        <FileArchive className={isSm ? "w-3.5 h-3.5" : "w-4 h-4"} />
        Receipts
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 mb-4 sm:mb-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-leaf-600" />
                <p className="text-base font-medium text-ink-900">Download receipts pack</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center hover:bg-sand-100"
              >
                <X className="w-4 h-4 text-ink-500" />
              </button>
            </div>

            <p className="text-xs text-ink-500 mb-3">
              A ZIP with the receipt photos plus an{" "}
              <span className="font-medium text-ink-700">index.csv</span> listing each
              receipt&rsquo;s vendor, date, total, and line items — ready for the accountant.
            </p>

            <RangePicker availableMonths={availableMonths} onChange={setSel} />

            <p className="text-[11px] text-ink-500 mt-4">
              {receiptCount} receipt{receiptCount === 1 ? "" : "s"} in this selection.
            </p>

            {result && <p className="text-[11px] text-leaf-600 mt-2">{result}</p>}

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setOpen(false)}
                className="btn btn-sm flex-1"
                disabled={busy}
              >
                Close
              </button>
              <button
                onClick={handleDownload}
                className="btn-primary flex-1 h-9 text-sm disabled:opacity-50"
                disabled={!canDownload}
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Preparing…
                  </>
                ) : (
                  <>
                    <FileArchive className="w-4 h-4" /> Download ZIP
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
