"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Wallet,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  getEntries,
  getPcfBalance,
  getPcfLedger,
  getPersonalEntryIds,
  getUserById,
} from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import { paidFromRowClasses } from "@/lib/payment-meta";
import ExportButton from "@/components/ExportButton";
import ReceiptsPackButton from "@/components/ReceiptsPackButton";
import RefreshButton from "@/components/RefreshButton";
import PendingTopUpCard from "@/components/PendingTopUpCard";

export default function AdminPcfPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const ledger = getPcfLedger();
  const entries = getEntries();
  const balance = getPcfBalance();

  const { pending, history } = useMemo(() => {
    const topUps = ledger.filter((p) => p.kind === "top-up");
    return {
      pending: topUps.filter((p) => p.status === "pending"),
      history: topUps
        .filter((p) => p.status !== "pending")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  }, [ledger]);

  // Only PCF-funded entries draw against PCF. Entries paid from other funds
  // (paidFrom === "other") and personal purchases (marked, paid with own money)
  // appear in other reports but not here — so this list and total match the
  // PCF balance.
  const pcfEntries = useMemo(() => {
    const personal = getPersonalEntryIds();
    return entries.filter((e) => e.paidFrom === "pcf" && !personal.has(e.id));
  }, [entries]);

  // All PCF drawdowns, newest first. Shown in growing pages via "Show more"
  // so Lexi can scan well past the most recent few without filtering.
  const sortedDrawdowns = useMemo(
    () => [...pcfEntries].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [pcfEntries],
  );
  const [drawdownLimit, setDrawdownLimit] = useState(30);
  const recentDrawdowns = sortedDrawdowns.slice(0, drawdownLimit);

  const totals = useMemo(() => {
    const approvedTotal = ledger
      .filter((p) => p.kind === "top-up" && p.status === "approved")
      .reduce((s, p) => s + p.amount, 0);
    const spendTotal = pcfEntries.reduce((s, e) => s + e.total, 0);
    return { approvedTotal, spendTotal };
  }, [ledger, pcfEntries]);

  const balanceNegative = balance < 0;

  return (
    <div className="pb-4">
      {/* Balance card */}
      <div
        className={
          "px-5 py-4 border-b border-sand-200 " +
          (balanceNegative ? "bg-clay-50" : "bg-leaf-50")
        }
      >
        <div className="flex items-center gap-2">
          <Wallet
            className={
              "w-4 h-4 " + (balanceNegative ? "text-clay-500" : "text-leaf-600")
            }
          />
          <p
            className={
              "text-xs " + (balanceNegative ? "text-clay-500" : "text-leaf-600")
            }
          >
            Pooled petty cash balance
          </p>
        </div>
        <p
          className={
            "text-3xl font-medium mt-1 " +
            (balanceNegative ? "text-clay-500" : "text-leaf-600")
          }
        >
          {peso(balance)}
        </p>
        <div className="flex items-end justify-between gap-3 mt-3">
          <div className="flex gap-4">
            <div>
              <p className="text-[11px] text-ink-500">Top-ups (approved)</p>
              <p className="text-sm font-medium text-ink-900">
                {peso(totals.approvedTotal)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-ink-500">Spent</p>
              <p className="text-sm font-medium text-ink-900">
                {peso(totals.spendTotal)}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <RefreshButton />
            <ExportButton variant="sm" />
            <ReceiptsPackButton variant="sm" />
          </div>
        </div>
      </div>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <section className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Awaiting approval · {pending.length}
          </p>
          <div className="space-y-2">
            {pending.map((p) => (
              <PendingTopUpCard key={p.id} entry={p} adminId={myId} />
            ))}
          </div>
        </section>
      )}

      {/* Top-up history */}
      <section className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Top-up history{history.length > 0 ? ` · ${history.length}` : ""}
        </p>
        {history.length === 0 ? (
          <p className="text-xs text-ink-500">No completed top-ups yet.</p>
        ) : (
          <div className="space-y-1.5">
            {history.map((p) => {
              const reporter = getUserById(p.reportedBy);
              const approver = p.approvedBy ? getUserById(p.approvedBy) : null;
              const rejected = p.status === "rejected";
              return (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg bg-white border border-sand-200"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {rejected ? (
                      <XCircle className="w-4 h-4 text-ink-300 flex-shrink-0 mt-0.5" />
                    ) : (
                      <ArrowUp className="w-4 h-4 text-leaf-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={
                          "text-sm font-medium " +
                          (rejected
                            ? "text-ink-500 line-through"
                            : "text-ink-900")
                        }
                      >
                        {peso(p.amount)}
                      </p>
                      <p className="text-[11px] text-ink-500 mt-0.5">
                        {relativeDate(p.date)} · reported by{" "}
                        {reporter?.name ?? "—"}
                        {approver && ` · ${rejected ? "rejected" : "approved"} by ${approver.name}`}
                      </p>
                      {p.note && (
                        <p className="text-xs text-ink-700 mt-1 italic">
                          &ldquo;{p.note}&rdquo;
                        </p>
                      )}
                      {p.decisionNote && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                          <MessageSquare className="w-3 h-3 text-ink-300 flex-shrink-0 mt-0.5" />
                          <p className="text-ink-700 break-words">
                            <span className="text-ink-500">
                              {approver?.name ?? "Admin"}:{" "}
                            </span>
                            {p.decisionNote}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span
                      className={
                        "badge " + (rejected ? "badge-sand" : "badge-leaf")
                      }
                    >
                      {rejected ? "Rejected" : "Approved"}
                    </span>
                    {rejected && p.resolved && (
                      <span className="badge badge-leaf">Resolved</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Drawdowns */}
      <section className="px-5 pt-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">
            Drawdowns{sortedDrawdowns.length > 0 ? ` · ${sortedDrawdowns.length}` : ""}
          </p>
          <Link href="/entries" className="text-[11px] text-ink-500">
            All entries ↗
          </Link>
        </div>
        <p className="text-[11px] text-ink-500 mb-2">
          Each logged expense draws down the PCF balance. Entries marked
          &ldquo;paid from another fund&rdquo; don&rsquo;t appear here.
        </p>
        <div className="space-y-1.5">
          {recentDrawdowns.map((entry) => {
            const logger = getUserById(entry.loggedBy);
            return (
              <Link
                key={entry.id}
                href={`/entries/${entry.id}`}
                className={
                  "flex items-start justify-between gap-3 p-2.5 rounded-lg border transition-colors " +
                  paidFromRowClasses(entry.paidFrom)
                }
              >
                <div className="flex items-start gap-2 min-w-0">
                  <ArrowDown className="w-4 h-4 text-clay-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-ink-900 truncate">
                      {entry.vendor} · {entry.item}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      {relativeDate(entry.date)} · {entry.category} ·{" "}
                      {logger?.name ?? "—"}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-medium text-ink-900 flex-shrink-0">
                  {peso(entry.total)}
                </p>
              </Link>
            );
          })}
        </div>
        {sortedDrawdowns.length > drawdownLimit && (
          <button
            onClick={() => setDrawdownLimit((n) => n + 30)}
            className="btn btn-sm w-full mt-2 text-ink-700"
          >
            Show more · {sortedDrawdowns.length - drawdownLimit} older
          </button>
        )}
        {sortedDrawdowns.length > 0 && (
          <p className="text-[11px] text-ink-300 mt-2 text-center">
            Showing {recentDrawdowns.length} of {sortedDrawdowns.length} drawdowns
          </p>
        )}
      </section>
    </div>
  );
}
