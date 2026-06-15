"use client";

/**
 * Expenses-by-tag chart with a pie/bar toggle.
 *
 * - Default view is the donut (pie) per the dashboard spec; the toggle flips
 *   to a ranked horizontal-bar view.
 * - The chart body is optionally a link (pass `href`) so tapping the chart on
 *   the dashboard drills through to the full analytics page. The toggle lives
 *   in the header, outside the link, so switching views never navigates.
 * - Slices past `maxSlices` roll up into a single "Other" slice so the legend
 *   stays readable on a phone.
 *
 * Hand-rolled SVG donut (no chart lib) to match the rest of the app's charts
 * and stay safe on the Cloudflare edge runtime. Uses the r=15.915 circle
 * (circumference ≈ 100) so each slice's stroke-dasharray is just its percent.
 */

import Link from "next/link";
import { useState } from "react";
import { PieChart, BarChart3, ArrowRight } from "lucide-react";
import { peso } from "@/lib/format";
import { tagColorAt, TAG_OTHER_COLOR } from "@/lib/chart-colors";

export interface TagDatum {
  label: string;
  total: number;
}

interface Slice {
  label: string;
  total: number;
  pct: number;
  color: string;
}

interface Props {
  title: string;
  data: TagDatum[];
  href?: string;
  defaultMode?: "pie" | "bar";
  maxSlices?: number;
}

function buildSlices(data: TagDatum[], maxSlices: number): { slices: Slice[]; total: number } {
  const sorted = [...data].filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  const total = sorted.reduce((s, d) => s + d.total, 0);
  if (total <= 0) return { slices: [], total: 0 };

  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);

  const slices: Slice[] = head.map((d, i) => ({
    label: d.label,
    total: d.total,
    pct: (d.total / total) * 100,
    color: tagColorAt(i),
  }));

  if (tail.length > 0) {
    const otherTotal = tail.reduce((s, d) => s + d.total, 0);
    slices.push({
      label: `Other (${tail.length})`,
      total: otherTotal,
      pct: (otherTotal / total) * 100,
      color: TAG_OTHER_COLOR,
    });
  }
  return { slices, total };
}

function Donut({ slices }: { slices: Slice[] }) {
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" className="w-32 h-32 flex-shrink-0" role="img" aria-label="Expenses by tag pie chart">
      {/* track */}
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#F4F1E7" strokeWidth="5" />
      {slices.map((s) => {
        const dash = `${s.pct} ${100 - s.pct}`;
        const offset = 25 - acc; // 25 starts the first slice at 12 o'clock
        acc += s.pct;
        return (
          <circle
            key={s.label}
            cx="21"
            cy="21"
            r="15.915"
            fill="none"
            stroke={s.color}
            strokeWidth="5"
            strokeDasharray={dash}
            strokeDashoffset={offset}
          />
        );
      })}
    </svg>
  );
}

export default function ExpenseByTagChart({
  title,
  data,
  href,
  defaultMode = "pie",
  maxSlices = 8,
}: Props) {
  const [mode, setMode] = useState<"pie" | "bar">(defaultMode);
  const { slices, total } = buildSlices(data, maxSlices);
  const maxSlice = slices[0]?.total ?? 1;

  const ToggleButton = ({ value, icon: Icon, label }: { value: "pie" | "bar"; icon: typeof PieChart; label: string }) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      aria-label={label}
      className={
        "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors " +
        (mode === value ? "bg-leaf-500 text-white" : "bg-sand-100 text-ink-500 hover:bg-sand-200")
      }
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const body =
    total <= 0 ? (
      <p className="text-xs text-ink-500 italic py-4">No expenses in this period.</p>
    ) : mode === "pie" ? (
      <div className="flex items-center gap-4">
        <Donut slices={slices} />
        <ul className="flex-1 min-w-0 space-y-1">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-ink-900 truncate flex-1">{s.label}</span>
              <span className="text-ink-500 tabular-nums whitespace-nowrap">
                {peso(s.total)} · {Math.round(s.pct)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <div className="space-y-2">
        {slices.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-ink-900 truncate">{s.label}</span>
              <span className="text-ink-500 tabular-nums whitespace-nowrap ml-2">
                {peso(s.total)} · {Math.round(s.pct)}%
              </span>
            </div>
            <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(s.total / maxSlice) * 100}%`, backgroundColor: s.color }}
              />
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <div className="flex items-center gap-1">
          <ToggleButton value="pie" icon={PieChart} label="View as pie chart" />
          <ToggleButton value="bar" icon={BarChart3} label="View as bar chart" />
        </div>
      </div>

      {href && total > 0 ? (
        <Link
          href={href}
          className="block rounded-lg -mx-2 px-2 py-1 hover:bg-sand-50 transition-colors"
        >
          {body}
          <p className="mt-2 text-[11px] text-leaf-600 flex items-center gap-1">
            View full analytics <ArrowRight className="w-3 h-3" />
          </p>
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
