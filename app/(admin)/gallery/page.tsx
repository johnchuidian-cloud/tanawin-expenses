"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getReceipts, getUserById } from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import { reconciliationStatus } from "@/lib/validation";

type Filter = "all" | "reconciled" | "mismatch" | "unfinished";

export default function AdminGalleryPage() {
  useStoreTick();

  const [filter, setFilter] = useState<Filter>("all");

  const receipts = getReceipts();
  const entries = getEntries();

  // Live reconciliation per receipt — derived, not stored
  const rows = useMemo(() => {
    return receipts
      .map((r) => {
        const linked = entries.filter((e) => e.receiptId === r.id);
        const recon = reconciliationStatus(
          r.totalTyped,
          linked.map((e) => e.total),
        );
        return { receipt: r, linked, recon };
      })
      .sort((a, b) => (a.receipt.date < b.receipt.date ? 1 : -1));
  }, [receipts, entries]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => row.recon.status === filter);
  }, [rows, filter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      reconciled: rows.filter((r) => r.recon.status === "reconciled").length,
      mismatch: rows.filter((r) => r.recon.status === "mismatch").length,
      unfinished: rows.filter((r) => r.recon.status === "unfinished").length,
    }),
    [rows],
  );

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200">
        <h1 className="text-base font-medium text-ink-900">Receipt gallery</h1>
        <p className="text-xs text-ink-500 mt-0.5">
          Every captured receipt, with reconciliation status.
        </p>
      </div>

      {/* Filter chips */}
      <div className="px-5 pt-3 flex gap-2 overflow-x-auto">
        {(
          [
            { key: "all", label: `All · ${counts.all}` },
            { key: "reconciled", label: `Reconciled · ${counts.reconciled}` },
            { key: "mismatch", label: `Mismatch · ${counts.mismatch}` },
            { key: "unfinished", label: `Unfinished · ${counts.unfinished}` },
          ] as { key: Filter; label: string }[]
        ).map((chip) => {
          const active = chip.key === filter;
          return (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className={
                "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
                (active
                  ? "bg-ink-900 text-white"
                  : "bg-sand-100 text-ink-700 hover:bg-sand-200")
              }
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink-700">No receipts match this filter.</p>
        </div>
      ) : (
        <div className="px-5 pt-4 grid grid-cols-2 gap-3">
          {filtered.map(({ receipt, linked, recon }) => {
            const capturer = getUserById(receipt.capturedBy);
            const statusColor =
              recon.status === "reconciled"
                ? "badge-leaf"
                : recon.status === "mismatch"
                  ? "badge-amber"
                  : "badge-sand";
            const StatusIcon =
              recon.status === "reconciled"
                ? Check
                : recon.status === "mismatch"
                  ? AlertCircle
                  : Clock;
            const statusText =
              recon.status === "reconciled"
                ? "Reconciled"
                : recon.status === "mismatch"
                  ? recon.difference > 0
                    ? `Over ${peso(Math.abs(recon.difference))}`
                    : `Under ${peso(Math.abs(recon.difference))}`
                  : "Unfinished";
            return (
              <Link
                key={receipt.id}
                href={`/gallery/${receipt.id}`}
                className="rounded-lg bg-white border border-sand-200 overflow-hidden hover:border-sand-300 transition-colors"
              >
                <div className="aspect-square bg-sand-100 flex items-center justify-center overflow-hidden">
                  {receipt.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={receipt.photoUrl}
                      alt={`Receipt from ${receipt.vendor}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-ink-300" />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-xs font-medium text-ink-900 truncate">
                    {receipt.vendor}
                  </p>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {relativeDate(receipt.date)} · {peso(receipt.totalTyped)}
                  </p>
                  <p className="text-[10px] text-ink-500 mt-0.5">
                    {capturer?.name ?? "—"} · {linked.length} line
                    {linked.length === 1 ? "" : "s"}
                  </p>
                  <span className={"badge mt-1.5 " + statusColor}>
                    <StatusIcon className="w-3 h-3" /> {statusText}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
