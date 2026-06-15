"use client";

/**
 * Admin analytics — the drill-through from the dashboard's "Expenses by tag"
 * chart. Gives a fuller breakdown than the home feed plus data-driven
 * recommendations, all under a flexible time filter.
 *
 * Filter model: a multi-select set of YYYY-MM months. Empty set = "All time".
 * Selecting one or more months unions their entries, so the admin can compare
 * "April + May" or inspect a single month, matching the spec's "all-time and
 * by month or months".
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Lightbulb,
  TrendingUp,
  TriangleAlert,
  CircleCheck,
  Info,
} from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getUserById } from "@/lib/store";
import { peso, pesoShort, monthLabel, toMonthKey, entryInMonth } from "@/lib/format";
import { paidFromLabel } from "@/lib/payment-meta";
import { tagColorAt, TAG_OTHER_COLOR } from "@/lib/chart-colors";
import ExpenseByTagChart from "@/components/ExpenseByTagChart";

type Insight = {
  tone: "good" | "warn" | "info";
  title: string;
  detail: string;
};

const TONE_META = {
  good: { Icon: CircleCheck, wrap: "bg-leaf-50 border-leaf-200", icon: "text-leaf-600" },
  warn: { Icon: TriangleAlert, wrap: "bg-clay-50 border-clay-200", icon: "text-clay-500" },
  info: { Icon: Info, wrap: "bg-sand-50 border-sand-200", icon: "text-ink-500" },
} as const;

export default function AnalyticsPage() {
  useStoreTick();
  const entries = getEntries();
  const today = new Date();
  const thisMonth = toMonthKey(today);

  // Months that have entries, newest first.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(toMonthKey(e.date));
    set.add(thisMonth);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);

  // Empty selection = all time. Otherwise the union of the chosen months.
  const [selected, setSelected] = useState<string[]>([]);
  const isAllTime = selected.length === 0;

  function toggleMonth(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const filtered = useMemo(() => {
    if (isAllTime) return entries;
    const set = new Set(selected);
    return entries.filter((e) => set.has(toMonthKey(e.date)));
  }, [entries, selected, isAllTime]);

  const periodLabel = isAllTime
    ? "All time"
    : selected.length === 1
      ? monthLabel(selected[0])
      : `${selected.length} months`;

  // ---- aggregates -------------------------------------------------------
  const total = filtered.reduce((s, e) => s + e.total, 0);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    return Array.from(map.entries())
      .map(([label, t]) => ({ label, total: t }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const byStaff = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of filtered) {
      const cur = map.get(e.loggedBy) ?? { total: 0, count: 0 };
      map.set(e.loggedBy, { total: cur.total + e.total, count: cur.count + 1 });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: getUserById(id)?.name ?? "—", ...v }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);
  const maxStaffTotal = byStaff[0]?.total ?? 1;

  const pcfTotal = filtered.filter((e) => e.paidFrom === "pcf").reduce((s, e) => s + e.total, 0);
  const otherTotal = total - pcfTotal;

  // Month trend — every month with data (capped to the most recent 12),
  // oldest→newest, for the bar strip.
  const trend = useMemo(() => {
    const monthsAsc = [...availableMonths].sort().slice(-12);
    return monthsAsc.map((key) => ({
      key,
      label: monthLabel(key).split(" ")[0].slice(0, 3),
      total: entries.filter((e) => entryInMonth(e.date, key)).reduce((s, e) => s + e.total, 0),
      selected: selected.includes(key),
    }));
  }, [availableMonths, entries, selected]);
  const maxTrend = Math.max(...trend.map((t) => t.total), 1);

  // ---- recommendations --------------------------------------------------
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    if (filtered.length === 0) return out;

    // Biggest category and concentration.
    if (byCategory.length > 0 && total > 0) {
      const top = byCategory[0];
      const pct = (top.total / total) * 100;
      if (pct >= 35) {
        out.push({
          tone: "warn",
          title: `${top.label} dominates spending`,
          detail: `${top.label} is ${Math.round(pct)}% of spend (${peso(top.total)}) in ${periodLabel.toLowerCase()}. Worth a closer look for savings or a separate budget line.`,
        });
      } else {
        out.push({
          tone: "info",
          title: `Largest tag: ${top.label}`,
          detail: `${top.label} leads at ${Math.round(pct)}% of spend (${peso(top.total)}).`,
        });
      }
      const top3 = byCategory.slice(0, 3).reduce((s, c) => s + c.total, 0);
      if (byCategory.length > 3) {
        out.push({
          tone: "info",
          title: "Spending is concentrated",
          detail: `Your top 3 tags account for ${Math.round((top3 / total) * 100)}% of all spend across ${byCategory.length} tags.`,
        });
      }
    }

    // Major repairs / capital items.
    const repairTotal = filtered
      .filter((e) => e.majorRepair)
      .reduce((s, e) => s + e.total, 0);
    if (repairTotal > 0) {
      out.push({
        tone: "info",
        title: "Capital / major repairs included",
        detail: `${peso(repairTotal)} is flagged as major repairs. Set these aside when judging routine running costs.`,
      });
    }

    // Petty-cash reliance.
    if (total > 0) {
      const pcfPct = (pcfTotal / total) * 100;
      if (pcfPct >= 70) {
        out.push({
          tone: "info",
          title: "Most spend runs through petty cash",
          detail: `${Math.round(pcfPct)}% (${peso(pcfTotal)}) was paid from PCF. Larger bills may be easier to track paid directly.`,
        });
      }
    }

    // Month-over-month momentum (only meaningful with ≥2 months of data).
    const monthsWithData = trend.filter((t) => t.total > 0);
    if (monthsWithData.length >= 2) {
      const last = monthsWithData[monthsWithData.length - 1];
      const prev = monthsWithData[monthsWithData.length - 2];
      if (prev.total > 0) {
        const delta = ((last.total - prev.total) / prev.total) * 100;
        if (delta >= 15) {
          out.push({
            tone: "warn",
            title: "Spending is trending up",
            detail: `The latest month is ${Math.round(delta)}% higher than the one before (${pesoShort(prev.total)} → ${pesoShort(last.total)}).`,
          });
        } else if (delta <= -15) {
          out.push({
            tone: "good",
            title: "Spending is trending down",
            detail: `The latest month is ${Math.round(Math.abs(delta))}% lower than the one before (${pesoShort(prev.total)} → ${pesoShort(last.total)}).`,
          });
        }
      }
    }

    // Thin data nudge.
    if (filtered.length < 5) {
      out.push({
        tone: "info",
        title: "Not much data in this view",
        detail: "Add more months to the filter for clearer trends and recommendations.",
      });
    }

    return out.slice(0, 5);
  }, [filtered, byCategory, total, pcfTotal, trend, periodLabel]);

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 bg-white border-b border-sand-200">
        <Link href="/dashboard" className="text-[11px] text-ink-500 inline-flex items-center gap-1 mb-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-leaf-600" />
          <h1 className="text-lg font-medium text-ink-900">Analytics</h1>
        </div>
        <p className="text-xs text-ink-500 mt-0.5">Breakdowns and recommendations · {periodLabel}</p>
      </div>

      {/* Filter: all-time + multi-month */}
      <div className="px-5 pt-3">
        <p className="text-[11px] text-ink-500 mb-1.5">Filter by period</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelected([])}
            className={
              "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
              (isAllTime ? "bg-leaf-500 text-white" : "bg-sand-100 text-ink-700 hover:bg-sand-200")
            }
          >
            All time
          </button>
          {availableMonths.map((key) => {
            const active = selected.includes(key);
            const parts = monthLabel(key).split(" ");
            return (
              <button
                key={key}
                onClick={() => toggleMonth(key)}
                aria-pressed={active}
                className={
                  "px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors " +
                  (active ? "bg-leaf-500 text-white" : "bg-sand-100 text-ink-700 hover:bg-sand-200")
                }
              >
                {`${parts[0]} '${parts[1].slice(2)}`}
              </button>
            );
          })}
        </div>
        {selected.length > 1 && (
          <p className="text-[11px] text-ink-500 mt-1">
            Combining {selected.length} months ·{" "}
            <button onClick={() => setSelected([])} className="text-leaf-600 underline">
              clear
            </button>
          </p>
        )}
      </div>

      {total <= 0 ? (
        <div className="px-5 pt-8 text-center text-sm text-ink-500">
          No expenses in {periodLabel.toLowerCase()}.
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="px-5 pt-4 grid grid-cols-3 gap-2">
            <div className="stat-card">
              <p className="text-[11px] text-ink-500">Total spent</p>
              <p className="text-base font-medium text-ink-900 mt-0.5">{peso(total)}</p>
            </div>
            <div className="stat-card">
              <p className="text-[11px] text-ink-500">Entries</p>
              <p className="text-base font-medium text-ink-900 mt-0.5">{filtered.length}</p>
            </div>
            <div className="stat-card">
              <p className="text-[11px] text-ink-500">Avg / entry</p>
              <p className="text-base font-medium text-ink-900 mt-0.5">
                {peso(Math.round(total / filtered.length))}
              </p>
            </div>
          </div>

          {/* Recommendations */}
          {insights.length > 0 && (
            <div className="px-5 pt-5">
              <p className="text-sm font-medium text-ink-900 mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-leaf-600" /> Recommendations
              </p>
              <div className="space-y-2">
                {insights.map((ins, i) => {
                  const m = TONE_META[ins.tone];
                  const Icon = m.Icon;
                  return (
                    <div key={i} className={"flex gap-2.5 p-3 rounded-lg border " + m.wrap}>
                      <Icon className={"w-4 h-4 mt-0.5 flex-shrink-0 " + m.icon} />
                      <div>
                        <p className="text-sm font-medium text-ink-900">{ins.title}</p>
                        <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">{ins.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Expenses by tag — full breakdown, pie default */}
          <div className="px-5 pt-5">
            <ExpenseByTagChart title="Expenses by tag" data={byCategory} maxSlices={9} />
          </div>

          {/* Payment source split */}
          <div className="px-5 pt-5">
            <p className="text-sm font-medium text-ink-900 mb-2">By payment source</p>
            <div className="flex h-3 rounded-full overflow-hidden bg-sand-100">
              <div style={{ width: `${(pcfTotal / total) * 100}%`, backgroundColor: tagColorAt(0) }} />
              <div style={{ width: `${(otherTotal / total) * 100}%`, backgroundColor: TAG_OTHER_COLOR }} />
            </div>
            <div className="flex justify-between text-xs mt-1.5">
              <span className="text-ink-700">
                {paidFromLabel("pcf")} · {peso(pcfTotal)} ({Math.round((pcfTotal / total) * 100)}%)
              </span>
              <span className="text-ink-700">
                {paidFromLabel("other")} · {peso(otherTotal)} ({Math.round((otherTotal / total) * 100)}%)
              </span>
            </div>
          </div>

          {/* Spend by staff */}
          {byStaff.length > 0 && (
            <div className="px-5 pt-5">
              <p className="text-sm font-medium text-ink-900 mb-2">Spend by staff</p>
              <div className="space-y-2">
                {byStaff.map((s) => (
                  <Link key={s.id} href={`/entries?staffId=${s.id}`} className="block">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-ink-900">{s.name}</span>
                      <span className="text-ink-500 tabular-nums">
                        {peso(s.total)} · {s.count} entr{s.count === 1 ? "y" : "ies"}
                      </span>
                    </div>
                    <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-leaf-400 rounded-full"
                        style={{ width: `${(s.total / maxStaffTotal) * 100}%` }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Month trend */}
          {trend.length > 1 && (
            <div className="px-5 pt-5">
              <p className="text-sm font-medium text-ink-900 mb-2">Month trend</p>
              <div className="flex gap-1.5 h-28">
                {trend.map((m) => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={"w-full rounded-t " + (m.selected ? "bg-leaf-500" : "bg-leaf-300")}
                        style={{ height: `${(m.total / maxTrend) * 100}%`, minHeight: m.total > 0 ? "4px" : "0" }}
                        title={`${monthLabel(m.key)}: ${peso(m.total)}`}
                      />
                    </div>
                    <p className="text-[9px] text-ink-500">{m.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-ink-300 mt-1">Most recent {trend.length} months · tap a chip above to highlight</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
