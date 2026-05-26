"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, MessageSquare, Send } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { addNoteToEntry, getEntries, getUserById } from "@/lib/store";
import { formatDateTime, peso, relativeDate } from "@/lib/format";
import { staffCategoryLabel } from "@/lib/category-meta";
import type { Entry } from "@/lib/types";

export default function StaffNotesPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const entries = getEntries();

  // Entries logged by me that have any note from someone else, plus
  // the latest external note's timestamp so we can sort by recency.
  const myEntriesWithExternalNotes = useMemo(() => {
    if (!myId) return [] as { entry: Entry; latest: string; hasPushback: boolean }[];
    return entries
      .filter((e) => e.loggedBy === myId)
      .map((entry) => {
        const externalNotes = entry.notes.filter((n) => n.authorId !== myId);
        if (externalNotes.length === 0) return null;
        const latest = externalNotes
          .map((n) => n.createdAt)
          .sort()
          .at(-1)!;
        const hasPushback = externalNotes.some((n) => n.kind === "pushback");
        return { entry, latest, hasPushback };
      })
      .filter((x): x is { entry: Entry; latest: string; hasPushback: boolean } => x !== null)
      .sort((a, b) => (a.latest < b.latest ? 1 : -1));
  }, [entries, myId]);

  const pushbacks = myEntriesWithExternalNotes.filter((x) => x.hasPushback);
  const others = myEntriesWithExternalNotes.filter((x) => !x.hasPushback);

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

      {myEntriesWithExternalNotes.length === 0 && (
        <div className="px-5 py-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-sand-100 flex items-center justify-center mb-3">
            <MessageSquare className="w-6 h-6 text-ink-500" />
          </div>
          <p className="text-sm text-ink-700">Nothing to read here yet.</p>
          <p className="text-xs text-ink-500 mt-1">
            When Lexi leaves a comment on your entries, it shows up here.
          </p>
        </div>
      )}

      {pushbacks.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Needs your attention
          </p>
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
              <NoteThreadCard key={entry.id} entry={entry} myId={myId} pushback={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One entry's note thread: shows the entry context, the full back-and-forth
 * of notes (mine + others, in chronological order), and a reply textarea.
 *
 * Pushback notes (kind === "pushback", from admin "Do not approve") get a
 * tinted bubble so the eye finds them first.
 */
function NoteThreadCard({
  entry,
  myId,
  pushback,
}: {
  entry: Entry;
  myId: string | null;
  pushback: boolean;
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
      setError("Type a reply before sending.");
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
      {/* Entry header */}
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
              {relativeDate(entry.date)} · {staffCategoryLabel(entry.category)}
            </p>
          </div>
          <p className="text-sm font-medium text-ink-900 flex-shrink-0">
            {peso(entry.total)}
          </p>
        </div>
      </Link>

      {/* Note thread */}
      <div className="p-3 space-y-2 bg-sand-50/60">
        {sortedNotes.map((note) => {
          const author = getUserById(note.authorId);
          const mine = note.authorId === myId;
          const isPushback = note.kind === "pushback";
          return (
            <div
              key={note.id}
              className={"flex " + (mine ? "justify-end" : "justify-start")}
            >
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
                  {mine ? "You" : author?.name ?? "—"} ·{" "}
                  {formatDateTime(note.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply */}
      <div className="p-3 border-t border-sand-100">
        <label htmlFor={`reply-${entry.id}`} className="text-[11px] text-ink-500">
          Reply
        </label>
        <textarea
          id={`reply-${entry.id}`}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            if (error) setError(null);
          }}
          rows={2}
          placeholder="Type your reply…"
          className="w-full mt-1 px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
        />
        {error && <p className="text-xs text-clay-500 mt-1">{error}</p>}
        <button
          onClick={handleSendReply}
          className="btn btn-sm w-full mt-2 bg-leaf-500 text-white border-leaf-500"
        >
          <Send className="w-3.5 h-3.5" /> Send reply
        </button>
      </div>
    </div>
  );
}
