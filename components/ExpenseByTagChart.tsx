"use client";

/**
 * Expenses-by-tag chart with a pie/bar toggle.
 *
 * - Default view is the donut (pie); the toggle flips to a ranked
 *   horizontal-bar view.
 * - Each tag (a pie slice, its legend row, or a bar) is clickable: pass
 *   `tagHref(label)` and tapping a tag drills into the entries feed filtered
 *   to that category. The rolled-up "Other" slice is not clickable (it's an
 *   aggregate of several tags).
 * - `href` (optional) renders a separate "View full analytics →" footer link —
 *   the path to the analytics page. It's a sibling of the chart, not a wrapper,
 *   so it never swallows the per-tag clicks.
 * - Slices past `maxSlices` roll up into a single "Other" slice so the legend
 *   stays readable on a phone.
 *
 * Hand-rolled SVG donut (no chart lib) to match the rest of the app's charts
 * and stay safe on the Cloudflare edge runtime. Uses the r=15.915 circle
 * (circumference ≈ 100) so each slice's stroke-dasharray is just its percent.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  isOther: boolean;
  href?: string; // entries-feed filter for this tag (undefined for "Other")
}

interface Props {
  title: string;
  data: TagDatum[];
  href?: string;
  defaultMode?: "pie" | "bar";
  maxSlices?: number;
  /** Maps a real tag label to its filtered entries-feed URL. */
  tagHref?: (label: string) => string;
}

function buildSlices(
  data: TagDatum[],
  maxSlices: number,
  tagHref?: (label: string) => string,
): { slices: Slice[]; total: number } {
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
    isOther: false,
    href: tagHref?.(d.label),
  }));

  if (tail.length > 0) {
    const otherTotal = tail.reduce((s, d) => s + d.total, 0);
    slices.push({
      label: `Other (${tail.length})`,
      total: otherTotal,
      pct: (otherTotal / total) * 100,
      color: TAG_OTHER_COLOR,
      isOther: true,
    });
  }
  return { slices, total };
}

function Donut({ slices, onSelect }: { slices: Slice[]; onSelect: (s: Slice) => void }) {
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" className="w-32 h-32 flex-shrink-0" role="img" aria-label="Expenses by tag pie chart">
      {/* track */}
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#F4F1E7" strokeWidth="5" />
      {slices.map((s) => {
        const dash = `${s.pct} ${100 - s.pct}`;
        const offset = 25 - acc; // 25 starts the first slice at 12 o'clock
        acc += s.pct;
        const clickable = !!s.href;
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
            onClick={clickable ? () => onSelect(s) : undefined}
            style={clickable ? { cursor: "pointer" } : undefined}
          >
            <title>
              {s.label}: {peso(s.total)} ({Math.round(s.pct)}%)
              {clickable ? " — tap to filter" : ""}
            </title>
          </circle>
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
  tagHref,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"pie" | "bar">(defaultMode);
  const { slices, total } = buildSlices(data, maxSlices, tagHref);
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

  // One legend/bar row, rendered as a Link when the tag is filterable.
  function TagRow({ s, children }: { s: Slice; children: React.ReactNode }) {
    if (s.href) {
      return (
        <Link
          href={s.href}
          className="block rounded-md -mx-1 px-1 py-0.5 hover:bg-sand-50 transition-colors"
          title={`Filter entries to ${s.label}`}
        >
          {children}
        </Link>
      );
    }
    return <div className="-mx-1 px-1 py-0.5">{children}</div>;
  }

  const body =
    total <= 0 ? (
      <p className="text-xs text-ink-500 italic py-4">No expenses in this period.</p>
    ) : mode === "pie" ? (
      <div className="flex items-center gap-4">
        <Donut slices={slices} onSelect={(s) => s.href && router.push(s.href)} />
        <ul className="flex-1 min-w-0 space-y-0.5">
          {slices.map((s) => (
            <li key={s.label}>
              <TagRow s={s}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-ink-900 truncate flex-1">{s.label}</span>
                  <span className="text-ink-500 tabular-nums whitespace-nowrap">
                    {peso(s.total)} · {Math.round(s.pct)}%
                  </span>
                </div>
              </TagRow>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <div className="space-y-1">
        {slices.map((s) => (
          <TagRow key={s.label} s={s}>
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
          </TagRow>
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

      {body}

      {href && total > 0 && (
        <Link
          href={href}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-leaf-600 hover:underline"
        >
          View full analytics <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
