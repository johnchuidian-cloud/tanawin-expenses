"use client";

import { Trash2 } from "lucide-react";
import { getUserById } from "@/lib/store";
import { formatDateTime } from "@/lib/format";
import type { AuditRecord } from "@/lib/types";

/**
 * Read-only record of line items an admin removed from a receipt. Shown on
 * the receipt detail pages so a deleted line never just silently vanishes —
 * there's always a trail of what was removed, by whom, and when.
 */
export default function ReceiptDeletionsLog({
  deletions,
}: {
  deletions?: AuditRecord[];
}) {
  if (!deletions || deletions.length === 0) return null;
  const sorted = [...deletions].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <div className="px-5 pt-5">
      <p className="text-sm font-medium text-ink-900 mb-2 flex items-center gap-1.5">
        <Trash2 className="w-4 h-4 text-ink-500" /> Deleted line items ·{" "}
        {sorted.length}
      </p>
      <div className="rounded-lg border border-sand-200 bg-sand-50/60 divide-y divide-sand-100">
        {sorted.map((rec, i) => {
          const who = getUserById(rec.by)?.name ?? "—";
          return (
            <div key={i} className="px-3 py-2">
              <p className="text-xs text-ink-700 line-through decoration-ink-300">
                {rec.summary}
              </p>
              <p className="text-[10px] text-ink-500 mt-0.5">
                {who} · {formatDateTime(rec.at)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
