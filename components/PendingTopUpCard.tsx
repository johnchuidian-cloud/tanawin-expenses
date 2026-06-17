"use client";

import { useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { approvePcfTopUp, getUserById, rejectPcfTopUp } from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import type { PcfLedgerEntry } from "@/lib/types";

/**
 * Card for a top-up awaiting admin decision. Used on /review and /pcf so
 * the textarea + validation logic only lives in one place.
 *
 * Approve  — note is OPTIONAL. Lexi can leave a question or context
 *            without blocking the approval.
 * Reject   — note is REQUIRED. The reporter needs to know why; an
 *            unexplained rejection isn't useful.
 */
export default function PendingTopUpCard({
  entry,
  adminId,
}: {
  entry: PcfLedgerEntry;
  adminId: string | null;
}) {
  const reporter = getUserById(entry.reportedBy);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    if (!adminId) return;
    approvePcfTopUp(entry.id, adminId, note);
    setNote("");
    setError(null);
  }

  function handleReject() {
    if (!adminId) return;
    if (note.trim().length === 0) {
      setError("Add a note explaining why before rejecting.");
      return;
    }
    rejectPcfTopUp(entry.id, adminId, note);
    setNote("");
    setError(null);
  }

  return (
    <div className="rounded-lg bg-white border border-sand-200 p-3">
      <div className="flex items-start gap-3">
        <Clock className="w-4 h-4 text-ink-300 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">{peso(entry.amount)}</p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            {relativeDate(entry.date)} · reported by {reporter?.name ?? "—"}
          </p>
          {entry.note && (
            <p className="text-xs text-ink-700 mt-1 italic">
              &ldquo;{entry.note}&rdquo;
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <label
          htmlFor={`topup-note-${entry.id}`}
          className="text-[11px] text-ink-500"
        >
          Note (optional for approve, required to reject)
        </label>
        <textarea
          id={`topup-note-${entry.id}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError(null);
          }}
          rows={2}
          placeholder="e.g. Need the PNB ref number before I can release this"
          className="w-full mt-1 px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
        />
        {error && <p className="text-xs text-clay-500 mt-1">{error}</p>}
      </div>

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleApprove}
          className="btn btn-sm flex-1 bg-leaf-500 text-white border-leaf-500"
        >
          <Check className="w-3.5 h-3.5" /> Approve
        </button>
        <button
          onClick={handleReject}
          className="btn btn-sm flex-1 bg-white border-clay-200 text-clay-500"
        >
          <X className="w-3.5 h-3.5" /> Reject
        </button>
      </div>
    </div>
  );
}
