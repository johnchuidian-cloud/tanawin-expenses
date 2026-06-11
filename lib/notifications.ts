/**
 * Notification feed for the header bell.
 *
 * "Notification" here means: someone is waiting on YOU. The badge doesn't
 * clear when you look at it — it clears when you act (reply to the thread,
 * or follow up the rejected top-up). That's deliberate: the point is that
 * staff were missing Lexi's rejections/replies, so the reminder persists
 * until the conversation is actually answered.
 *
 * Sources:
 *  - Entry conversations you're part of (you logged the entry, or you've
 *    written in its thread) where the LATEST note is from someone else.
 *    If the unanswered notes include a "pushback" (Lexi's "Do not approve"),
 *    the notification is flagged urgent.
 *  - Staff only: your PCF top-ups that were rejected and not yet resolved —
 *    Lexi's rejection reason is shown right in the notification, since staff
 *    have no other screen that surfaces it.
 */

import { getEntries, getPcfLedger, getUserById } from "./store";
import type { User } from "./types";

export interface AppNotification {
  id: string;
  kind: "pushback" | "note" | "topup-rejected";
  /** Short headline, e.g. "Lexi did not approve" */
  title: string;
  /** What it's about, e.g. "Puregold · Rice 5kg · ₱250" */
  subject: string;
  /** Snippet of the message itself */
  body: string;
  href: string;
  /** ISO timestamp used for sorting, newest first */
  at: string;
}

function snippet(s: string, max = 90): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function getNotificationsFor(user: User): AppNotification[] {
  const out: AppNotification[] = [];

  // --- Entry conversations awaiting your reply ---
  for (const e of getEntries()) {
    if (e.notes.length === 0) continue;
    const involved =
      e.loggedBy === user.id || e.notes.some((n) => n.authorId === user.id);
    if (!involved) continue;

    const sorted = [...e.notes].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
    const latest = sorted[sorted.length - 1];
    if (latest.authorId === user.id) continue; // you have the last word — answered

    // Notes from others since your last reply (or all of them if you've
    // never replied). A pushback among them makes this urgent.
    const myLastAt =
      sorted
        .filter((n) => n.authorId === user.id)
        .map((n) => n.createdAt)
        .sort()
        .at(-1) ?? "";
    const unanswered = sorted.filter(
      (n) => n.authorId !== user.id && n.createdAt > myLastAt,
    );
    if (unanswered.length === 0) continue;
    const hasPushback = unanswered.some((n) => n.kind === "pushback");
    const author = getUserById(latest.authorId)?.name ?? "Someone";

    out.push({
      id: `n_${e.id}`,
      kind: hasPushback ? "pushback" : "note",
      title: hasPushback
        ? `${author} did not approve — reply needed`
        : `${author} left a note`,
      subject: `${e.vendor} · ${e.item}`,
      body: snippet(latest.body),
      href: `/entries/${e.id}`,
      at: latest.createdAt,
    });
  }

  // --- Staff: your rejected top-ups (admin is the one who rejects) ---
  if (user.role === "staff") {
    for (const p of getPcfLedger()) {
      if (
        p.kind !== "top-up" ||
        p.status !== "rejected" ||
        p.resolved ||
        p.reportedBy !== user.id
      ) {
        continue;
      }
      const approver = p.approvedBy ? getUserById(p.approvedBy)?.name : null;
      out.push({
        id: `t_${p.id}`,
        kind: "topup-rejected",
        title: `${approver ?? "Admin"} rejected your top-up`,
        subject: `₱${Math.round(p.amount).toLocaleString()} top-up · ${p.date}`,
        body: p.decisionNote
          ? snippet(p.decisionNote)
          : "Talk to Lexi, then log a corrected top-up.",
        href: "/pcf/log-topup",
        at: p.createdAt,
      });
    }
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
