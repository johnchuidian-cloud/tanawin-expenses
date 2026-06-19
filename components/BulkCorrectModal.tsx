"use client";

/**
 * Bulk-correct several entries at once. The admin selects entries in the
 * ledger, then chooses which field(s) to set — move to a different month
 * (day-of-month preserved), reassign the category, or switch the funding
 * source — and it's applied to every selected entry.
 *
 * Only the toggled fields are written; untouched fields are left alone. This
 * is the tool that turns a mistake like "logged April under the wrong year"
 * into a one-shot fix.
 */

import { useMemo, useState } from "react";
import { Check, Loader2, Wand2, X } from "lucide-react";
import { appendEntryHistory, getCategoryDefs, updateEntry } from "@/lib/store";
import { useCurrentUser } from "@/lib/auth";
import { peso } from "@/lib/format";
import { paidFromLabel } from "@/lib/payment-meta";
import type { Entry, PaymentSource } from "@/lib/types";

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export default function BulkCorrectModal({
  entries,
  onClose,
  onApplied,
}: {
  entries: Entry[];
  onClose: () => void;
  onApplied: (count: number) => void;
}) {
  const categories = getCategoryDefs();
  const me = useCurrentUser();

  // Default the month picker to the most common month among the selection, so
  // a typical "these are all really April" fix opens close to the answer.
  const defaultMonth = useMemo(() => {
    if (entries.length === 0) return new Date().toISOString().slice(0, 7);
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.date.slice(0, 7), (counts.get(e.date.slice(0, 7)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [entries]);

  const [doMonth, setDoMonth] = useState(true);
  const [month, setMonth] = useState(defaultMonth); // "YYYY-MM"
  const [doCategory, setDoCategory] = useState(false);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [doPaidFrom, setDoPaidFrom] = useState(false);
  const [paidFrom, setPaidFrom] = useState<PaymentSource>("pcf");
  const [busy, setBusy] = useState(false);

  const monthValid = /^\d{4}-\d{2}$/.test(month);
  const anyField = (doMonth && monthValid) || doCategory || doPaidFrom;

  function buildUpdates(entry: Entry): Partial<Entry> {
    const u: Partial<Entry> = {};
    if (doMonth && monthValid) {
      const [y, m] = month.split("-").map(Number);
      const day = Math.min(Number(entry.date.slice(8, 10)), daysInMonth(y, m));
      u.date = `${month}-${String(day).padStart(2, "0")}`;
    }
    if (doCategory && category) u.category = category;
    if (doPaidFrom) u.paidFrom = paidFrom;
    return u;
  }

  // Human-readable summary of what actually changed for one entry — for the
  // audit history. Returns null when nothing differs from the current values.
  function changeSummary(entry: Entry, u: Partial<Entry>): string | null {
    const parts: string[] = [];
    if (u.date && u.date !== entry.date) parts.push(`date → ${u.date}`);
    if (u.category && u.category !== entry.category) parts.push(`category → ${u.category}`);
    if (u.paidFrom && u.paidFrom !== entry.paidFrom) parts.push(`funding → ${paidFromLabel(u.paidFrom)}`);
    return parts.length ? `Bulk correction: ${parts.join(", ")}` : null;
  }

  function handleApply() {
    if (!anyField || busy) return;
    setBusy(true);
    let n = 0;
    for (const e of entries) {
      const u = buildUpdates(e);
      if (Object.keys(u).length > 0) {
        updateEntry(e.id, u);
        // Log the change to the entry's edit history (single-entry edits do
        // this too; bulk previously didn't, leaving no audit trail).
        const summary = changeSummary(e, u);
        if (summary && me) {
          appendEntryHistory(e.id, { at: new Date().toISOString(), by: me.id, summary });
        }
        n++;
      }
    }
    onApplied(n);
  }

  const total = entries.reduce((s, e) => s + e.total, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/40 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-5 mb-4 sm:mb-0 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-leaf-600" />
            <p className="text-base font-medium text-ink-900">Correct {entries.length} entr{entries.length === 1 ? "y" : "ies"}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cancel"
            className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center hover:bg-sand-100"
          >
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>
        <p className="text-[11px] text-ink-500 mb-4">
          {peso(total)} total · only the fields you switch on are changed.
        </p>

        {/* Move to month */}
        <FieldToggle on={doMonth} onToggle={() => setDoMonth((v) => !v)} label="Move to month">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={!doMonth}
            className="input h-10 disabled:opacity-50"
          />
          <p className="text-[11px] text-ink-500 mt-1">
            The day of the month is kept (clamped if the target month is shorter).
          </p>
        </FieldToggle>

        {/* Category */}
        <FieldToggle on={doCategory} onToggle={() => setDoCategory((v) => !v)} label="Set category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={!doCategory}
            className="input h-10 disabled:opacity-50"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </FieldToggle>

        {/* Paid from */}
        <FieldToggle on={doPaidFrom} onToggle={() => setDoPaidFrom((v) => !v)} label="Set funding source">
          <div className="flex gap-2">
            {(["pcf", "other"] as PaymentSource[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPaidFrom(p)}
                disabled={!doPaidFrom}
                className={
                  "flex-1 h-10 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 " +
                  (paidFrom === p
                    ? "bg-leaf-50 border-leaf-300 text-leaf-700"
                    : "bg-white border-sand-200 text-ink-700")
                }
              >
                {paidFromLabel(p)}
              </button>
            ))}
          </div>
        </FieldToggle>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn btn-sm flex-1" disabled={busy}>
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!anyField || busy}
            className="btn-primary flex-1 h-9 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Apply to {entries.length}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldToggle({
  on,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={onToggle}
        className="flex items-center gap-2 mb-1.5"
      >
        <span
          className={
            "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border " +
            (on ? "bg-leaf-500 border-leaf-500 text-white" : "border-sand-300 text-transparent")
          }
        >
          <Check className="w-3 h-3" strokeWidth={3} />
        </span>
        <span className="text-sm font-medium text-ink-900">{label}</span>
      </button>
      {children}
    </div>
  );
}
