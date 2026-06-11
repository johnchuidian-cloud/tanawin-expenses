"use client";

export const runtime = "edge";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  GitMerge,
  Image as ImageIcon,
  Loader2,
  Scissors,
  Trash2,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  deleteEntry,
  ensureReceiptPhoto,
  getEntries,
  getEntriesByReceipt,
  getReceiptById,
  getReceipts,
  getUserById,
  isReceiptPhotoLoaded,
  mergeReceipts,
  splitEntryFromReceipt,
} from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import { paidFromRowClasses } from "@/lib/payment-meta";
import { reconciliationStatus } from "@/lib/validation";

export default function AdminGalleryDetailPage() {
  useStoreTick();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const me = useCurrentUser();

  const receipt = getReceiptById(params.id);
  const [photoErrored, setPhotoErrored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  // Photo isn't downloaded at app start — fetch it for this receipt on open.
  const photoReady = isReceiptPhotoLoaded(params.id);
  useEffect(() => {
    if (params.id) ensureReceiptPhoto(params.id);
  }, [params.id]);
  const allEntries = getEntries();
  const linkedEntries = useMemo(
    () => (receipt ? getEntriesByReceipt(receipt.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipt?.id, allEntries],
  );

  // Possible duplicates: other receipts from the same vendor, closest date
  // first. "Same date" + "same total" together is a strong duplicate signal.
  const duplicateCandidates = useMemo(() => {
    if (!receipt) return [];
    return getReceipts()
      .filter(
        (r) =>
          r.id !== receipt.id &&
          r.vendor.trim().toLowerCase() === receipt.vendor.trim().toLowerCase(),
      )
      .map((r) => ({
        receipt: r,
        sameDate: r.date === receipt.date,
        sameTotal: Math.abs(r.totalTyped - receipt.totalTyped) < 0.5,
        lines: allEntries.filter((e) => e.receiptId === r.id).length,
      }))
      .sort((a, b) => {
        const score = (x: { sameDate: boolean; sameTotal: boolean }) =>
          (x.sameDate ? 2 : 0) + (x.sameTotal ? 1 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.receipt.date < b.receipt.date ? 1 : -1;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.id, receipt?.vendor, receipt?.date, receipt?.totalTyped, allEntries]);

  async function handleMerge(duplicateId: string, label: string) {
    if (!receipt || busy) return;
    const ok = window.confirm(
      `Merge "${label}" into this receipt?\n\nIts line items move onto this receipt and the duplicate receipt is deleted. ` +
        `If both receipts have a photo, the duplicate's photo is discarded. This can't be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    setToolError(null);
    const res = await mergeReceipts(receipt.id, duplicateId);
    setBusy(false);
    if (!res.ok) setToolError(res.reason ?? "Merge failed.");
  }

  async function handleSplit(entryId: string, label: string) {
    if (!receipt || !me || busy) return;
    const isLast = linkedEntries.length === 1;
    const ok = window.confirm(
      `Split "${label}" off this receipt?\n\nIt becomes a standalone entry with its own copy of the receipt photo.` +
        (isLast ? "\n\nThis is the receipt's only item, so the empty receipt will be deleted." : ""),
    );
    if (!ok) return;
    setBusy(true);
    setToolError(null);
    const res = await splitEntryFromReceipt(entryId, me.id);
    setBusy(false);
    if (!res.ok) {
      setToolError(res.reason ?? "Split failed.");
      return;
    }
    if (isLast) router.replace("/gallery");
  }

  async function handleDelete(entryId: string, label: string) {
    if (busy) return;
    const ok = window.confirm(
      `Delete "${label}"?\n\nUse this for true duplicates — the same purchase logged twice. ` +
        `The amount is removed from the books (PCF balance adjusts). This can't be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    setToolError(null);
    const res = await deleteEntry(entryId);
    setBusy(false);
    if (!res.ok) setToolError(res.reason ?? "Delete failed.");
  }

  if (!receipt) {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center">
        <p className="text-sm text-ink-700">Receipt not found.</p>
        <Link href="/gallery" className="btn btn-sm mt-4">
          Back to gallery
        </Link>
      </div>
    );
  }

  const capturer = getUserById(receipt.capturedBy);
  const recon = reconciliationStatus(
    receipt.totalTyped,
    linkedEntries.map((e) => e.total),
  );

  const statusLabel =
    recon.status === "reconciled"
      ? "Fully reconciled"
      : recon.status === "mismatch"
        ? `Mismatch · ${recon.difference > 0 ? "over by" : "under by"} ${peso(Math.abs(recon.difference))}`
        : `Unfinished · ${peso(receipt.totalTyped - recon.sum)} of receipt still to log`;

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <p className="text-base font-medium text-ink-900">Receipt</p>
      </div>

      {/* Receipt card */}
      <div className="px-5 pt-4">
        <div className="rounded-lg bg-white border border-sand-200 overflow-hidden">
          {!photoReady ? (
            <div className="bg-sand-50 h-24 flex items-center justify-center gap-2 text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <p className="text-xs">Loading photo…</p>
            </div>
          ) : receipt.photoUrl && !photoErrored ? (
            <div className="bg-sand-50 aspect-[4/3] flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receipt.photoUrl}
                alt={`Receipt from ${receipt.vendor}`}
                className="max-h-full max-w-full object-contain"
                onError={() => setPhotoErrored(true)}
              />
            </div>
          ) : (
            <div className="bg-sand-50 h-24 flex items-center justify-center gap-2 text-ink-500">
              <ImageIcon className="w-5 h-5" />
              <p className="text-xs">No photo on file</p>
            </div>
          )}
          <div className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-ink-900">
                  {receipt.vendor}
                </p>
                <p className="text-[11px] text-ink-500 mt-0.5">
                  {relativeDate(receipt.date)} · captured by {capturer?.name ?? "—"}
                </p>
              </div>
              <p className="text-xl font-medium text-ink-900">
                {peso(receipt.totalTyped)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reconciliation status */}
      <div className="px-5 pt-4">
        <div
          className={
            "rounded-lg p-3 flex items-start gap-3 " +
            (recon.status === "reconciled"
              ? "bg-leaf-50 border border-leaf-100"
              : recon.status === "mismatch"
                ? "bg-clay-50 border border-clay-200"
                : "bg-sand-100 border border-sand-200")
          }
        >
          {recon.status === "reconciled" ? (
            <Check className="w-4 h-4 text-leaf-500 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle
              className={
                "w-4 h-4 flex-shrink-0 mt-0.5 " +
                (recon.status === "mismatch" ? "text-clay-500" : "text-ink-500")
              }
            />
          )}
          <div className="flex-1">
            <p
              className={
                "text-sm font-medium " +
                (recon.status === "reconciled"
                  ? "text-leaf-600"
                  : recon.status === "mismatch"
                    ? "text-clay-500"
                    : "text-ink-700")
              }
            >
              {statusLabel}
            </p>
            <p className="text-[11px] text-ink-500 mt-0.5">
              Line items sum to {peso(recon.sum)} · receipt is{" "}
              {peso(receipt.totalTyped)}
            </p>
          </div>
        </div>
      </div>

      {/* Line items — each opens its entry; split/delete are the experimental
          duplicate-cleanup tools. */}
      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Line items · {linkedEntries.length}
        </p>
        {linkedEntries.length === 0 ? (
          <p className="text-xs text-ink-500">
            No line items logged against this receipt yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {linkedEntries.map((entry) => {
              const hasOpenFlag = entry.flags.some((f) => !f.resolved);
              const logger = getUserById(entry.loggedBy);
              return (
                <div
                  key={entry.id}
                  className={
                    "rounded-lg border overflow-hidden " +
                    paidFromRowClasses(entry.paidFrom)
                  }
                >
                  <Link
                    href={`/entries/${entry.id}`}
                    className="flex items-center justify-between p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-900 truncate">
                        {hasOpenFlag && (
                          <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />
                        )}
                        {entry.item}
                      </p>
                      <p className="text-[11px] text-ink-500 mt-0.5">
                        {entry.qty} × {peso(entry.unitPrice, { cents: true })} ·{" "}
                        {entry.category} · {logger?.name ?? "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                      <p className="text-sm font-medium text-ink-900">
                        {peso(entry.total)}
                      </p>
                      <ChevronRight className="w-4 h-4 text-ink-300" />
                    </div>
                  </Link>
                  <div className="flex border-t border-sand-200/70 divide-x divide-sand-200/70">
                    <button
                      onClick={() => handleSplit(entry.id, entry.item)}
                      disabled={busy}
                      className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-ink-700 hover:bg-white/60 disabled:opacity-50"
                    >
                      <Scissors className="w-3 h-3" /> Split off
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id, entry.item)}
                      disabled={busy}
                      className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-clay-500 hover:bg-white/60 disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" /> Delete duplicate
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Duplicate tools — experimental. Same-vendor receipts, strongest
          duplicate signals first. */}
      {duplicateCandidates.length > 0 && (
        <div className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-1 flex items-center gap-1.5">
            <GitMerge className="w-4 h-4 text-ink-500" />
            Possible duplicates · {duplicateCandidates.length}
          </p>
          <p className="text-[11px] text-ink-500 mb-2">
            Other receipts from {receipt.vendor}. Merging moves a receipt&rsquo;s
            line items onto this one and deletes it. Experimental — double-check
            before merging.
          </p>
          <div className="space-y-1.5">
            {duplicateCandidates.map(({ receipt: r, sameDate, sameTotal, lines }) => (
              <div
                key={r.id}
                className="rounded-lg bg-white border border-sand-200 overflow-hidden"
              >
                <Link
                  href={`/gallery/${r.id}`}
                  className="flex items-center justify-between p-2.5 hover:bg-sand-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate">
                      {r.vendor} · {peso(r.totalTyped)}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      {relativeDate(r.date)} · {lines} line{lines === 1 ? "" : "s"}
                      {sameDate && <span className="ml-1.5 badge badge-amber">Same date</span>}
                      {sameTotal && <span className="ml-1.5 badge badge-amber">Same total</span>}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-300 flex-shrink-0" />
                </Link>
                <button
                  onClick={() =>
                    handleMerge(r.id, `${r.vendor} · ${peso(r.totalTyped)} · ${relativeDate(r.date)}`)
                  }
                  disabled={busy}
                  className="w-full h-8 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-ink-700 border-t border-sand-100 hover:bg-sand-50 disabled:opacity-50"
                >
                  <GitMerge className="w-3 h-3" /> Merge into this receipt
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {toolError && (
        <p className="px-5 pt-3 text-xs text-clay-500">{toolError}</p>
      )}
      {busy && (
        <p className="px-5 pt-3 text-xs text-ink-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
        </p>
      )}
    </div>
  );
}
