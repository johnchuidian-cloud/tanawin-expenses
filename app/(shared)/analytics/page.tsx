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
  Check,
  ChevronLeft,
  Lightbulb,
  TrendingUp,
  TriangleAlert,
  CircleCheck,
  Info,
} from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { useCurrentUser, homePathFor } from "@/lib/auth";
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

/** Checkbox-style filter pill: a tickable box + label. */
function CheckPill({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 pl-1.5 pr-2.5 h-8 rounded-full border text-xs font-medium transition-colors " +
        (checked
          ? "bg-leaf-50 border-leaf-300 text-leaf-700"
          : "bg-white border-sand-200 text-ink-700 hover:bg-sand-50")
      }
    >
      <span
        className={
          "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border " +
          (checked ? "bg-leaf-500 border-leaf-500 text-white" : "border-sand-300 text-transparent")
        }
      >
        <Check className="w-3 h-3" strokeWidth={3} />
      </span>
      {children}
    </button>
  );
}

export default function AnalyticsPage() {
  useStoreTick();
  const me = useCurrentUser();
  const entries = getEntries();
  const today = new Date();
  const thisMonth = toMonthKey(today);

  // Back link points at the viewer's own home — admins to the dashboard,
  // staff/guests to where they actually came from (guests can't see /dashboard).
  const backHref = me ? homePathFor(me.role) : "/entries";
  const backLabel = me?.role === "admin" ? "Dashboard" : me?.role === "staff" ? "Home" : "Entries";

  // Months that have entries, newest first.
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(toMonthKey(e.date));
    set.add(thisMonth);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries, thisMonth]);

  // Empty month selection = all time; otherwise the union of the chosen
  // months. Empty tag selection = all tags; otherwise the union of the chosen
  // tags. Both filters combine (months AND tags).
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const isAllTime = selected.length === 0;

  function toggleIn(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }
  const toggleMonth = (key: string) => setSelected((prev) => toggleIn(prev, key));
  const toggleTag = (key: string) => setSelectedTags((prev) => toggleIn(prev, key));

  // Every tag that appears in the books, ordered by all-time spend so the
  // common ones lead the checkbox list.
  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.category, (map.get(e.category) ?? 0) + e.total);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [entries]);

  const filtered = useMemo(() => {
    const months = new Set(selected);
    const tags = new Set(selectedTags);
    return entries.filter(
      (e) =>
        (months.size === 0 || months.has(toMonthKey(e.date))) &&
        (tags.size === 0 || tags.has(e.category)),
    );
  }, [entries, selected, selectedTags]);

  const periodLabel = isAllTime
    ? "All time"
    : selected.length === 1
      ? monthLabel(selected[0])
      : `${selected.length} months`;
  const tagLabel = selectedTags.length === 0 ? "all tags" : `${selectedTags.length} tag${selectedTags.length === 1 ? "" : "s"}`;
  const hasFilters = selected.length > 0 || selectedTags.length > 0;
  // Phrase for prose (keeps month names properly cased, unlike a blanket
  // lowercase): "all time" / "May 2026" / "2 months".
  const periodPhrase = isAllTime
    ? "all time"
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
          detail: `${top.label} is ${Math.round(pct)}% of spend (${peso(top.total)}) in ${periodPhrase}. Worth a closer look for savings or a separate budget line.`,
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
  }, [filtered, byCategory, total, pcfTotal, trend, periodPhrase]);

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 bg-white border-b border-sand-200">
        <Link href={backHref} className="text-[11px] text-ink-500 inline-flex items-center gap-1 mb-1">
          <ChevronLeft className="w-3.5 h-3.5" /> {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-leaf-600" />
          <h1 className="text-lg font-medium text-ink-900">Analytics</h1>
        </div>
        <p className="text-xs text-ink-500 mt-0.5">
          Breakdowns and recommendations · {periodLabel} · {tagLabel}
        </p>
      </div>

      {/* Filters: checkboxes for period (all-time + months) and tags. Both
          combine — months AND tags. Empty group = no restriction. */}
      <div className="px-5 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-ink-900">Filters</p>
          {hasFilters && (
            <button
              onClick={() => {
                setSelected([]);
                setSelectedTags([]);
              }}
              className="text-[11px] text-leaf-600 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        <div>
          <p className="text-[11px] text-ink-500 mb-1.5">Period</p>
          <div className="flex flex-wrap gap-1.5">
            <CheckPill checked={isAllTime} onClick={() => setSelected([])}>
              All time
            </CheckPill>
            {availableMonths.map((key) => {
              const parts = monthLabel(key).split(" ");
              return (
                <CheckPill key={key} checked={selected.includes(key)} onClick={() => toggleMonth(key)}>
                  {`${parts[0]} '${parts[1].slice(2)}`}
                </CheckPill>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[11px] text-ink-500 mb-1.5">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <CheckPill key={tag} checked={selectedTags.includes(tag)} onClick={() => toggleTag(tag)}>
                {tag}
              </CheckPill>
            ))}
          </div>
        </div>
      </div>

      {total <= 0 ? (
        <div className="px-5 pt-8 text-center text-sm text-ink-500">
          {hasFilters ? "No expenses match these filters." : "No expenses recorded yet."}
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
            <ExpenseByTagChart
              title="Expenses by tag"
              data={byCategory}
              maxSlices={9}
              tagHref={(label) =>
                `/entries?category=${encodeURIComponent(label)}${selected.length === 1 ? `&month=${selected[0]}` : ""}&from=analytics`
              }
            />
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
              <p className="text-[11px] text-ink-300 mt-1">Most recent {trend.length} months · check a month above to highlight</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
