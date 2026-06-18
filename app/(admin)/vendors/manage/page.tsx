"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, GitMerge, Plus, Store, Trash2, X } from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { useCurrentUser } from "@/lib/auth";
import {
  addSavedVendor,
  approveVendorSuggestion,
  countVendorUsage,
  getEntries,
  getPendingVendorSuggestions,
  getReceipts,
  getSavedVendors,
  getUserById,
  mergeVendors,
  normalizeVendor,
  rejectVendorSuggestion,
  removeSavedVendor,
} from "@/lib/store";

/**
 * Admin tools for the shared vendor registry:
 *  - review staff-proposed vendors (approve → saved, or dismiss);
 *  - add a saved vendor directly;
 *  - merge duplicate spellings ("Pure Gold" → "Puregold") across all past
 *    entries & receipts, folding the old spellings in as aliases.
 */
export default function AdminManageVendorsPage() {
  useStoreTick();
  const router = useRouter();
  const me = useCurrentUser();

  const saved = getSavedVendors();
  const suggestions = getPendingVendorSuggestions();
  const entries = getEntries();
  const receipts = getReceipts();

  // Distinct vendor spellings actually in use, with row counts, busiest first.
  const usedVendors = useMemo(() => {
    const map = new Map<string, { display: string; count: number }>();
    const bump = (raw: string) => {
      const k = normalizeVendor(raw);
      if (!k) return;
      const cur = map.get(k);
      if (cur) cur.count += 1;
      else map.set(k, { display: raw, count: 1 });
    };
    for (const e of entries) bump(e.vendor);
    for (const r of receipts) bump(r.vendor);
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [entries, receipts]);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Add-vendor form
  const [newName, setNewName] = useState("");
  // Merge tool
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");

  async function run(fn: () => Promise<{ ok: boolean; reason?: string }>, okMsg: string) {
    setBusy(true);
    setNote(null);
    const res = await fn();
    setBusy(false);
    setNote(res.ok ? okMsg : res.reason ?? "Something went wrong.");
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    const name = newName.trim();
    await run(() => addSavedVendor(name), `Saved “${name}”.`);
    setNewName("");
  }

  function toggleMerge(display: string) {
    setMergeSel((prev) =>
      prev.includes(display) ? prev.filter((d) => d !== display) : [...prev, display],
    );
  }

  async function handleMerge() {
    if (mergeSel.length === 0 || !mergeTarget.trim() || !me) return;
    const target = mergeTarget.trim();
    setBusy(true);
    setNote(null);
    const res = await mergeVendors(mergeSel, target, me.id);
    setBusy(false);
    if (res.ok) {
      setNote(`Merged ${res.changed} record${res.changed === 1 ? "" : "s"} into “${target}”.`);
      setMergeSel([]);
      setMergeTarget("");
    } else {
      setNote(res.reason ?? "Merge failed.");
    }
  }

  const mergeCount = countVendorUsage(mergeSel);

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div className="flex-1">
          <p className="text-base font-medium text-ink-900 flex items-center gap-1.5">
            <Store className="w-4 h-4 text-ink-500" /> Manage vendors
          </p>
          <p className="text-[11px] text-ink-500">
            Keep vendor names consistent across everyone&rsquo;s entries.
          </p>
        </div>
      </div>

      {note && (
        <div className="px-5 pt-3">
          <p className="text-xs text-leaf-600 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> {note}
          </p>
        </div>
      )}

      {/* Pending suggestions */}
      <section className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Suggestions from staff{suggestions.length > 0 ? ` · ${suggestions.length}` : ""}
        </p>
        {suggestions.length === 0 ? (
          <p className="text-xs text-ink-500">No pending suggestions.</p>
        ) : (
          <div className="space-y-1.5">
            {suggestions.map((s) => {
              const by = getUserById(s.proposedBy)?.name ?? "—";
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-sand-200"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate">{s.name}</p>
                    <p className="text-[11px] text-ink-500">Suggested by {by}</p>
                  </div>
                  <button
                    onClick={() => run(() => approveVendorSuggestion(s.id), `Saved “${s.name}”.`)}
                    disabled={busy}
                    className="btn btn-sm bg-leaf-500 text-white border-leaf-500 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => run(() => rejectVendorSuggestion(s.id), "Dismissed.")}
                    disabled={busy}
                    aria-label="Dismiss suggestion"
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-clay-50 disabled:opacity-50"
                  >
                    <X className="w-4 h-4 text-clay-500" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add a saved vendor */}
      <section className="px-5 pt-6">
        <p className="text-sm font-medium text-ink-900 mb-2">Add a saved vendor</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Beperas Water Treatment Services"
            className="input flex-1"
            autoComplete="off"
          />
          <button
            onClick={handleAdd}
            disabled={busy || !newName.trim()}
            className="btn-primary h-9 text-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </section>

      {/* Saved vendors */}
      <section className="px-5 pt-6">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Saved vendors{saved.length > 0 ? ` · ${saved.length}` : ""}
        </p>
        {saved.length === 0 ? (
          <p className="text-xs text-ink-500">No saved vendors yet.</p>
        ) : (
          <div className="space-y-1.5">
            {saved.map((v) => (
              <div
                key={v.name}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-sand-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-900 truncate">{v.name}</p>
                  {v.aliases.length > 0 && (
                    <p className="text-[11px] text-ink-500 truncate">
                      also: {v.aliases.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => run(() => removeSavedVendor(v.name), `Removed “${v.name}”.`)}
                  disabled={busy}
                  aria-label={`Remove ${v.name}`}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-clay-50 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4 text-clay-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Merge / consolidate */}
      <section className="px-5 pt-6">
        <p className="text-sm font-medium text-ink-900 mb-1 flex items-center gap-1.5">
          <GitMerge className="w-4 h-4 text-ink-500" /> Consolidate spellings
        </p>
        <p className="text-[11px] text-ink-500 mb-2">
          Tick the spellings that are the same vendor, type the correct name, and merge — every
          matching entry &amp; receipt is rewritten and the old spellings become aliases.
        </p>
        {usedVendors.length === 0 ? (
          <p className="text-xs text-ink-500">No vendors in use yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
            {usedVendors.map((v) => {
              const checked = mergeSel.includes(v.display);
              return (
                <button
                  key={v.display}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleMerge(v.display)}
                  className={
                    "inline-flex items-center gap-1 pl-1.5 pr-2.5 h-8 rounded-full border text-xs font-medium transition-colors " +
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
                  {v.display} <span className="text-ink-300">· {v.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {mergeSel.length > 0 && (
          <div className="mt-3">
            <label htmlFor="mergeTarget" className="label">Correct name to merge into</label>
            <input
              id="mergeTarget"
              type="text"
              list="merge-target-options"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              placeholder="e.g. Puregold"
              className="input"
              autoComplete="off"
            />
            <datalist id="merge-target-options">
              {saved.map((v) => (
                <option key={v.name} value={v.name} />
              ))}
              {mergeSel.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <button
              onClick={handleMerge}
              disabled={busy || !mergeTarget.trim()}
              className="btn-primary w-full mt-2 disabled:opacity-50"
            >
              <GitMerge className="w-4 h-4" />
              Merge {mergeSel.length} spelling{mergeSel.length === 1 ? "" : "s"} ({mergeCount} record
              {mergeCount === 1 ? "" : "s"})
            </button>
          </div>
        )}
      </section>

      <div className="px-5 pt-6">
        <Link href="/dashboard" className="text-[11px] text-ink-500">
          Done
        </Link>
      </div>
    </div>
  );
}
