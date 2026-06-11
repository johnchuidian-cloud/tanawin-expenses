"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, Check, MessageSquare, XCircle } from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getNotificationsFor, type AppNotification } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import type { User } from "@/lib/types";

/**
 * Header notification bell (Instagram/Facebook style): a badge counts the
 * conversations waiting on the current user — Lexi's "do not approve"
 * pushbacks, unanswered notes, and (for staff) rejected top-ups. Tapping
 * opens a panel listing them; each item links to where the user can act.
 *
 * The badge clears when the user ANSWERS (replies / follows up), not when
 * they merely open the panel — the whole point is that these were being
 * missed, so the reminder persists until handled.
 */
export default function NotificationsBell({ user }: { user: User }) {
  const tick = useStoreTick();
  const [open, setOpen] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => getNotificationsFor(user), [user, tick]);
  const count = items.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={
          count === 0
            ? "Notifications — all caught up"
            : `Notifications — ${count} waiting for your reply`
        }
        className="relative flex flex-col items-center justify-center px-2 py-1 rounded-lg hover:bg-sand-100"
      >
        <Bell className="w-4 h-4 text-ink-700" />
        <span className="text-[9px] text-ink-500 mt-0.5 leading-none">Alerts</span>
        {count > 0 && (
          <span className="absolute -top-0.5 right-0 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center border-2 border-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away catcher */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-[min(20rem,calc(100vw-1.5rem))] bg-white rounded-xl border border-sand-200 shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-sand-100 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">Notifications</p>
              {count > 0 && (
                <p className="text-[11px] text-ink-500">{count} need a reply</p>
              )}
            </div>

            {count === 0 ? (
              <div className="px-4 py-6 flex flex-col items-center text-center">
                <div className="w-9 h-9 rounded-full bg-leaf-50 flex items-center justify-center mb-2">
                  <Check className="w-4 h-4 text-leaf-500" />
                </div>
                <p className="text-sm text-ink-700">You&rsquo;re all caught up.</p>
                <p className="text-[11px] text-ink-500 mt-0.5">
                  Replies and rejections that need your answer will show here.
                </p>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-sand-100">
                {items.map((n) => (
                  <NotificationRow key={n.id} n={n} onNavigate={() => setOpen(false)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onNavigate,
}: {
  n: AppNotification;
  onNavigate: () => void;
}) {
  const urgent = n.kind === "pushback" || n.kind === "topup-rejected";
  const Icon = n.kind === "topup-rejected" ? XCircle : MessageSquare;
  return (
    <Link
      href={n.href}
      onClick={onNavigate}
      className={
        "block px-3 py-2.5 hover:bg-sand-50 transition-colors " +
        (urgent ? "bg-clay-50/50" : "")
      }
    >
      <div className="flex items-start gap-2.5">
        <div
          className={
            "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 " +
            (urgent ? "bg-clay-50 text-clay-500" : "bg-sand-100 text-ink-500")
          }
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={
              "text-xs font-medium " + (urgent ? "text-clay-500" : "text-ink-900")
            }
          >
            {n.title}
          </p>
          <p className="text-[11px] text-ink-700 mt-0.5 truncate">{n.subject}</p>
          <p className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">
            &ldquo;{n.body}&rdquo;
          </p>
          <p className="text-[10px] text-ink-300 mt-0.5">{formatDateTime(n.at)}</p>
        </div>
      </div>
    </Link>
  );
}
