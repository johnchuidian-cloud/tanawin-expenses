"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getPcfBalance, getPcfLedger, getUserById } from "@/lib/store";
import { peso, pesoShort, relativeDate, toMonthKey, entryInMonth, monthLabel } from "@/lib/format";
import { staffCategoryLabel } from "@/lib/category-meta";
import { MonthGrid, type MonthScope } from "@/components/MonthGrid";
import ExpenseByTagChart from "@/components/ExpenseByTagChart";
import ExportButton from "@/components/ExportButton";

export default function StaffHomePage() {
  useStoreTick(); // re-render on store changes
  const user = useCurrentUser();
  const entries = getEntries();
  const ledger = getPcfLedger();
  const balance = getPcfBalance();

  const today = new Date();
  const thisMonth = toMonthKey(today);

  // Scope drives every "this month" section below. Default to the current
  // month so the page opens on the familiar view; staff can pick an older
  // month via the chip row.
  const [scope, setScope] = useState<MonthScope>(thisMonth);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(toMonthKey(e.date));
    set.add(thisMonth);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);

  const scopeLabel = scope === "all" ? "All time" : monthLabel(scope);
  const scopeShort = scope === "all" ? "All time" : monthLabel(scope).split(" ")[0];

  const scopedEntries = useMemo(() => {
    if (scope === "all") return entries;
    return entries.filter((e) => entryInMonth(e.date, scope));
  }, [entries, scope]);

  const prevScopeKey = useMemo(() => {
    if (scope === "all") return null;
    const [y, m] = scope.split("-").map(Number);
    return toMonthKey(new Date(y, m - 1 - 1, 1));
  }, [scope]);
  const prevScopeEntries = useMemo(() => {
    if (!prevScopeKey) return [];
    return entries.filter((e) => entryInMonth(e.date, prevScopeKey));
  }, [entries, prevScopeKey]);

  const scopeTotal = scopedEntries.reduce((sum, e) => sum + e.total, 0);
  const prevScopeTotal = prevScopeEntries.reduce((sum, e) => sum + e.total, 0);
  const scopeDelta =
    prevScopeTotal > 0 ? ((scopeTotal - prevScopeTotal) / prevScopeTotal) * 100 : 0;

  const myEntriesInScope = scopedEntries.filter((e) => e.loggedBy === user?.id).length;

  // Expenses by tag for the selected scope — full breakdown (the chart rolls
  // the long tail into an "Other" slice itself).
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scopedEntries) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    }
    return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
  }, [scopedEntries]);

  // Items needing the staff's attention — always all-time; pushback notes
  // don't expire based on the month chip you have selected.
  const attentionCount = entries.filter(
    (e) =>
      e.loggedBy === user?.id &&
      e.flags.some((f) => !f.resolved) &&
      e.notes.some((n) => n.kind === "pushback" && n.authorId !== user?.id),
  ).length;

  // Recent entries — restricted to scope.
  const recentEntries = useMemo(() => scopedEntries.slice(0, 5), [scopedEntries]);

  const lastApprovedTopUp = ledger.find((p) => p.kind === "top-up" && p.status === "approved");

  // Month-on-month — anchored to the selected month (or to today when scope
  // is "all", preserving the original 5-most-recent view).
  const momData = useMemo(() => {
    const anchor = scope === "all"
      ? today
      : (() => {
          const [y, m] = scope.split("-").map(Number);
          return new Date(y, m - 1, 1);
        })();
    const months: { key: string; label: string; total: number; partial: boolean }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const key = toMonthKey(d);
      const total = entries.filter((e) => entryInMonth(e.date, key)).reduce((s, e) => s + e.total, 0);
      const partial = i === 0 && key === thisMonth;
      months.push({
        key,
        label: monthLabel(key).split(" ")[0].slice(0, 3),
        total,
        partial,
      });
    }
    return months;
  }, [entries, scope, today, thisMonth]);
  const maxMonthTotal = Math.max(...momData.map((m) => m.total), 1);

  return (
    <div className="pb-2">
      {/* Tanawin wordmark — brand band at the top of the home screen */}
      <div className="flex flex-col items-center py-3 bg-white border-b border-sand-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/tanawin-wordmark.jpg"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith("/tanawin-wordmark.svg")) {
              img.src = "/tanawin-wordmark.svg";
            }
          }}
          alt="Tanawin"
          className="h-7"
        />
        <p className="text-[11px] tracking-wide text-ink-500 mt-1">
          Operating Expenses
        </p>
      </div>

      {/* PCF balance card */}
      <div className="bg-leaf-50 px-5 py-4 border-b border-sand-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-leaf-600">Pooled petty cash balance</p>
            <p className="text-3xl font-medium text-leaf-600 mt-1">{peso(balance)}</p>
          </div>
          {/* Excel export is for everyone (admin/staff/guest), not just Lexi. */}
          <ExportButton variant="sm" />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-leaf-600">
            {lastApprovedTopUp
              ? `Last top-up: ${relativeDate(lastApprovedTopUp.date)} · ${peso(lastApprovedTopUp.amount)}`
              : "No top-ups recorded yet"}
          </p>
          <Link href="/pcf/log-topup" className="btn btn-sm bg-white border-leaf-200 text-leaf-600">
            <Plus className="w-3.5 h-3.5" /> Log top-up
          </Link>
        </div>
      </div>

      {/* Attention bar — links to /notes where "Needs your attention" lists
          the same pushback entries that need a response. */}
      {attentionCount > 0 && (
        <Link
          href="/notes"
          className="block px-5 py-3 bg-clay-50 border-b border-sand-200 flex items-center gap-3"
        >
          <AlertCircle className="w-4 h-4 text-clay-500 flex-shrink-0" />
          <p className="text-sm text-clay-500 flex-1">
            {attentionCount} entr{attentionCount === 1 ? "y needs" : "ies need"} your response
          </p>
          <span className="text-xs text-clay-500">Open →</span>
        </Link>
      )}

      {/* Primary action */}
      <div className="px-5 pt-4">
        <Link href="/new" className="btn-primary w-full h-13 text-base">
          <Plus className="w-5 h-5" />
          Log new expense
        </Link>
      </div>

      {/* Month-scope grid — phone-keypad layout so staff tap directly into
          the month they want without scrolling. */}
      <div className="pt-4">
        <p className="px-5 text-[11px] text-ink-500 mb-1">Showing data for</p>
        <MonthGrid scope={scope} onChange={setScope} availableMonths={availableMonths} />
      </div>

      {/* Stats card */}
      <div className="px-5 pt-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">
            {scope === "all"
              ? "All time"
              : scope === thisMonth
              ? "This month so far"
              : scopeLabel}
          </p>
          <p className="text-[11px] text-ink-300">{scopeLabel}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="stat-card">
            <p className="text-[11px] text-ink-500">Total spent</p>
            <p className="text-lg font-medium text-ink-900 mt-0.5">{peso(scopeTotal)}</p>
            {prevScopeKey && prevScopeTotal > 0 && (
              <p className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-1">
                {scopeDelta < 0 ? (
                  <ArrowDownRight className="w-3 h-3 text-leaf-500" />
                ) : (
                  <ArrowUpRight className="w-3 h-3 text-clay-500" />
                )}
                {Math.abs(scopeDelta).toFixed(0)}% vs {monthLabel(prevScopeKey).split(" ")[0]}
              </p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-[11px] text-ink-500">Entries logged</p>
            <p className="text-lg font-medium text-ink-900 mt-0.5">{scopedEntries.length}</p>
            <p className="text-[11px] text-ink-500 mt-0.5">You logged {myEntriesInScope}</p>
          </div>
        </div>
      </div>

      {/* Expenses by tag — pie by default, toggle to bar. Tapping the chart
          drills through to the full analytics page (shared with admin/guest). */}
      {categoryData.length > 0 && (
        <div className="px-5 pt-5">
          <ExpenseByTagChart
            title={`Expenses by tag — ${scopeShort}`}
            data={categoryData}
            href="/analytics"
            tagHref={(label) =>
              `/entries?category=${encodeURIComponent(label)}${scope !== "all" ? `&month=${scope}` : ""}`
            }
          />
        </div>
      )}

      {/* Month on month */}
      <div className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">Month on month</p>
        <div className="flex gap-2 h-28">
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

      {/* Recent entries — restricted to scope; "All" link carries the scope
          through so the user lands on the same filter on /entries. */}
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium text-ink-900">
            Recent entries{scope !== "all" ? ` — ${scopeShort}` : ""}
          </p>
          <Link
            href={scope === "all" ? "/entries" : `/entries?month=${scope}`}
            className="text-[11px] text-ink-500"
          >
            All ↗
          </Link>
        </div>
        {recentEntries.length === 0 ? (
          <p className="text-xs text-ink-500 italic">No entries in {scopeLabel}.</p>
        ) : (
          <div className="space-y-1.5">
            {recentEntries.map((entry) => {
              const hasOpenFlag = entry.flags.some((f) => !f.resolved);
              const logger = getUserById(entry.loggedBy);
              return (
                <Link
                  key={entry.id}
                  href={`/entries/${entry.id}`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate">
                      {hasOpenFlag && <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />}
                      {entry.vendor} · {entry.item}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      {relativeDate(entry.date)} · {staffCategoryLabel(entry.category)} · {logger?.name ?? "—"}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-ink-900 ml-3">{peso(entry.total)}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
