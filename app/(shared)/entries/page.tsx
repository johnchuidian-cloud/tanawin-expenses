"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowUp, Check, ChevronLeft, ListChecks, Plus, Search, Wand2, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getPcfLedger, getPersonalEntryIds, getUserById } from "@/lib/store";
import { entryInMonth, peso, relativeDate, toMonthKey } from "@/lib/format";
import { staffCategoryLabel } from "@/lib/category-meta";
import { paidFromBadgeClasses, paidFromLabel, paidFromRowClasses } from "@/lib/payment-meta";
import { MonthChips, type MonthScope } from "@/components/MonthChips";
import ExpenseByTagChart from "@/components/ExpenseByTagChart";
import ExportButton from "@/components/ExportButton";
import ReceiptsPackButton from "@/components/ReceiptsPackButton";
import BulkCorrectModal from "@/components/BulkCorrectModal";
import type { Entry, PcfLedgerEntry } from "@/lib/types";

type Filter = "all" | "mine" | "flagged" | "topups";

// A single row in the ledger is either an expense (money out) or a PCF
// top-up (money in). They're interleaved by date so /entries reads as the
// full money-in / money-out picture, not just expenses.
type Row =
  | { kind: "expense"; date: string; entry: Entry }
  | { kind: "topup"; date: string; topup: PcfLedgerEntry };

export default function EntriesPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();

  // Drilldown filters arrive via URL params from dashboard tiles and the
  // categories breakdown page. They're cleared with the "X" chip in the header.
  const categoryFilter = searchParams.get("category");
  const staffIdFilter = searchParams.get("staffId");
  const monthParam = searchParams.get("month"); // YYYY-MM, carried from dashboard chips
  const fromAnalytics = searchParams.get("from") === "analytics"; // drilled in from /analytics
  const staffFilterUser = staffIdFilter ? getUserById(staffIdFilter) : null;

  const [filter, setFilter] = useState<Filter>("all");
  const [monthScope, setMonthScope] = useState<MonthScope>(monthParam ?? "all");
  const [query, setQuery] = useState("");

  // Bulk-correction (admin): pick several entries and fix a field across all of
  // them at once — see components/BulkCorrectModal.tsx.
  const isAdmin = me?.role === "admin";
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctedMsg, setCorrectedMsg] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function exitSelect() {
    setSelectMode(false);
    setSelectedIds([]);
  }
  function handleApplied(n: number) {
    setCorrecting(false);
    exitSelect();
    setCorrectedMsg(`Corrected ${n} entr${n === 1 ? "y" : "ies"}`);
    setTimeout(() => setCorrectedMsg((cur) => (cur && cur.startsWith("Corrected") ? null : cur)), 4000);
  }

  const allEntries = getEntries();
  const ledger = getPcfLedger();

  // Top-ups are "money in". Rejected ones live in the Rejected tab, so the
  // ledger shows approved (real) and pending (reported, awaiting) only.
  const topUps = useMemo(
    () => ledger.filter((p) => p.kind === "top-up" && p.status !== "rejected"),
    [ledger],
  );

  // Months with any activity (expense OR top-up), newest first. Current month
  // always included so the chip row isn't empty.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) set.add(toMonthKey(e.date));
    for (const t of topUps) set.add(toMonthKey(t.date));
    set.add(toMonthKey(new Date()));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [allEntries, topUps]);

  // ---- Filtered rows ----
  const q = query.trim().toLowerCase();

  const expenseRows = useMemo<Row[]>(() => {
    // The "topups" filter hides expenses entirely.
    if (filter === "topups") return [];
    return allEntries
      .filter((e) => {
        if (categoryFilter && e.category !== categoryFilter) return false;
        if (staffIdFilter && e.loggedBy !== staffIdFilter) return false;
        if (monthScope !== "all" && !entryInMonth(e.date, monthScope)) return false;
        if (filter === "mine" && e.loggedBy !== myId) return false;
        if (filter === "flagged" && !e.flags.some((f) => !f.resolved)) return false;
        if (q.length === 0) return true;
        return (
          e.vendor.toLowerCase().includes(q) ||
          e.item.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
        );
      })
      .map((entry) => ({ kind: "expense" as const, date: entry.date, entry }));
  }, [allEntries, filter, q, myId, categoryFilter, staffIdFilter, monthScope]);

  const topUpRows = useMemo<Row[]>(() => {
    // Top-ups don't apply to category/flagged drilldowns.
    if (filter === "flagged" || categoryFilter) return [];
    return topUps
      .filter((t) => {
        if (staffIdFilter && t.reportedBy !== staffIdFilter) return false;
        if (monthScope !== "all" && !entryInMonth(t.date, monthScope)) return false;
        if (filter === "mine" && t.reportedBy !== myId) return false;
        if (q.length === 0) return true;
        const reporter = getUserById(t.reportedBy)?.name ?? "";
        return (
          "top-up".includes(q) ||
          "topup".includes(q) ||
          String(t.amount).includes(q) ||
          (t.note ?? "").toLowerCase().includes(q) ||
          reporter.toLowerCase().includes(q)
        );
      })
      .map((topup) => ({ kind: "topup" as const, date: topup.date, topup }));
  }, [topUps, filter, q, myId, categoryFilter, staffIdFilter, monthScope]);

  const rows = useMemo(
    () => [...expenseRows, ...topUpRows].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [expenseRows, topUpRows],
  );

  // Personal line items (excluded from PCF) — badged in the list.
  const personalIds = getPersonalEntryIds();

  // Totals for the filter-summary line.
  const expenseTotal = expenseRows.reduce((s, r) => s + (r.kind === "expense" ? r.entry.total : 0), 0);
  const topUpTotal = topUpRows.reduce((s, r) => s + (r.kind === "topup" ? r.topup.amount : 0), 0);

  // Guests have no dashboard/home, so they get the expenses-by-tag chart here
  // on their feed. Built from the currently-visible expenses so it tracks the
  // active month/search filters.
  const guestCategoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of expenseRows) {
      if (r.kind === "expense") map.set(r.entry.category, (map.get(r.entry.category) ?? 0) + r.entry.total);
    }
    return Array.from(map.entries()).map(([label, total]) => ({ label, total }));
  }, [expenseRows]);

  // Group by date for visual separation
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.date) ?? [];
      list.push(r);
      map.set(r.date, list);
    }
    return Array.from(map.entries());
  }, [rows]);

  const counts = useMemo(
    () => ({
      all: allEntries.length + topUps.length,
      mine:
        allEntries.filter((e) => e.loggedBy === myId).length +
        topUps.filter((t) => t.reportedBy === myId).length,
      flagged: allEntries.filter((e) => e.flags.some((f) => !f.resolved)).length,
      topups: topUps.length,
    }),
    [allEntries, topUps, myId],
  );

  const anyFilterActive =
    categoryFilter || staffIdFilter || monthScope !== "all" || filter !== "all" || query;

  return (
    <div className="pb-4">
      {/* Header + search */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200">
        {fromAnalytics && (
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1 text-[11px] text-leaf-600 mb-2 hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back to analytics
          </Link>
        )}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-medium text-ink-900">Entries</h1>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <button
                onClick={exitSelect}
                className="btn btn-sm bg-white border-sand-200 text-ink-700"
              >
                Cancel
              </button>
            ) : (
              <>
                {/* Admin-only bulk correction: select several entries, fix a
                    field across all of them at once. */}
                {isAdmin && (
                  <button
                    onClick={() => setSelectMode(true)}
                    className="btn btn-sm bg-white border-sand-200 text-ink-700"
                  >
                    <ListChecks className="w-3.5 h-3.5" /> Select
                  </button>
                )}
                {/* Excel + receipts pack are available to every role — view-only
                    guests (accountants/family) often need them most. */}
                <ExportButton variant="sm" />
                <ReceiptsPackButton variant="sm" />
                {me?.role !== "guest" && (
                  <Link href="/new" className="btn btn-sm bg-leaf-500 text-white border-leaf-500">
                    <Plus className="w-3.5 h-3.5" /> New
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
        {(categoryFilter || staffIdFilter) && (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-ink-500">Filtered by:</span>
            <button
              onClick={() => router.replace("/entries")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-ink-900 text-white"
              aria-label="Clear filter"
            >
              {categoryFilter ?? staffFilterUser?.name ?? "—"}
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="relative">
          <Search className="w-4 h-4 text-ink-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor, item, category…"
            className="input pl-9"
          />
        </div>
      </div>

      {/* Selection action bar — sticky while picking entries to bulk-correct. */}
      {selectMode && (
        <div className="sticky top-0 z-20 px-5 py-2 bg-leaf-50 border-b border-leaf-200 flex items-center justify-between">
          <p className="text-xs text-ink-700">
            {selectedIds.length} selected
            {selectedIds.length === 0 && <span className="text-ink-500"> · tap entries to pick</span>}
          </p>
          <div className="flex items-center gap-3">
            {selectedIds.length > 0 && (
              <button onClick={() => setSelectedIds([])} className="text-[11px] text-ink-500 hover:underline">
                Clear
              </button>
            )}
            <button
              onClick={() => setCorrecting(true)}
              disabled={selectedIds.length === 0}
              className="btn btn-sm bg-leaf-500 text-white border-leaf-500 disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5" /> Correct
            </button>
          </div>
        </div>
      )}

      {correctedMsg && (
        <div className="px-5 py-2 bg-leaf-50 border-b border-leaf-100 text-xs text-leaf-600 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> {correctedMsg} · other devices need a refresh to see this.
        </div>
      )}

      {/* Filter chips */}
      <div className="px-5 pt-3 flex gap-2 overflow-x-auto">
        {(
          [
            { key: "all", label: `All · ${counts.all}` },
            { key: "mine", label: `Mine · ${counts.mine}` },
            { key: "flagged", label: `Flagged · ${counts.flagged}` },
            { key: "topups", label: `Top-ups · ${counts.topups}` },
          ] as { key: Filter; label: string }[]
        ).map((chip) => {
          const active = chip.key === filter;
          return (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className={
                "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
                (active
                  ? "bg-ink-900 text-white"
                  : "bg-sand-100 text-ink-700 hover:bg-sand-200")
              }
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Month scope chips */}
      <MonthChips
        scope={monthScope}
        onChange={setMonthScope}
        availableMonths={availableMonths}
      />

      {/* Filter summary — money out and money in */}
      {anyFilterActive && (
        <div className="px-5 pt-2 text-[11px] text-ink-500">
          {expenseRows.length > 0 && (
            <span>
              {expenseRows.length} expense{expenseRows.length === 1 ? "" : "s"} · {peso(expenseTotal)} out
            </span>
          )}
          {expenseRows.length > 0 && topUpRows.length > 0 && <span> · </span>}
          {topUpRows.length > 0 && (
            <span className="text-leaf-600">
              {topUpRows.length} top-up{topUpRows.length === 1 ? "" : "s"} · {peso(topUpTotal)} in
            </span>
          )}
        </div>
      )}

      {/* Guests see the expenses-by-tag chart on their feed (they have no
          dashboard/home). Hidden once they've drilled into a single tag. */}
      {me?.role === "guest" && !categoryFilter && guestCategoryData.length > 0 && (
        <div className="px-5 pt-4">
          <ExpenseByTagChart
            title="Expenses by tag"
            data={guestCategoryData}
            href="/analytics"
            tagHref={(label) =>
              `/entries?category=${encodeURIComponent(label)}${monthScope !== "all" ? `&month=${monthScope}` : ""}`
            }
          />
        </div>
      )}

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink-700">Nothing matches.</p>
          <p className="text-xs text-ink-500 mt-1">
            {query
              ? "Try a different search term."
              : filter === "flagged"
                ? "Nothing flagged right now — nice."
                : filter === "topups"
                  ? "No top-ups in this view."
                  : "Log your first expense from the New button."}
          </p>
        </div>
      )}

      {/* Grouped list */}
      <div className="pt-3">
        {grouped.map(([date, items]) => {
          // Day summary: net of money out (expenses) and in (top-ups).
          const out = items.reduce((s, r) => s + (r.kind === "expense" ? r.entry.total : 0), 0);
          const inAmt = items.reduce((s, r) => s + (r.kind === "topup" ? r.topup.amount : 0), 0);
          return (
            <div key={date} className="px-5 pt-3 pb-1">
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[11px] font-medium text-ink-500 uppercase tracking-wide">
                  {relativeDate(date)}
                </p>
                <p className="text-[11px] text-ink-500">
                  {inAmt > 0 && <span className="text-leaf-600">+{peso(inAmt)} </span>}
                  {out > 0 && <span>−{peso(out)}</span>}
                </p>
              </div>
              <div className="space-y-1.5">
                {items.map((row) => {
                  if (row.kind === "topup") {
                    const t = row.topup;
                    const reporter = getUserById(t.reportedBy);
                    return (
                      <Link
                        key={t.id}
                        href="/pcf"
                        className="flex items-center justify-between p-2.5 rounded-lg bg-leaf-50/50 border border-leaf-100 hover:bg-leaf-50 transition-colors"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <ArrowUp className="w-4 h-4 text-leaf-600 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm text-ink-900">
                              PCF top-up
                              {t.status === "pending" && (
                                <span className="ml-1.5 badge badge-sand">Pending</span>
                              )}
                            </p>
                            <p className="text-[11px] text-ink-500 mt-0.5">
                              Reported by {reporter?.name ?? "—"}
                              {t.note ? ` · ${t.note}` : ""}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-leaf-600 ml-3 flex-shrink-0">
                          +{peso(t.amount)}
                        </p>
                      </Link>
                    );
                  }
                  const entry = row.entry;
                  const logger = getUserById(entry.loggedBy);
                  const personal = personalIds.has(entry.id);
                  const hasOpenFlag = entry.flags.some((f) => !f.resolved);
                  const hasNote = entry.notes.length > 0;
                  const selected = selectedIds.includes(entry.id);
                  const inner = (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-900 truncate">
                          {hasOpenFlag && (
                            <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />
                          )}
                          {entry.vendor} · {entry.item}
                        </p>
                        <p className="text-[11px] text-ink-500 mt-0.5">
                          {personal ? (
                            <span className="badge mr-1 bg-amber-100 text-amber-800">
                              Personal
                            </span>
                          ) : (
                            <span className={"badge mr-1 " + paidFromBadgeClasses(entry.paidFrom)}>
                              {paidFromLabel(entry.paidFrom)}
                            </span>
                          )}
                          {staffCategoryLabel(entry.category)} · {logger?.name ?? "—"}
                          {hasNote && (
                            <span className="ml-1.5 text-ink-700">
                              · {entry.notes.length} note{entry.notes.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ml-3 text-right flex-shrink-0">
                        <p className="text-sm font-medium text-ink-900">
                          {peso(entry.total)}
                        </p>
                        <p className="text-[10px] text-ink-500 mt-0.5">
                          {entry.qty} × {peso(entry.unitPrice, { cents: true })}
                        </p>
                      </div>
                    </>
                  );

                  // In select mode the row toggles selection instead of opening.
                  if (selectMode) {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => toggleSelect(entry.id)}
                        aria-pressed={selected}
                        className={
                          "w-full text-left flex items-center gap-2 p-2.5 rounded-lg border transition-colors " +
                          paidFromRowClasses(entry.paidFrom) +
                          (selected ? " ring-2 ring-leaf-400" : "")
                        }
                      >
                        <span
                          className={
                            "w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border " +
                            (selected ? "bg-leaf-500 border-leaf-500 text-white" : "border-sand-300 text-transparent bg-white")
                          }
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={3} />
                        </span>
                        {inner}
                      </button>
                    );
                  }

                  return (
                    <Link
                      key={entry.id}
                      href={`/entries/${entry.id}`}
                      className={
                        "flex items-center justify-between p-2.5 rounded-lg border transition-colors " +
                        paidFromRowClasses(entry.paidFrom)
                      }
                    >
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {correcting && (
        <BulkCorrectModal
          entries={allEntries.filter((e) => selectedIds.includes(e.id))}
          onClose={() => setCorrecting(false)}
          onApplied={handleApplied}
        />
      )}
    </div>
  );
}
