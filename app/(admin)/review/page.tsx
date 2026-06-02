"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, MessageSquare, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  addNoteToEntry,
  getEntries,
  getPcfLedger,
  getUserById,
  resolveFlag,
} from "@/lib/store";
import { formatDateTime, peso, relativeDate } from "@/lib/format";
import type { Entry, FlagKind } from "@/lib/types";
import PendingTopUpCard from "@/components/PendingTopUpCard";

const FLAG_LABEL: Record<FlagKind, string> = {
  arithmetic: "Arithmetic mismatch",
  duplicate: "Possible duplicate",
  outlier: "Unusual amount",
  "missing-category": "Missing category",
};

export default function AdminReviewPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const entries = getEntries();
  const ledger = getPcfLedger();

  const flaggedEntries = useMemo(
    () => entries.filter((e) => e.flags.some((f) => !f.resolved)),
    [entries],
  );
  const pendingTopUps = useMemo(
    () => ledger.filter((p) => p.kind === "top-up" && p.status === "pending"),
    [ledger],
  );

  const totalReview = flaggedEntries.length + pendingTopUps.length;

  return (
    <div className="pb-4">
      <div className="px-5 pt-5 pb-3 border-b border-sand-200">
        <h1 className="text-base font-medium text-ink-900">Review queue</h1>
        <p className="text-xs text-ink-500 mt-0.5">
          {totalReview === 0
            ? "Nothing needs review — all caught up."
            : `${totalReview} item${totalReview === 1 ? "" : "s"} need${
                totalReview === 1 ? "s" : ""
              } your attention.`}
        </p>
      </div>

      {totalReview === 0 && (
        <div className="px-5 py-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-leaf-50 flex items-center justify-center mb-3">
            <Check className="w-6 h-6 text-leaf-500" />
          </div>
          <p className="text-sm text-ink-700">You&rsquo;re all caught up.</p>
          <p className="text-xs text-ink-500 mt-1">
            New flagged entries and pending top-ups will appear here.
          </p>
        </div>
      )}

      {/* Flagged entries */}
      {flaggedEntries.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Flagged entries · {flaggedEntries.length}
          </p>
          <div className="space-y-3">
            {flaggedEntries.map((entry) => (
              <FlaggedEntryCard key={entry.id} entry={entry} myId={myId} />
            ))}
          </div>
        </section>
      )}

      {/* Pending top-ups */}
      {pendingTopUps.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Top-ups awaiting approval · {pendingTopUps.length}
          </p>
          <div className="space-y-2">
            {pendingTopUps.map((p) => (
              <PendingTopUpCard key={p.id} entry={p} adminId={myId} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Per-entry review card.
 *
 * Two actions:
 *  - "Mark OK"  — accept the entry as-is. Resolves all open flags. Comment optional.
 *  - "Do not approve" — push back. Requires a comment. The flag stays open so
 *    the entry remains in the queue with Lexi's comment recorded; staff can
 *    address it later.
 */
function FlaggedEntryCard({ entry, myId }: { entry: Entry; myId: string | null }) {
  const logger = getUserById(entry.loggedBy);
  const openFlags = entry.flags.filter((f) => !f.resolved);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = comment.trim();

  function handleMarkOk() {
    if (!myId) return;
    if (trimmed.length > 0) {
      addNoteToEntry(entry.id, { authorId: myId, body: trimmed, kind: "comment" });
    }
    for (const flag of openFlags) {
      resolveFlag(entry.id, flag.kind, myId);
    }
  }

  function handleDoNotApprove() {
    if (!myId) return;
    if (trimmed.length === 0) {
      setError("Add a note explaining why before pushing back.");
      return;
    }
    addNoteToEntry(entry.id, {
      authorId: myId,
      body: trimmed,
      kind: "pushback",
    });
    setComment("");
    setError(null);
    // Flag stays open by design — keeps the entry in the queue with the dispute on record.
  }

  return (
    <div className="rounded-lg bg-white border border-sand-200 overflow-hidden">
      <div className="p-3 border-b border-sand-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-900 truncate">
              {entry.vendor} · {entry.item}
            </p>
            <p className="text-[11px] text-ink-500 mt-0.5">
              {relativeDate(entry.date)} · {entry.category} ·{" "}
              {logger?.name ?? "—"}
            </p>
          </div>
          <p className="text-sm font-medium text-ink-900 flex-shrink-0">
            {peso(entry.total)}
          </p>
        </div>
      </div>

      {/* Open flags (read-only) */}
      <div className="divide-y divide-sand-100">
        {openFlags.map((flag) => (
          <div
            key={flag.kind}
            className="p-3 flex items-start gap-3 bg-clay-50/40"
          >
            <AlertCircle className="w-4 h-4 text-clay-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-clay-500">
                {FLAG_LABEL[flag.kind]}
              </p>
              <p className="text-xs text-ink-700 mt-0.5">{flag.message}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Existing notes — surface prior comments so context is visible */}
      {entry.notes.length > 0 && (
        <div className="p-3 border-t border-sand-100 space-y-2 bg-sand-50/60">
          {entry.notes.map((note) => {
            const author = getUserById(note.authorId);
            const isPushback = note.kind === "pushback";
            return (
              <div
                key={note.id}
                className={
                  "flex gap-2 text-xs rounded-md p-2 " +
                  (isPushback ? "bg-clay-50 border border-clay-200" : "")
                }
              >
                <MessageSquare
                  className={
                    "w-3.5 h-3.5 flex-shrink-0 mt-0.5 " +
                    (isPushback ? "text-clay-500" : "text-ink-300")
                  }
                />
                <div className="min-w-0">
                  {isPushback && (
                    <p className="text-[10px] font-medium text-clay-500 uppercase tracking-wide mb-0.5">
                      Did not approve
                    </p>
                  )}
                  <p className="text-ink-700 break-words whitespace-pre-wrap">
                    {note.body}
                  </p>
                  <p className="text-[10px] text-ink-500 mt-0.5">
                    {author?.name ?? "—"} · {formatDateTime(note.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Comment + actions */}
      <div className="p-3 border-t border-sand-100">
        <label
          htmlFor={`note-${entry.id}`}
          className="text-[11px] text-ink-500"
        >
          Add a note (optional for Mark OK, required to push back)
        </label>
        <textarea
          id={`note-${entry.id}`}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            if (error) setError(null);
          }}
          rows={2}
          placeholder="e.g. Asked Janice to double-check vs. the receipt"
          className="w-full mt-1 px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
        />
        {error && <p className="text-xs text-clay-500 mt-1">{error}</p>}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleMarkOk}
            className="btn btn-sm flex-1 bg-leaf-500 text-white border-leaf-500"
            aria-label="Mark all flags on this entry as resolved"
          >
            <Check className="w-3.5 h-3.5" /> Mark OK
          </button>
          <button
            onClick={handleDoNotApprove}
            className="btn btn-sm flex-1 bg-white border-clay-200 text-clay-500"
            aria-label="Push back on this entry with a comment"
          >
            <X className="w-3.5 h-3.5" /> Do not approve
          </button>
        </div>
      </div>
    </div>
  );
}
