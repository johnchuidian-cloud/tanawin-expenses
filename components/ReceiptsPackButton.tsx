"use client";

import { useMemo, useState } from "react";
import { FileArchive, Loader2, X } from "lucide-react";
import { getEntries, getReceipts } from "@/lib/store";
import { downloadReceiptsPack, type PackScope } from "@/lib/receipts-pack";
import { toMonthKey, monthLabel } from "@/lib/format";

/**
 * Downloads a ZIP of receipt photos + a CSV index for the accountant. Opens
 * a small modal so the user picks which month (or all time) to pack — keeps
 * each pack small and matches how receipts are handed over monthly.
 *
 * Sibling to ExportButton (Excel): numbers there, supporting images here.
 */
export default function ReceiptsPackButton({
  variant = "default",
}: {
  variant?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<PackScope>("all");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Months that actually have a receipt or a standalone receipt photo,
  // newest first. Drives the picker so we never offer an empty month.
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of getReceipts()) set.add(toMonthKey(r.date));
    for (const e of getEntries()) {
      if (!e.receiptId && (e.photoUrls?.length ?? 0) > 0) set.add(toMonthKey(e.date));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [open]); // recompute each time the modal opens

  function openModal() {
    const thisMonth = toMonthKey(new Date());
    setScope(months.includes(thisMonth) ? thisMonth : "all");
    setResult(null);
    setOpen(true);
  }

  async function handleDownload() {
    setBusy(true);
    setResult(null);
    try {
      const res = await downloadReceiptsPack(scope);
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
          : "Couldn't build the pack. Try a smaller month.",
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

            <p className="text-sm text-ink-700">
              A ZIP with the receipt photos plus an{" "}
              <span className="font-medium text-ink-900">index.csv</span> listing each
              receipt&rsquo;s vendor, date, total, and line items — ready to hand to
              the accountant.
            </p>

            <div className="mt-4">
              <label htmlFor="packScope" className="label">
                Which period?
              </label>
              <select
                id="packScope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="input"
                disabled={busy}
              >
                <option value="all">All time</option>
                {months.map((mk) => (
                  <option key={mk} value={mk}>
                    {monthLabel(mk)}
                  </option>
                ))}
              </select>
            </div>

            {result && (
              <p className="text-[11px] text-leaf-600 mt-3">{result}</p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                className="btn btn-sm flex-1"
                disabled={busy}
              >
                Close
              </button>
              <button
                onClick={handleDownload}
                className="btn-primary flex-1 h-9 text-sm"
                disabled={busy}
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
