"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Clock, Plus, RotateCcw, Store, UserCog, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { clearPcfBalance, getEntries, getPcfBalance, getPcfLedger, getUserById } from "@/lib/store";
import { peso, pesoShort, relativeDate, formatDate, toIsoDate, toMonthKey, entryInMonth, monthLabel } from "@/lib/format";
import ExportButton from "@/components/ExportButton";
import ReceiptsPackButton from "@/components/ReceiptsPackButton";
import RefreshButton from "@/components/RefreshButton";
import ExpenseByTagChart from "@/components/ExpenseByTagChart";
import { paidFromBadgeClasses, paidFromLabel, paidFromRowClasses } from "@/lib/payment-meta";
import { MonthGrid, type MonthScope } from "@/components/MonthGrid";

export default function AdminDashboardPage() {
  useStoreTick(); // re-render on store changes
  const me = useCurrentUser();
  const entries = getEntries();
  const ledger = getPcfLedger();
  const balance = getPcfBalance();

  const today = new Date();
  const thisMonth = toMonthKey(today);

  // "Clear PCF balance" reconciliation. The admin picks which month they're
  // closing so the offsetting entry lands in that month's books rather than
  // always today's — clearing May's float in early June shouldn't dump a
  // reconciliation line into June.
  const [clearedFlash, setClearedFlash] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearMonth, setClearMonth] = useState(thisMonth);
  // Reconcile mode: "lock" carries the balance forward, "count" reconciles to
  // the physically-counted cash, "zero" resets to ₱0. Defaults to lock-only so
  // closing a month never changes the float unless the admin explicitly asks.
  const [clearMode, setClearMode] = useState<"lock" | "count" | "zero">("lock");
  const [countAmount, setCountAmount] = useState("");

  // Months the admin can close: every month that has a PCF drawdown or a
  // ledger entry, plus the current month, newest first.
  const closableMonths = useMemo(() => {
    const set = new Set<string>([thisMonth]);
    for (const e of entries) if (e.paidFrom === "pcf") set.add(toMonthKey(e.date));
    for (const p of ledger) set.add(toMonthKey(p.date));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, ledger, thisMonth]);

  // Book the reconciliation entry on the last day of the chosen month — or
  // today, if the chosen month is the current one (you can't date it into
  // the future).
  function bookingDateFor(monthKey: string): string {
    if (monthKey === thisMonth) return toIsoDate(today);
    const [y, m] = monthKey.split("-").map(Number);
    return toIsoDate(new Date(y, m, 0)); // day 0 of next month = last day of this one
  }

  function openClear() {
    setClearMonth(thisMonth);
    setClearMode("lock");
    setCountAmount("");
    setClearOpen(true);
  }

  const countNum = Number(countAmount);
  const countValid = countAmount.trim() !== "" && Number.isFinite(countNum) && countNum >= 0;

  function confirmClear() {
    if (!me) return;
    if (clearMode === "count" && !countValid) return;
    const target = clearMode === "lock" ? balance : clearMode === "zero" ? 0 : countNum;
    clearPcfBalance(me.id, { date: bookingDateFor(clearMonth), targetBalance: target });
    setClearOpen(false);
    setClearedFlash(
      clearMode === "lock"
        ? "Period locked · balance carried forward"
        : clearMode === "zero"
          ? "Balance reset to ₱0"
          : `Balance reconciled to ${peso(target)}`,
    );
    setTimeout(() => setClearedFlash(""), 3000);
  }

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

  // Expenses by tag in the selected scope — full breakdown (the chart rolls
  // the long tail into an "Other" slice itself).
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scopedEntries) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    }
    return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
  }, [scopedEntries]);

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
          <div className="flex flex-col items-end gap-1.5">
            <RefreshButton />
            <ExportButton variant="sm" />
            <ReceiptsPackButton variant="sm" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={openClear}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-leaf-200 text-leaf-600 text-xs font-medium hover:bg-leaf-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reconcile balance
            <span className="text-[10px] text-leaf-600/70">(lock / reset)</span>
          </button>
          {clearedFlash && (
            <span className="text-[11px] text-leaf-600 inline-flex items-center gap-1 animate-pulse">
              ✓ {clearedFlash} — other devices need a refresh to see this
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

      {/* Spend-by-staff now lives on the analytics page (reached by tapping the
          chart below) to keep the home feed focused. The `byStaff` count still
          feeds the "across N staff" stat above. */}

      {/* Expenses by tag — pie by default, toggle to bar. Tapping the chart
          drills through to the full analytics page. */}
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

      {/* Month on month — anchored to the selected month so picking February
          shows October..February instead of always January..May. */}
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
                  className={
                    "flex items-center justify-between p-2.5 rounded-lg border transition-colors " +
                    paidFromRowClasses(entry.paidFrom)
                  }
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate">
                      {hasOpenFlag && <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />}
                      {entry.vendor} · {entry.item}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      <span className={"badge mr-1 " + paidFromBadgeClasses(entry.paidFrom)}>
                        {paidFromLabel(entry.paidFrom)}
                      </span>
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
          <Link
            href="/vendors/manage"
            className="flex items-center gap-2 p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
          >
            <Store className="w-4 h-4 text-ink-700 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Manage vendors</p>
              <p className="text-[10px] text-ink-500 leading-tight">Approve · merge · save</p>
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

      {/* Clear-balance reconciliation modal — asks which month is being closed
          so the offsetting entry is dated into that month, not always today. */}
      {clearOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 mb-4 sm:mb-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-leaf-600" />
                <p className="text-base font-medium text-ink-900">Reconcile petty cash</p>
              </div>
              <button
                onClick={() => setClearOpen(false)}
                aria-label="Cancel"
                className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center hover:bg-sand-100"
              >
                <X className="w-4 h-4 text-ink-500" />
              </button>
            </div>

            <p className="text-sm text-ink-700">
              Current balance is{" "}
              <span className="font-medium text-ink-900">{peso(balance)}</span>. This
              closes the chosen month and books a reconciliation entry — no history
              is deleted. Keep the balance, reconcile it to the cash you counted, or
              reset it to ₱0.
            </p>

            <div className="mt-3 rounded-lg bg-sand-50 border border-sand-200 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600">
              <span className="font-medium text-ink-800">What closing a month does:</span>{" "}
              it settles everything up to this point against the cash you actually
              have on hand. Afterwards you can still fix or delete older expenses in
              a closed month — those corrections stay in the records but{" "}
              <span className="font-medium text-ink-700">won&rsquo;t change the current
              balance</span> (the reset quietly absorbs them, and each one is listed
              under &ldquo;Reset adjustments&rdquo; on the PCF page). A newly-added
              expense you forgot still lowers the balance normally.
              <br />
              <span className="text-ink-400">
                This is different from <span className="font-medium">Refresh</span>,
                which only reloads the latest numbers and changes nothing.
              </span>
            </div>

            <div className="mt-4">
              <label htmlFor="clearMonth" className="label">
                Which month are you closing?
              </label>
              <select
                id="clearMonth"
                value={clearMonth}
                onChange={(e) => setClearMonth(e.target.value)}
                className="input"
              >
                {closableMonths.map((mk) => (
                  <option key={mk} value={mk}>
                    {monthLabel(mk)}
                    {mk === thisMonth ? " (current)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-500 mt-1.5">
                The reconciliation entry will be dated{" "}
                <span className="font-medium text-ink-700">
                  {formatDate(bookingDateFor(clearMonth), { withYear: true })}
                </span>
                {clearMonth === thisMonth
                  ? " (today)."
                  : " (last day of that month)."}
              </p>
            </div>

            {/* Three ways to close: keep the balance, reconcile to counted
                cash, or reset to ₱0. All book the same reconciliation marker. */}
            <div className="mt-4 space-y-2">
              {(
                [
                  {
                    key: "lock",
                    title: (
                      <>
                        Lock the balance{" "}
                        <span className="font-normal text-ink-500">· keep {peso(balance)}</span>
                      </>
                    ),
                    desc: "Closes the month and carries the current balance forward.",
                  },
                  {
                    key: "count",
                    title: <>Reconcile to counted cash</>,
                    desc: "Type the amount actually in the box; the balance snaps to it.",
                  },
                  {
                    key: "zero",
                    title: <>Lock and reset to ₱0</>,
                    desc: "Closes the month and starts the balance fresh from ₱0.",
                  },
                ] as const
              ).map((opt) => {
                const active = clearMode === opt.key;
                return (
                  <div key={opt.key}>
                    <button
                      type="button"
                      onClick={() => setClearMode(opt.key)}
                      aria-pressed={active}
                      className={
                        "w-full text-left rounded-lg border px-3 py-2.5 transition-colors " +
                        (active
                          ? "border-leaf-400 bg-leaf-50 ring-1 ring-leaf-400"
                          : "border-sand-200 bg-white hover:bg-sand-50")
                      }
                    >
                      <p className="text-sm font-medium text-ink-900">{opt.title}</p>
                      <p className="text-[11px] text-ink-500 mt-0.5">{opt.desc}</p>
                    </button>
                    {opt.key === "count" && active && (
                      <div className="mt-2">
                        <label htmlFor="countAmount" className="label">
                          Cash counted in the box (₱)
                        </label>
                        <input
                          id="countAmount"
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          value={countAmount}
                          onChange={(e) => setCountAmount(e.target.value.replace(/[^\d.]/g, ""))}
                          placeholder="e.g. 489.45"
                          className="input"
                        />
                        {countValid && (
                          <p className="text-[11px] text-ink-500 mt-1">
                            Balance will change from{" "}
                            <span className="font-medium text-ink-700">{peso(balance)}</span> to{" "}
                            <span className="font-medium text-ink-700">{peso(countNum)}</span>.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setClearOpen(false)}
                className="btn btn-sm flex-1"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                disabled={clearMode === "count" && !countValid}
                className="btn-primary flex-1 h-9 text-sm disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                {clearMode === "lock"
                  ? "Lock balance"
                  : clearMode === "zero"
                    ? "Lock & reset to ₱0"
                    : countValid
                      ? `Set to ${peso(countNum)}`
                      : "Reconcile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
