"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  approvePcfTopUp,
  getEntries,
  getPcfBalance,
  getPcfLedger,
  getUserById,
  rejectPcfTopUp,
} from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import type { PcfLedgerEntry } from "@/lib/types";
import ExportButton from "@/components/ExportButton";

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

  // Only PCF-funded entries draw against PCF. Entries paid from other
  // funds (paidFrom === "other") appear in other reports but not here.
  const pcfEntries = useMemo(
    () => entries.filter((e) => e.paidFrom === "pcf"),
    [entries],
  );

  const recentDrawdowns = useMemo(
    () => [...pcfEntries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10),
    [pcfEntries],
  );

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
          <ExportButton variant="sm" />
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
              <PendingTopUpRow key={p.id} entry={p} myId={myId} />
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
                    </div>
                  </div>
                  <span
                    className={
                      "badge " + (rejected ? "badge-sand" : "badge-leaf")
                    }
                  >
                    {rejected ? "Rejected" : "Approved"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent drawdowns */}
      <section className="px-5 pt-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">Recent drawdowns</p>
          <Link href="/dashboard" className="text-[11px] text-ink-500">
            All ↗
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
              <div
                key={entry.id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-white border border-sand-200"
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
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PendingTopUpRow({
  entry,
  myId,
}: {
  entry: PcfLedgerEntry;
  myId: string | null;
}) {
  const reporter = getUserById(entry.reportedBy);
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
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => myId && approvePcfTopUp(entry.id, myId)}
          className="btn btn-sm flex-1 bg-leaf-500 text-white border-leaf-500"
        >
          <Check className="w-3.5 h-3.5" /> Approve
        </button>
        <button
          onClick={() => myId && rejectPcfTopUp(entry.id, myId)}
          className="btn btn-sm flex-1 bg-white border-sand-200 text-ink-700"
        >
          <X className="w-3.5 h-3.5" /> Reject
        </button>
      </div>
    </div>
  );
}
