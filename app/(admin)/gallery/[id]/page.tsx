"use client";

export const runtime = "edge";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Image as ImageIcon,
} from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  getEntries,
  getEntriesByReceipt,
  getReceiptById,
  getUserById,
} from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import { reconciliationStatus } from "@/lib/validation";

export default function AdminGalleryDetailPage() {
  useStoreTick();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const receipt = getReceiptById(params.id);
  const [photoErrored, setPhotoErrored] = useState(false);
  const allEntries = getEntries();
  const linkedEntries = useMemo(
    () => (receipt ? getEntriesByReceipt(receipt.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receipt?.id, allEntries],
  );

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
          {receipt.photoUrl && !photoErrored ? (
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

      {/* Line items */}
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
                  className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200"
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
                  <p className="text-sm font-medium text-ink-900 ml-3">
                    {peso(entry.total)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
