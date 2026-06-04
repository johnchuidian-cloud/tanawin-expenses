"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUp, MessageSquare, Send } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { addNoteToEntry, getEntries, getPcfLedger, getUserById } from "@/lib/store";
import { formatDateTime, peso, relativeDate } from "@/lib/format";
import { staffCategoryLabel } from "@/lib/category-meta";
import type { Entry } from "@/lib/types";

export default function NotesPage() {
  useStoreTick();
  const me = useCurrentUser();

  if (!me) {
    return <div className="px-5 py-10 text-center text-sm text-ink-500">Loading…</div>;
  }

  return me.role === "admin" ? (
    <AdminNotesView myId={me.id} />
  ) : (
    <StaffNotesView myId={me.id} />
  );
}

/* ----------------------------- Admin view ----------------------------- */
/**
 * Lexi's view: every note in the system in one place — entry conversations
 * across the whole team, plus the notes left on PCF top-ups. This is the
 * "any and all notes" feed she was missing (admin had no Notes tab before).
 */
function AdminNotesView({ myId }: { myId: string }) {
  const entries = getEntries();
  const ledger = getPcfLedger();

  const entriesWithNotes = useMemo(
    () =>
      entries
        .filter((e) => e.notes.length > 0)
        .map((entry) => {
          const latest = entry.notes
            .map((n) => n.createdAt)
            .sort()
            .at(-1)!;
          return { entry, latest };
        })
        .sort((a, b) => (a.latest < b.latest ? 1 : -1)),
    [entries],
  );

  // Top-ups that carry a reporter note or an admin decision note.
  const topUpNotes = useMemo(
    () =>
      ledger
        .filter((p) => p.kind === "top-up" && (p.note || p.decisionNote))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [ledger],
  );

  const nothing = entriesWithNotes.length === 0 && topUpNotes.length === 0;

  return (
    <div className="pb-4">
      <div className="px-5 pt-5 pb-3 border-b border-sand-200">
        <h1 className="text-base font-medium text-ink-900">Notes</h1>
        <p className="text-xs text-ink-500 mt-0.5">
          Every entry conversation and PCF top-up note across the team.
        </p>
      </div>

      {nothing && (
        <div className="px-5 py-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-sand-100 flex items-center justify-center mb-3">
            <MessageSquare className="w-6 h-6 text-ink-500" />
          </div>
          <p className="text-sm text-ink-700">No notes yet.</p>
          <p className="text-xs text-ink-500 mt-1">
            Notes you or staff add to entries and top-ups will show up here.
          </p>
        </div>
      )}

      {/* PCF top-up notes */}
      {topUpNotes.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            PCF top-up notes · {topUpNotes.length}
          </p>
          <div className="space-y-2">
            {topUpNotes.map((p) => {
              const reporter = getUserById(p.reportedBy);
              const approver = p.approvedBy ? getUserById(p.approvedBy) : null;
              return (
                <Link
                  key={p.id}
                  href="/pcf"
                  className="block p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ArrowUp className="w-4 h-4 text-leaf-600 flex-shrink-0" />
                    <p className="text-sm font-medium text-ink-900">{peso(p.amount)} top-up</p>
                    <span className="text-[11px] text-ink-500">· {relativeDate(p.date)}</span>
                  </div>
                  {p.note && (
                    <p className="text-xs text-ink-700 mt-1.5 italic">
                      &ldquo;{p.note}&rdquo;
                      <span className="not-italic text-ink-500"> — {reporter?.name ?? "—"}</span>
                    </p>
                  )}
                  {p.decisionNote && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                      <MessageSquare className="w-3 h-3 text-ink-300 flex-shrink-0 mt-0.5" />
                      <p className="text-ink-700 break-words">
                        <span className="text-ink-500">{approver?.name ?? "Admin"}: </span>
                        {p.decisionNote}
                      </p>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Entry conversations */}
      {entriesWithNotes.length > 0 && (
        <section className="px-5 pt-6">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Entry notes · {entriesWithNotes.length}
          </p>
          <div className="space-y-3">
            {entriesWithNotes.map(({ entry }) => (
              <NoteThreadCard key={entry.id} entry={entry} myId={myId} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ----------------------------- Staff view ----------------------------- */
function StaffNotesView({ myId }: { myId: string }) {
  const entries = getEntries();

  const myEntriesWithExternalNotes = useMemo(() => {
    return entries
      .filter((e) => e.loggedBy === myId)
      .map((entry) => {
        const externalNotes = entry.notes.filter((n) => n.authorId !== myId);
        if (externalNotes.length === 0) return null;
        const latest = externalNotes.map((n) => n.createdAt).sort().at(-1)!;
        const hasPushback = externalNotes.some((n) => n.kind === "pushback");
        return { entry, latest, hasPushback };
      })
      .filter((x): x is { entry: Entry; latest: string; hasPushback: boolean } => x !== null)
      .sort((a, b) => (a.latest < b.latest ? 1 : -1));
  }, [entries, myId]);

  const pushbacks = myEntriesWithExternalNotes.filter((x) => x.hasPushback);
  const others = myEntriesWithExternalNotes.filter((x) => !x.hasPushback);

  const usedEntryIds = new Set(myEntriesWithExternalNotes.map(({ entry }) => entry.id));
  const starters = useMemo(() => {
    return entries
      .filter((e) => e.loggedBy === myId && !usedEntryIds.has(e.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, myId, myEntriesWithExternalNotes]);

  return (
    <div className="pb-4">
      <div className="px-5 pt-5 pb-3 border-b border-sand-200">
        <h1 className="text-base font-medium text-ink-900">Notes on your entries</h1>
        <p className="text-xs text-ink-500 mt-0.5">
          {myEntriesWithExternalNotes.length === 0
            ? "No notes from Lexi or teammates yet."
            : pushbacks.length > 0
              ? `${pushbacks.length} entr${pushbacks.length === 1 ? "y" : "ies"} need${pushbacks.length === 1 ? "s" : ""} your attention.`
              : `${myEntriesWithExternalNotes.length} entr${myEntriesWithExternalNotes.length === 1 ? "y has" : "ies have"} comments.`}
        </p>
      </div>

      {myEntriesWithExternalNotes.length === 0 && starters.length === 0 && (
        <div className="px-5 py-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-sand-100 flex items-center justify-center mb-3">
            <MessageSquare className="w-6 h-6 text-ink-500" />
          </div>
          <p className="text-sm text-ink-700">Nothing here yet.</p>
          <p className="text-xs text-ink-500 mt-1">
            Log an expense and you&rsquo;ll be able to add notes about it from here.
          </p>
        </div>
      )}

      {pushbacks.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Needs your attention</p>
          <div className="space-y-3">
            {pushbacks.map(({ entry }) => (
              <NoteThreadCard key={entry.id} entry={entry} myId={myId} pushback />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Other comments</p>
          <div className="space-y-3">
            {others.map(({ entry }) => (
              <NoteThreadCard key={entry.id} entry={entry} myId={myId} />
            ))}
          </div>
        </section>
      )}

      {starters.length > 0 && (
        <section className="px-5 pt-6">
          <p className="text-sm font-medium text-ink-900">Start a new note</p>
          <p className="text-[11px] text-ink-500 mt-0.5 mb-2">
            Add context to a recent entry you logged — Lexi sees it immediately and on the
            review card if the entry is flagged.
          </p>
          <div className="space-y-3">
            {starters.map((entry) => (
              <NoteThreadCard key={entry.id} entry={entry} myId={myId} compose />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* --------------------------- Shared thread card --------------------------- */
function NoteThreadCard({
  entry,
  myId,
  pushback = false,
  compose = false,
}: {
  entry: Entry;
  myId: string | null;
  pushback?: boolean;
  compose?: boolean;
}) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasOpenFlag = entry.flags.some((f) => !f.resolved);

  const sortedNotes = useMemo(
    () => [...entry.notes].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [entry.notes],
  );

  function handleSendReply() {
    if (!myId) return;
    const trimmed = reply.trim();
    if (trimmed.length === 0) {
      setError(compose ? "Type a note before sending." : "Type a reply before sending.");
      return;
    }
    addNoteToEntry(entry.id, { authorId: myId, body: trimmed, kind: "comment" });
    setReply("");
    setError(null);
  }

  return (
    <div
      className={
        "rounded-lg border overflow-hidden " +
        (pushback ? "border-clay-200 bg-white" : "border-sand-200 bg-white")
      }
    >
      <Link
        href={`/entries/${entry.id}`}
        className="block p-3 border-b border-sand-100 hover:bg-sand-50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-900 truncate">
              {hasOpenFlag && (
                <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />
              )}
              {entry.vendor} · {entry.item}
            </p>
            <p className="text-[11px] text-ink-500 mt-0.5">
              {relativeDate(entry.date)} · {staffCategoryLabel(entry.category)} ·{" "}
              {getUserById(entry.loggedBy)?.name ?? "—"}
            </p>
          </div>
          <p className="text-sm font-medium text-ink-900 flex-shrink-0">{peso(entry.total)}</p>
        </div>
      </Link>

      {sortedNotes.length === 0 ? (
        <div className="px-3 py-2 bg-sand-50/60 text-[11px] text-ink-500">
          No notes yet — be the first.
        </div>
      ) : (
        <div className="p-3 space-y-2 bg-sand-50/60">
          {sortedNotes.map((note) => {
            const author = getUserById(note.authorId);
            const mine = note.authorId === myId;
            const isPushback = note.kind === "pushback";
            return (
              <div key={note.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[85%] rounded-lg px-3 py-2 " +
                    (isPushback
                      ? "bg-clay-50 border border-clay-200"
                      : mine
                        ? "bg-leaf-50 border border-leaf-100"
                        : "bg-white border border-sand-200")
                  }
                >
                  {isPushback && (
                    <p className="text-[10px] font-medium text-clay-500 uppercase tracking-wide mb-0.5">
                      Did not approve
                    </p>
                  )}
                  <p className="text-xs text-ink-900 break-words whitespace-pre-wrap">
                    {note.body}
                  </p>
                  <p className="text-[10px] text-ink-500 mt-1">
                    {mine ? "You" : author?.name ?? "—"} · {formatDateTime(note.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="p-3 border-t border-sand-100">
        <label htmlFor={`reply-${entry.id}`} className="text-[11px] text-ink-500">
          {compose ? "Add a note" : "Reply"}
        </label>
        <textarea
          id={`reply-${entry.id}`}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            if (error) setError(null);
          }}
          rows={2}
          placeholder={compose ? "e.g. Wet rice today, drying it before storing" : "Type your reply…"}
          className="w-full mt-1 px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
        />
        {error && <p className="text-xs text-clay-500 mt-1">{error}</p>}
        <button
          onClick={handleSendReply}
          className="btn btn-sm w-full mt-2 bg-leaf-500 text-white border-leaf-500"
        >
          <Send className="w-3.5 h-3.5" /> {compose ? "Send note" : "Send reply"}
        </button>
      </div>
    </div>
  );
}
