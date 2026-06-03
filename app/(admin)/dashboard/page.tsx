"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Clock, Plus, RotateCcw, UserCog } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { clearPcfBalance, getEntries, getPcfBalance, getPcfLedger, getUserById } from "@/lib/store";
import { peso, pesoShort, relativeDate, toMonthKey, entryInMonth, monthLabel } from "@/lib/format";
import ExportButton from "@/components/ExportButton";
import { MonthGrid, type MonthScope } from "@/components/MonthGrid";

export default function AdminDashboardPage() {
  useStoreTick(); // re-render on store changes
  const me = useCurrentUser();
  const entries = getEntries();
  const ledger = getPcfLedger();
  const balance = getPcfBalance();

  const [clearedFlash, setClearedFlash] = useState(false);
  function handleClearPcfBalance() {
    if (!me) return;
    const formatted = peso(balance);
    const ok = window.confirm(
      `Clear the petty cash balance?\n\nCurrent balance is ${formatted}. ` +
        `This books a reconciliation entry that resets the balance to ₱0 without ` +
        `deleting any history. Going forward, top-ups and entries will start ` +
        `tracking from zero.`,
    );
    if (!ok) return;
    clearPcfBalance(me.id);
    setClearedFlash(true);
    setTimeout(() => setClearedFlash(false), 3000);
  }

  const today = new Date();
  const thisMonth = toMonthKey(today);

  // Scope drives every "this month" section on the page. Default to the
  // current month so the dashboard opens on the same view it always has;
  // users can pick an older month or "All time" via the chip row.
  const [scope, setScope] = useState<MonthScope>(thisMonth);

  // Months that actually have entries, newest first. Current month is always
  // present so the chip strip never opens empty.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(toMonthKey(e.date));
    set.add(thisMonth);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);

  // Pretty label for headings: "All time" or "May 2026".
  const scopeLabel = scope === "all" ? "All time" : monthLabel(scope);
  const scopeShort = scope === "all" ? "All time" : monthLabel(scope).split(" ")[0];

  // Entries within the selected scope (every section below filters from this).
  const scopedEntries = useMemo(() => {
    if (scope === "all") return entries;
    return entries.filter((e) => entryInMonth(e.date, scope));
  }, [entries, scope]);

  // For the "vs prior" delta in the stat card we need the period before
  // the selected one. With scope="all" there's nothing meaningful to compare
  // against, so we just hide the delta.
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

  // Approval queue is always all-time — flagged items don't expire based on
  // which month you're inspecting.
  const openFlagEntries = useMemo(
    () => entries.filter((e) => e.flags.some((f) => !f.resolved)),
    [entries],
  );
  const pendingTopUps = useMemo(
    () => ledger.filter((p) => p.kind === "top-up" && p.status === "pending"),
    [ledger],
  );
  const reviewCount = openFlagEntries.length + pendingTopUps.length;

  // Spend per staff member in the selected scope.
  const byStaff = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of scopedEntries) {
      const cur = map.get(e.loggedBy) ?? { total: 0, count: 0 };
      map.set(e.loggedBy, { total: cur.total + e.total, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: getUserById(id)?.name ?? "—", ...v }))
      .sort((a, b) => b.total - a.total);
  }, [scopedEntries]);

  // Top categories in the selected scope.
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scopedEntries) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [scopedEntries]);
  const totalForCategoryView = categoryTotals.reduce((s, [, v]) => s + v, 0);
  const maxCategoryTotal = categoryTotals[0]?.[1] ?? 1;

  const lastApprovedTopUp = ledger.find((p) => p.kind === "top-up" && p.status === "approved");

  // Month-on-month — 5 months ending at the selected scope (or at today when
  // scope === "all", which preserves the original "last 5 months" view).
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
      const total = entries
        .filter((e) => entryInMonth(e.date, key))
        .reduce((s, e) => s + e.total, 0);
      // "partial" highlights the latest bar — only meaningful when the chart
      // ends at the current month.
      const partial = i === 0 && key === thisMonth;
      months.push({ key, label: monthLabel(key).split(" ")[0].slice(0, 3), total, partial });
    }
    return months;
  }, [entries, scope, today, thisMonth]);
  const maxMonthTotal = Math.max(...momData.map((m) => m.total), 1);

  // Recent entries — restricted to scope so picking April shows April entries,
  // not whatever the newest rows happen to be.
  const recentEntries = useMemo(() => scopedEntries.slice(0, 6), [scopedEntries]);

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
            <p className="text-xs text-leaf-600 mt-2">
              {lastApprovedTopUp
                ? `Last top-up: ${relativeDate(lastApprovedTopUp.date)} · ${peso(lastApprovedTopUp.amount)}`
                : "No top-ups recorded yet"}
            </p>
          </div>
          <ExportButton variant="sm" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleClearPcfBalance}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-leaf-200 text-leaf-600 text-xs font-medium hover:bg-leaf-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear PCF balance
            <span className="text-[10px] text-leaf-600/70">(reset to ₱0)</span>
          </button>
          {clearedFlash && (
            <span className="text-[11px] text-leaf-600 inline-flex items-center gap-1 animate-pulse">
              ✓ Saved — other devices need a refresh to see this
            </span>
          )}
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

      {/* Lexi's own quick-add — for utility bills and other expenses she
          pays directly without a palengke receipt. */}
      <div className="px-5 pt-4">
        <Link href="/new" className="btn-primary w-full h-13 text-base">
          <Plus className="w-5 h-5" />
          Log new expense
        </Link>
      </div>

      {/* Month-scope grid — drives every section below. Phone-keypad layout
          so users tap directly into the month they want; year arrows on top
          row jump between years when data spans more than one. */}
      <div className="pt-4">
        <p className="px-5 text-[11px] text-ink-500 mb-1">Showing data for</p>
        <MonthGrid scope={scope} onChange={setScope} availableMonths={availableMonths} />
      </div>

      {/* Stats card — title swaps with the scope. */}
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
            <p className="text-[11px] text-ink-500 mt-0.5">across {byStaff.length} staff</p>
          </div>
        </div>
      </div>

      {/* Spend by staff */}
      {byStaff.length > 0 && (
        <div className="px-5 pt-5">
          <p className="text-sm font-medium text-ink-900 mb-2">Spend by staff — {scopeShort}</p>
          <div className="space-y-1.5">
            {byStaff.map((s) => (
              <Link
                key={s.id}
                href={`/entries?staffId=${s.id}`}
                className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
              >
                <div>
                  <p className="text-sm text-ink-900">{s.name}</p>
                  <p className="text-[11px] text-ink-500">{s.count} entr{s.count === 1 ? "y" : "ies"}</p>
                </div>
                <p className="text-sm font-medium text-ink-900">{peso(s.total)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Top categories */}
      {categoryTotals.length > 0 && (
        <div className="px-5 pt-5">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-ink-900">Top categories — {scopeShort}</p>
            <Link href="/categories" className="text-[11px] text-ink-500">All ↗</Link>
          </div>
          <div className="space-y-2">
            {categoryTotals.map(([cat, total]) => (
              <Link
                key={cat}
                href={`/entries?category=${encodeURIComponent(cat)}`}
                className="block hover:bg-sand-50 rounded-md -mx-1 px-1 py-1 transition-colors"
              >
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-ink-900">{cat}</span>
                  <span className="text-ink-500">
                    {peso(total)} · {totalForCategoryView > 0 ? Math.round((total / totalForCategoryView) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden">
                  <div className="h-full bg-leaf-300" style={{ width: `${(total / maxCategoryTotal) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Month on month — anchored to the selected month so picking February
          shows October..February instead of always January..May. */}
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

      {/* Recent entries — restricted to scope. The /entries link carries the
          same scope through a query param so the user lands on the same
          filter view they were inspecting. */}
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
                      {relativeDate(entry.date)} · {entry.category} · {logger?.name ?? "—"}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-ink-900 ml-3">{peso(entry.total)}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin tools — places only Lexi reaches: edit staff PINs/names,
          edit category list, etc. Surfaced here so they're discoverable
          without bloating the bottom nav. */}
      <div className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">Admin tools</p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/users/manage"
            className="flex items-center gap-2 p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
          >
            <UserCog className="w-4 h-4 text-ink-700 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Manage staff</p>
              <p className="text-[10px] text-ink-500 leading-tight">Rename · change PIN</p>
            </div>
          </Link>
          <Link
            href="/categories/manage"
            className="flex items-center gap-2 p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
          >
            <span className="text-base">🏷️</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Manage tags</p>
              <p className="text-[10px] text-ink-500 leading-tight">Add · delete · edit</p>
            </div>
          </Link>
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
