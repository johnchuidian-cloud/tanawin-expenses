"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  getEntries,
  getPcfLedger,
  getUserById,
  resolvePcfRejection,
} from "@/lib/store";
import { formatDateTime, peso, relativeDate } from "@/lib/format";
import type { Entry, PcfLedgerEntry } from "@/lib/types";

/**
 * Rejections inbox.
 *
 * Surfaces everything that needs follow-up after a "no":
 *  - PCF top-ups Lexi rejected and hasn't marked resolved yet
 *  - Expense entries that got a pushback note ("Do not approve") AND
 *    still have an open flag — they auto-clear from this tab when the
 *    flag is resolved
 *
 * Lexi sees the full thread on each card so she can decide whether the
 * issue has been addressed, then taps "Mark resolved" to close it out
 * (top-ups) or jumps into /review to clear the flag (entries).
 */
export default function AdminRejectionsPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const ledger = getPcfLedger();
  const entries = getEntries();

  const openRejectedTopUps = useMemo(
    () =>
      ledger
        .filter((p) => p.kind === "top-up" && p.status === "rejected" && !p.resolved)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [ledger],
  );

  const pushedBackEntries = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.flags.some((f) => !f.resolved) &&
            e.notes.some((n) => n.kind === "pushback"),
        )
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries],
  );

  const resolvedRecently = useMemo(
    () =>
      ledger
        .filter(
          (p) => p.kind === "top-up" && p.status === "rejected" && p.resolved,
        )
        .sort((a, b) =>
          (a.resolvedAt ?? a.date) < (b.resolvedAt ?? b.date) ? 1 : -1,
        )
        .slice(0, 5),
    [ledger],
  );

  const totalOpen = openRejectedTopUps.length + pushedBackEntries.length;

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-sand-200">
        <h1 className="text-base font-medium text-ink-900">Rejections</h1>
        <p className="text-xs text-ink-500 mt-0.5">
          {totalOpen === 0
            ? "Nothing open — every rejection has been addressed."
            : `${totalOpen} item${totalOpen === 1 ? "" : "s"} still need${totalOpen === 1 ? "s" : ""} follow-up.`}
        </p>
      </div>

      {totalOpen === 0 && resolvedRecently.length === 0 && (
        <div className="px-5 py-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-leaf-50 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-leaf-500" />
          </div>
          <p className="text-sm text-ink-700">All clear.</p>
          <p className="text-xs text-ink-500 mt-1">
            Rejected top-ups and pushed-back entries will land here until
            they&rsquo;re resolved.
          </p>
        </div>
      )}

      {/* Rejected top-ups */}
      {openRejectedTopUps.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Rejected top-ups · {openRejectedTopUps.length}
          </p>
          <div className="space-y-2">
            {openRejectedTopUps.map((p) => (
              <RejectedTopUpCard key={p.id} entry={p} myId={myId} />
            ))}
          </div>
        </section>
      )}

      {/* Pushed-back entries */}
      {pushedBackEntries.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Entries needing follow-up · {pushedBackEntries.length}
          </p>
          <p className="text-[11px] text-ink-500 mb-2">
            Auto-clear from this list once you Mark OK the open flag on
            /review.
          </p>
          <div className="space-y-2">
            {pushedBackEntries.map((entry) => (
              <PushedBackEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {/* Recently resolved — short footer for context */}
      {resolvedRecently.length > 0 && (
        <section className="px-5 pt-6">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Recently resolved
          </p>
          <div className="space-y-1.5">
            {resolvedRecently.map((p) => {
              const resolver = p.resolvedBy ? getUserById(p.resolvedBy) : null;
              return (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-sand-50 border border-sand-200"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-leaf-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink-900">
                        Top-up · {peso(p.amount)}
                      </p>
                      <p className="text-[11px] text-ink-500 mt-0.5">
                        Resolved by {resolver?.name ?? "—"}
                        {p.resolvedAt && ` · ${formatDateTime(p.resolvedAt)}`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function RejectedTopUpCard({
  entry,
  myId,
}: {
  entry: PcfLedgerEntry;
  myId: string | null;
}) {
  const reporter = getUserById(entry.reportedBy);
  const rejecter = entry.approvedBy ? getUserById(entry.approvedBy) : null;

  return (
    <div className="rounded-lg bg-white border border-clay-200 overflow-hidden">
      <div className="p-3 flex items-start gap-3 bg-clay-50/40 border-b border-sand-100">
        <XCircle className="w-4 h-4 text-clay-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">
            Top-up · {peso(entry.amount)}
          </p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            {relativeDate(entry.date)} · reported by {reporter?.name ?? "—"}
            {rejecter && ` · rejected by ${rejecter.name}`}
          </p>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {entry.note && (
          <p className="text-xs text-ink-700 italic">
            <span className="text-ink-500">{reporter?.name ?? "—"}: </span>
            &ldquo;{entry.note}&rdquo;
          </p>
        )}
        {entry.decisionNote && (
          <div className="flex items-start gap-2 text-xs">
            <MessageSquare className="w-3.5 h-3.5 text-clay-500 flex-shrink-0 mt-0.5" />
            <p className="text-ink-700 break-words">
              <span className="text-clay-500 font-medium">
                {rejecter?.name ?? "Admin"}:{" "}
              </span>
              {entry.decisionNote}
            </p>
          </div>
        )}
      </div>

      <div className="p-3 pt-0">
        <button
          onClick={() => myId && resolvePcfRejection(entry.id, myId)}
          className="btn btn-sm w-full bg-leaf-500 text-white border-leaf-500"
        >
          <Check className="w-3.5 h-3.5" /> Mark resolved
        </button>
      </div>
    </div>
  );
}

function PushedBackEntryCard({ entry }: { entry: Entry }) {
  const logger = getUserById(entry.loggedBy);
  const openFlags = entry.flags.filter((f) => !f.resolved);
  const pushbackNotes = entry.notes.filter((n) => n.kind === "pushback");
  const latestPushback = pushbackNotes[pushbackNotes.length - 1];
  const author = latestPushback ? getUserById(latestPushback.authorId) : null;

  return (
    <Link
      href={`/entries/${entry.id}`}
      className="block rounded-lg bg-white border border-clay-200 overflow-hidden hover:bg-sand-50/40 transition-colors"
    >
      <div className="p-3 flex items-start gap-3 bg-clay-50/40 border-b border-sand-100">
        <AlertCircle className="w-4 h-4 text-clay-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">
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

      <div className="p-3 space-y-1.5">
        {openFlags.map((flag) => (
          <p key={flag.kind} className="text-[11px] text-clay-500">
            ⚠ {flag.message}
          </p>
        ))}
        {latestPushback && (
          <div className="flex items-start gap-2 text-xs pt-1">
            <MessageSquare className="w-3.5 h-3.5 text-clay-500 flex-shrink-0 mt-0.5" />
            <p className="text-ink-700 break-words">
              <span className="text-clay-500 font-medium">
                {author?.name ?? "Admin"}:{" "}
              </span>
              {latestPushback.body}
            </p>
          </div>
        )}
        <p className="text-[11px] text-ink-500 pt-1">
          Open in /review to Mark OK or follow up →
        </p>
      </div>
    </Link>
  );
}
