"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, Plus, Search } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import { getEntries, getUserById } from "@/lib/store";
import { peso, relativeDate } from "@/lib/format";
import { staffCategoryLabel } from "@/lib/category-meta";

type Filter = "all" | "mine" | "flagged";

export default function StaffEntriesPage() {
  useStoreTick();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const allEntries = getEntries();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries
      .filter((e) => {
        if (filter === "mine" && e.loggedBy !== myId) return false;
        if (filter === "flagged" && !e.flags.some((f) => !f.resolved)) return false;
        if (q.length === 0) return true;
        return (
          e.vendor.toLowerCase().includes(q) ||
          e.item.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [allEntries, filter, query, myId]);

  // Group by date for visual separation
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const e of filtered) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const counts = useMemo(
    () => ({
      all: allEntries.length,
      mine: allEntries.filter((e) => e.loggedBy === myId).length,
      flagged: allEntries.filter((e) => e.flags.some((f) => !f.resolved)).length,
    }),
    [allEntries, myId],
  );

  return (
    <div className="pb-4">
      {/* Header + search */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-medium text-ink-900">Entries</h1>
          <Link href="/new" className="btn btn-sm bg-leaf-500 text-white border-leaf-500">
            <Plus className="w-3.5 h-3.5" /> New
          </Link>
        </div>
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

      {/* Filter chips */}
      <div className="px-5 pt-3 flex gap-2 overflow-x-auto">
        {(
          [
            { key: "all", label: `All · ${counts.all}` },
            { key: "mine", label: `Mine · ${counts.mine}` },
            { key: "flagged", label: `Flagged · ${counts.flagged}` },
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

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ink-700">No entries match.</p>
          <p className="text-xs text-ink-500 mt-1">
            {query
              ? "Try a different search term."
              : filter === "flagged"
                ? "Nothing flagged right now — nice."
                : "Log your first expense from the New button."}
          </p>
        </div>
      )}

      {/* Grouped list */}
      <div className="pt-3">
        {grouped.map(([date, items]) => {
          const dayTotal = items.reduce((s, e) => s + e.total, 0);
          return (
            <div key={date} className="px-5 pt-3 pb-1">
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[11px] font-medium text-ink-500 uppercase tracking-wide">
                  {relativeDate(date)}
                </p>
                <p className="text-[11px] text-ink-500">
                  {items.length} entr{items.length === 1 ? "y" : "ies"} ·{" "}
                  {peso(dayTotal)}
                </p>
              </div>
              <div className="space-y-1.5">
                {items.map((entry) => {
                  const logger = getUserById(entry.loggedBy);
                  const hasOpenFlag = entry.flags.some((f) => !f.resolved);
                  const hasUnreadNote = entry.notes.length > 0;
                  return (
                    <Link
                      key={entry.id}
                      href={`/entries/${entry.id}`}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-900 truncate">
                          {hasOpenFlag && (
                            <AlertCircle className="w-3 h-3 text-clay-500 inline mr-1 -mt-0.5" />
                          )}
                          {entry.vendor} · {entry.item}
                        </p>
                        <p className="text-[11px] text-ink-500 mt-0.5">
                          {staffCategoryLabel(entry.category)} · {logger?.name ?? "—"}
                          {entry.paidFrom === "other" && (
                            <span className="ml-1.5 text-ink-500">· Other fund</span>
                          )}
                          {hasUnreadNote && (
                            <span className="ml-1.5 text-ink-700">
                              · {entry.notes.length} note{entry.notes.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-ink-900 ml-3">
                        {peso(entry.total)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
