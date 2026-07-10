"use client";

/**
 * Group several already-logged entries onto one newly uploaded receipt — the
 * backlog case: receipts from before the app existed, keyed in as separate line
 * items, now being photographed and filed against their real receipt with its
 * printed total and VAT.
 *
 * Selecting entries that don't belong on the same physical receipt is the easy
 * mistake, so the modal partitions the selection up front (see
 * inspectGroupSelection) and shows exactly what will and won't be grouped
 * before the admin commits.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Receipt, X } from "lucide-react";
import { groupEntriesIntoReceipt, inspectGroupSelection, type GroupSelection } from "@/lib/store";
import { fileToCompressedDataUrl } from "@/lib/image";
import { useCurrentUser } from "@/lib/auth";
import { peso, relativeDate } from "@/lib/format";
import type { Entry } from "@/lib/types";

/** Philippine VAT is printed inside the total: 12% of the pre-VAT price. */
const VAT_RATE = 0.12;
function vatOfInclusiveTotal(total: number): number {
  return Math.round(((total * VAT_RATE) / (1 + VAT_RATE)) * 100) / 100;
}

export default function GroupReceiptModal({
  entries,
  onClose,
  onDone,
}: {
  entries: Entry[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const me = useCurrentUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [sel, setSel] = useState<GroupSelection | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [totalText, setTotalText] = useState("");
  const [vatText, setVatText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Partition the selection. Async because it may need to fetch the existing
  // receipts' photos before it can tell a placeholder from a real receipt — and
  // that fetch notifies the store, re-rendering our parent. Keying the effect on
  // a joined id string rather than the `entries` array keeps that from looping.
  const idKey = entries.map((e) => e.id).join(",");
  useEffect(() => {
    let live = true;
    inspectGroupSelection(idKey.split(",")).then((s) => {
      if (!live) return;
      setSel(s);
      setTotalText(s.total.toFixed(2));
    });
    return () => {
      live = false;
    };
  }, [idKey]);

  const itemSum = sel?.total ?? 0;
  const printedTotal = Number(totalText);
  const totalValid = totalText.trim() !== "" && Number.isFinite(printedTotal) && printedTotal > 0;
  const vat = vatText.trim() === "" ? 0 : Number(vatText);
  const vatValid = vatText.trim() === "" || (Number.isFinite(vat) && vat >= 0 && vat < printedTotal);
  const difference = totalValid ? Math.round((itemSum - printedTotal) * 100) / 100 : 0;

  const canApply = !!sel && sel.eligible.length > 0 && totalValid && vatValid && !busy && !photoBusy;

  async function handleFile(file: File) {
    setPhotoBusy(true);
    setErr(null);
    try {
      setPhotoUrl(await fileToCompressedDataUrl(file));
    } catch {
      setErr("Couldn't read that image — try another photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleApply() {
    if (!canApply || !sel || !me) return;
    setBusy(true);
    setErr(null);
    const res = await groupEntriesIntoReceipt({
      entryIds: sel.eligible.map((e) => e.id),
      vendor: sel.vendor,
      date: sel.date,
      photoUrl: photoUrl ?? undefined,
      receiptTotal: printedTotal,
      vatAmount: vat > 0 ? vat : undefined,
      capturedBy: me.id,
    });
    if (!res.ok) {
      setErr(res.reason);
      setBusy(false);
      return;
    }
    const n = res.moved;
    onDone(res.warning ?? `Grouped ${n} item${n === 1 ? "" : "s"} onto one receipt`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 mb-4 sm:mb-0 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-leaf-600" />
            <p className="text-base font-medium text-ink-900">Group onto one receipt</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cancel"
            className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center hover:bg-sand-100"
          >
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>

        {!sel ? (
          <div className="py-10 flex items-center justify-center text-ink-500 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking the selection…
          </div>
        ) : sel.eligible.length === 0 ? (
          <>
            <p className="text-xs text-ink-600 mt-3 mb-4">
              None of these entries can go on a new receipt — see why below. A receipt covers one
              vendor on one date, and entries already filed under a photographed receipt stay there.
            </p>
            <ExcludedList excluded={sel.excluded} />
            <button onClick={onClose} className="btn btn-sm w-full mt-4">
              Close
            </button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-ink-500 mb-4">
              {sel.vendor} · {relativeDate(sel.date)} · this doesn&apos;t change the petty cash balance.
            </p>

            {/* What's being grouped */}
            <div className="rounded-xl border border-sand-200 divide-y divide-sand-100 mb-1">
              {sel.eligible.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <p className="text-xs text-ink-800 truncate">{e.item}</p>
                  <p className="text-xs text-ink-600 tabular-nums flex-shrink-0">{peso(e.total)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-sand-50">
                <p className="text-xs font-medium text-ink-900">
                  {sel.eligible.length === 1 ? "1 item adds up to" : `${sel.eligible.length} items add up to`}
                </p>
                <p className="text-xs font-medium text-ink-900 tabular-nums">{peso(itemSum)}</p>
              </div>
            </div>

            {sel.vendorVariants.length > 1 && (
              <p className="text-[11px] text-ink-500 mb-3">
                Spelled {sel.vendorVariants.map((v) => `“${v}”`).join(" and ")} on these entries. The
                receipt will use {sel.vendor}; the entries keep their own spelling.
              </p>
            )}

            <ExcludedList excluded={sel.excluded} />

            {/* Photo */}
            <div className="mt-4 mb-3">
              <p className="text-sm font-medium text-ink-900 mb-1.5">Receipt photo</p>
              {photoUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt="Receipt"
                    className="w-14 h-14 rounded-lg object-cover border border-sand-200"
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="btn btn-sm text-ink-700"
                  >
                    Choose a different photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={photoBusy}
                  className="btn btn-sm w-full text-ink-700 disabled:opacity-60"
                >
                  {photoBusy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading photo…
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-3.5 h-3.5" /> Upload the receipt photo
                    </>
                  )}
                </button>
              )}
              <p className="text-[11px] text-ink-500 mt-1">Optional — you can add it later.</p>
              {/* No `capture` attribute → phones offer gallery, camera, and files. */}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Printed total */}
            <div className="mb-3">
              <label className="text-sm font-medium text-ink-900 block mb-1.5" htmlFor="grp-total">
                Total printed on the receipt
              </label>
              <input
                id="grp-total"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={totalText}
                onChange={(e) => setTotalText(e.target.value)}
                className="input h-10"
              />
              {totalValid && difference !== 0 && (
                <p className="text-[11px] text-ink-500 mt-1">
                  {difference < 0
                    ? `The items are ${peso(Math.abs(difference))} short of the printed total — the receipt will show as unfinished until the missing items are logged.`
                    : `The items exceed the printed total by ${peso(difference)} — the receipt will show as a mismatch.`}
                </p>
              )}
            </div>

            {/* VAT */}
            <div className="mb-1">
              <label className="text-sm font-medium text-ink-900 block mb-1.5" htmlFor="grp-vat">
                VAT included in that total
              </label>
              <div className="flex gap-2">
                <input
                  id="grp-vat"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="0.00"
                  value={vatText}
                  onChange={(e) => setVatText(e.target.value)}
                  className="input h-10 flex-1"
                />
                <button
                  type="button"
                  onClick={() => setVatText(vatOfInclusiveTotal(printedTotal).toFixed(2))}
                  disabled={!totalValid}
                  className="btn btn-sm flex-shrink-0 disabled:opacity-50"
                >
                  12% of total
                </button>
              </div>
              {!vatValid ? (
                <p className="text-[11px] text-red-600 mt-1">VAT must be less than the printed total.</p>
              ) : (
                <p className="text-[11px] text-ink-500 mt-1">
                  Optional. For the bookkeeper only — it doesn&apos;t change the petty cash balance.
                </p>
              )}
            </div>

            {err && <p className="text-xs text-red-600 mt-3">{err}</p>}

            <div className="flex gap-2 mt-5">
              <button onClick={onClose} className="btn btn-sm flex-1" disabled={busy}>
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!canApply}
                className="btn-primary flex-1 h-9 text-sm disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Group {sel.eligible.length}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExcludedList({ excluded }: { excluded: Array<{ entry: Entry; reason: string }> }) {
  if (excluded.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-[11px] font-medium text-amber-900 mb-1">
        Leaving {excluded.length} out
      </p>
      <ul className="space-y-1">
        {excluded.map(({ entry, reason }) => (
          <li key={entry.id} className="text-[11px] text-amber-800">
            <span className="font-medium">{entry.item}</span> — {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
