"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Clock } from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getPcfBalance, getPcfLedger, getUserById } from "@/lib/store";
import { peso, pesoShort, relativeDate, toMonthKey, entryInMonth, monthLabel } from "@/lib/format";
import ExportButton from "@/components/ExportButton";

export default function AdminDashboardPage() {
  useStoreTick(); // re-render on store changes
  const entries = getEntries();
  const ledger = getPcfLedger();
  const balance = getPcfBalance();

  const today = new Date();
  const thisMonth = toMonthKey(today);
  const prevMonth = toMonthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));

  const thisMonthEntries = useMemo(() => entries.filter((e) => entryInMonth(e.date, thisMonth)), [entries, thisMonth]);
  const prevMonthEntries = useMemo(() => entries.filter((e) => entryInMonth(e.date, prevMonth)), [entries, prevMonth]);

  const thisMonthTotal = thisMonthEntries.reduce((sum, e) => sum + e.total, 0);
  const prevMonthTotal = prevMonthEntries.reduce((sum, e) => sum + e.total, 0);
  const monthDelta = prevMonthTotal > 0 ? ((thisMonthTotal - prevMonthTotal) / prevMonthTotal) * 100 : 0;

  // Approval queue — what Lexi needs to act on
  const openFlagEntries = useMemo(
    () => entries.filter((e) => e.flags.some((f) => !f.resolved)),
    [entries],
  );
  const pendingTopUps = useMemo(
    () => ledger.filter((p) => p.kind === "top-up" && p.status === "pending"),
    [ledger],
  );
  const reviewCount = openFlagEntries.length + pendingTopUps.length;

  // Spend per staff member this month
  const byStaff = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of thisMonthEntries) {
      const cur = map.get(e.loggedBy) ?? { total: 0, count: 0 };
      map.set(e.loggedBy, { total: cur.total + e.total, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: getUserById(id)?.name ?? "—", ...v }))
      .sort((a, b) => b.total - a.total);
  }, [thisMonthEntries]);

  // Top categories this month
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of thisMonthEntries) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [thisMonthEntries]);
  const totalForCategoryView = categoryTotals.reduce((s, [, v]) => s + v, 0);
  const maxCategoryTotal = categoryTotals[0]?.[1] ?? 1;

  const lastApprovedTopUp = ledger.find((p) => p.kind === "top-up" && p.status === "approved");

  // Month on month — last 5 months
  const momData = useMemo(() => {
    const months: { key: string; label: string; total: number; partial: boolean }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = toMonthKey(d);
      const total = entries.filter((e) => entryInMonth(e.date, key)).reduce((s, e) => s + e.total, 0);
      months.push({ key, label: monthLabel(key).split(" ")[0].slice(0, 3), total, partial: i === 0 });
    }
    return months;
  }, [entries, today]);
  const maxMonthTotal = Math.max(...momData.map((m) => m.total), 1);

  const recentEntries = useMemo(() => entries.slice(0, 6), [entries]);

  return (
    <div className="pb-2">
      {/* PCF balance card */}
      <div className="bg-leaf-50 px-5 py-4 border-b border-sand-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-leaf-600">Pooled petty cash balance</p>
            <p className="text-3xl font-medium text-leaf-600 mt-1">{peso(balance)}</p>
            <p className="text-xs text-leaf-600 mt-2">
              {lastApprovedTopUp
                ? `Last top-up: ${relativeDate(lastApprovedTopUp.date)} · ${peso(lastApprovedTopUp.amount)}`
                : "No top-ups recorded yet"}
            </p>
          </div>
          <ExportButton variant="sm" />
        </div>
      </div>

      {/* Review queue */}
      {reviewCount > 0 ? (
        <Link href="/review" className="block px-5 py-3 bg-clay-50 border-b border-sand-200 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-clay-500 flex-shrink-0" />
          <p className="text-sm text-clay-500 flex-1">
            {reviewCount} item{reviewCount > 1 ? "s" : ""} to review
            <span className="text-clay-500/70">
              {" "}
              · {openFlagEntries.length} flagged, {pendingTopUps.length} top-up{pendingTopUps.length === 1 ? "" : "s"}
            </span>
          </p>
          <span className="text-xs text-clay-500">Review →</span>
        </Link>
      ) : (
        <div className="px-5 py-3 bg-leaf-50/50 border-b border-sand-200 text-sm text-leaf-600">
          Nothing needs review — all caught up.
        </div>
      )}

      {/* This month */}
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">This month so far</p>
          <p className="text-[11px] text-ink-300">{monthLabel(thisMonth)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="stat-card">
            <p className="text-[11px] text-ink-500">Total spent</p>
            <p className="text-lg font-medium text-ink-900 mt-0.5">{peso(thisMonthTotal)}</p>
            {prevMonthTotal > 0 && (
              <p className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-1">
                {monthDelta < 0 ? (
                  <ArrowDownRight className="w-3 h-3 text-leaf-500" />
                ) : (
                  <ArrowUpRight className="w-3 h-3 text-clay-500" />
                )}
                {Math.abs(monthDelta).toFixed(0)}% vs {monthLabel(prevMonth).split(" ")[0]}
              </p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-[11px] text-ink-500">Entries logged</p>
            <p className="text-lg font-medium text-ink-900 mt-0.5">{thisMonthEntries.length}</p>
            <p className="text-[11px] text-ink-500 mt-0.5">across {byStaff.length} staff</p>
          </div>
        </div>
      </div>

      {/* Spend by staff */}
      {byStaff.length > 0 && (
        <div className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Spend by staff — {monthLabel(thisMonth).split(" ")[0]}</p>
          <div className="space-y-1.5">
            {byStaff.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200">
                <div>
                  <p className="text-sm text-ink-900">{s.name}</p>
                  <p className="text-[11px] text-ink-500">{s.count} entr{s.count === 1 ? "y" : "ies"}</p>
                </div>
                <p className="text-sm font-medium text-ink-900">{peso(s.total)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top categories */}
      {categoryTotals.length > 0 && (
        <div className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Top categories — {monthLabel(thisMonth).split(" ")[0]}</p>
          <div className="space-y-2">
            {categoryTotals.map(([cat, total]) => (
              <div key={cat}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink-900">{cat}</span>
                  <span className="text-ink-500">
                    {peso(total)} · {totalForCategoryView > 0 ? Math.round((total / totalForCategoryView) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden">
                  <div className="h-full bg-leaf-300" style={{ width: `${(total / maxCategoryTotal) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month on month */}
      <div className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">Month on month</p>
        <div className="flex items-end gap-2 h-28">
          {momData.map((m) => (
            <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex-1 flex items-end">
                <div
                  className={"w-full rounded-t " + (m.partial ? "bg-leaf-200" : "bg-leaf-400")}
                  style={{ height: `${(m.total / maxMonthTotal) * 100}%`, minHeight: m.total > 0 ? "4px" : "0" }}
                  title={`${monthLabel(m.key)}: ${peso(m.total)}${m.partial ? " (partial)" : ""}`}
                />
              </div>
              <p className="text-[10px] text-ink-500">{m.label}</p>
              <p className="text-[10px] text-ink-700 font-medium">{pesoShort(m.total)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent entries — whole team */}
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">Recent entries</p>
          <Link href="/review" className="text-[11px] text-ink-500">Review ↗</Link>
        </div>
        <div className="space-y-1.5">
          {recentEntries.map((entry) => {
            const hasOpenFlag = entry.flags.some((f) => !f.resolved);
            const logger = getUserById(entry.loggedBy);
            return (
              <div
                key={entry.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-900 truncate">
                    {hasOpenFlag && <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />}
                    {entry.vendor} · {entry.item}
                  </p>
                  <p className="text-[11px] text-ink-500 mt-0.5">
                    {relativeDate(entry.date)} · {entry.category} · {logger?.name ?? "—"}
                  </p>
                </div>
                <p className="text-sm font-medium text-ink-900 ml-3">{peso(entry.total)}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending top-ups awaiting approval */}
      {pendingTopUps.length > 0 && (
        <div className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Top-ups awaiting approval</p>
          <div className="space-y-1.5">
            {pendingTopUps.map((p) => {
              const reporter = getUserById(p.reportedBy);
              return (
                <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="w-4 h-4 text-ink-300 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-ink-900">{peso(p.amount)}</p>
                      <p className="text-[11px] text-ink-500">
                        {relativeDate(p.date)} · reported by {reporter?.name ?? "—"}
                      </p>
                    </div>
                  </div>
                  <Link href="/pcf" className="text-xs text-leaf-500">Review →</Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
