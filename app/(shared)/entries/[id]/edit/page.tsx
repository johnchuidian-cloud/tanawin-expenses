"use client";

export const runtime = "edge";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, Plus, RefreshCw, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  appendEntryHistory,
  ensureEntryMedia,
  getCategoryDefs,
  getEntries,
  getEntryById,
  updateEntry,
} from "@/lib/store";
import { peso, toIsoDate } from "@/lib/format";
import type { Category, Entry, Flag, PaymentSource, User } from "@/lib/types";
import { iconFor } from "@/lib/category-meta";
import { flagsForEntry, suggestsMajorRepair } from "@/lib/validation";

export default function EditEntryPage() {
  useStoreTick();
  const params = useParams<{ id: string }>();
  const me = useCurrentUser();
  const entry = getEntryById(params.id);

  // Pre-warm this entry's photos/history (not downloaded at app start) so
  // the history append on save has the real blob to merge into.
  useEffect(() => {
    if (params.id) ensureEntryMedia(params.id);
  }, [params.id]);

  // Loading (undefined) or logged out (null) — the shared layout redirects
  // logged-out users, so just hold here. After this guard `me` is a User.
  if (!me) {
    return (
      <div className="px-5 py-10 text-center text-sm text-ink-500">Loading…</div>
    );
  }

  if (!entry) {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center">
        <p className="text-sm text-ink-700">Entry not found.</p>
        <Link href="/entries" className="btn btn-sm mt-4">
          Back to entries
        </Link>
      </div>
    );
  }

  // Admins can edit any entry; staff can edit only the ones they logged.
  const canEdit = me.role === "admin" || me.id === entry.loggedBy;
  if (!canEdit) {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center">
        <p className="text-sm text-ink-700">You can&rsquo;t edit this entry.</p>
        <p className="text-xs text-ink-500 mt-1">
          Only the person who logged it or an admin can make changes.
        </p>
        <Link href={`/entries/${entry.id}`} className="btn btn-sm mt-4">
          Back to entry
        </Link>
      </div>
    );
  }

  return <EditEntryForm entry={entry} me={me} />;
}

function EditEntryForm({ entry, me }: { entry: Entry; me: User }) {
  const router = useRouter();
  const categoryDefs = getCategoryDefs();

  const [date, setDate] = useState(entry.date);
  const [vendor, setVendor] = useState(entry.vendor);
  const [item, setItem] = useState(entry.item);
  const [qty, setQty] = useState(String(entry.qty));
  const [unitPrice, setUnitPrice] = useState(String(entry.unitPrice));
  // Treat the stored total as an override only if it doesn't match qty × unit.
  const initialComputed = entry.qty * entry.unitPrice;
  const [totalOverride, setTotalOverride] = useState<string | null>(
    Math.abs(initialComputed - entry.total) > 0.005 ? String(entry.total) : null,
  );
  const [category, setCategory] = useState<Category>(entry.category);
  const [majorRepair, setMajorRepair] = useState(!!entry.majorRepair);
  const [paidFrom, setPaidFrom] = useState<PaymentSource>(entry.paidFrom);
  const [error, setError] = useState<string | null>(null);

  const numericQty = Number(qty) || 0;
  const numericUnit = Number(unitPrice) || 0;
  const computedTotal = numericQty * numericUnit;
  const displayedTotal =
    totalOverride !== null ? Number(totalOverride) || 0 : computedTotal;
  const totalIsOverridden = totalOverride !== null && displayedTotal !== computedTotal;

  // Other entries (everything except this one) — used so the duplicate check
  // doesn't match the entry against itself.
  const otherEntries = useMemo(
    () => getEntries().filter((e) => e.id !== entry.id),
    [entry.id],
  );

  const previewFlags = useMemo(() => {
    if (!vendor.trim() || !item.trim() || numericQty <= 0 || numericUnit <= 0) {
      return [];
    }
    if (!category) return [];
    return flagsForEntry(
      {
        date,
        vendor: vendor.trim(),
        item: item.trim(),
        qty: numericQty,
        unitPrice: numericUnit,
        total: displayedTotal,
        category,
      },
      otherEntries,
    ).filter((f) => f.kind !== "missing-category");
  }, [date, vendor, item, numericQty, numericUnit, displayedTotal, category, otherEntries]);

  const suggestMajor = useMemo(
    () => category === "Maintenance" && suggestsMajorRepair(category, displayedTotal),
    [category, displayedTotal],
  );

  function handleSave() {
    if (!vendor.trim() || !item.trim()) {
      setError("Vendor and item are required.");
      return;
    }
    if (numericQty <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (numericUnit <= 0) {
      setError("Unit price must be greater than zero.");
      return;
    }
    if (!category) {
      setError("Please choose a category.");
      return;
    }
    if (!date) {
      setError("Pick a date.");
      return;
    }

    const recomputed = flagsForEntry(
      {
        date,
        vendor: vendor.trim(),
        item: item.trim(),
        qty: numericQty,
        unitPrice: numericUnit,
        total: displayedTotal,
        category,
      },
      otherEntries,
    ).filter((f) => f.kind !== "missing-category");

    // Carry over a resolved state for any flag of the same kind that an
    // admin had already cleared — so a cosmetic edit doesn't re-open a
    // flag someone deliberately resolved.
    const merged: Flag[] = recomputed.map((nf) => {
      const prior = entry.flags.find((pf) => pf.kind === nf.kind && pf.resolved);
      return prior
        ? { ...nf, resolved: true, resolvedBy: prior.resolvedBy, resolvedAt: prior.resolvedAt }
        : nf;
    });

    const effectiveMajor = category === "Maintenance" ? majorRepair : false;

    updateEntry(entry.id, {
      date,
      vendor: vendor.trim(),
      item: item.trim(),
      qty: numericQty,
      unitPrice: numericUnit,
      total: displayedTotal,
      category,
      paidFrom,
      // Explicit false (not undefined) so switching away from Maintenance
      // clears a previously-set major-repair flag.
      majorRepair: effectiveMajor,
      flags: merged,
    });

    // Record what changed in the entry's edit history.
    const changes: string[] = [];
    if (entry.vendor !== vendor.trim()) changes.push("vendor");
    if (entry.item !== item.trim()) changes.push("item");
    if (entry.qty !== numericQty) changes.push("qty");
    if (entry.unitPrice !== numericUnit) changes.push("unit price");
    if (Math.abs(entry.total - displayedTotal) > 0.005) changes.push("total");
    if (entry.category !== category) changes.push("category");
    if (entry.paidFrom !== paidFrom) changes.push("fund source");
    if (!!entry.majorRepair !== effectiveMajor) changes.push("major repair");
    if (entry.date !== date) changes.push("date");
    if (changes.length > 0) {
      appendEntryHistory(entry.id, {
        at: new Date().toISOString(),
        by: me.id,
        summary: `Edited ${changes.join(", ")}`,
      });
    }

    router.replace(`/entries/${entry.id}`);
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.replace(`/entries/${entry.id}`)}
          aria-label="Cancel"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div>
          <p className="text-base font-medium text-ink-900">Edit entry</p>
          <p className="text-[11px] text-ink-500">
            Correct a mistake in a submitted entry
          </p>
        </div>
      </div>

      <div className="px-5 pt-5 space-y-4">
        {/* This entry is one line of a multi-item receipt — offer to add a
            missing item to the same purchase instead of editing this one. */}
        {entry.receiptId && (
          <Link
            href={`/new?receiptId=${entry.receiptId}`}
            className="flex items-center gap-2 p-3 rounded-lg border border-leaf-200 bg-leaf-50/50 hover:bg-leaf-50 transition-colors"
          >
            <Plus className="w-4 h-4 text-leaf-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-900">Missing an item from this receipt?</p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                Add a new item to the same purchase — photo, date, and fund carry over.
              </p>
            </div>
          </Link>
        )}

        <div>
          <label htmlFor="vendor" className="label">Vendor</label>
          <input
            id="vendor"
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Puregold"
            className="input"
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="item" className="label">Item</label>
          <input
            id="item"
            type="text"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. Rice 5kg"
            className="input"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qty" className="label">Qty</label>
            <input
              id="qty"
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value.replace(/[^\d.]/g, ""));
                setTotalOverride(null);
              }}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="unitPrice" className="label">Unit price (₱)</label>
            <input
              id="unitPrice"
              type="text"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => {
                setUnitPrice(e.target.value.replace(/[^\d.]/g, ""));
                setTotalOverride(null);
              }}
              placeholder="0"
              className="input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="total" className="label flex items-center justify-between">
            <span>Total (₱)</span>
            {totalIsOverridden && (
              <button
                type="button"
                onClick={() => setTotalOverride(null)}
                className="text-[11px] text-leaf-600 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Reset to {peso(computedTotal)}
              </button>
            )}
          </label>
          <input
            id="total"
            type="text"
            inputMode="decimal"
            value={totalOverride ?? String(computedTotal || "")}
            onChange={(e) =>
              setTotalOverride(e.target.value.replace(/[^\d.]/g, ""))
            }
            className="input"
          />
          <p className="text-[11px] text-ink-500 mt-1">
            Auto-calculated from qty × unit price. Edit only if the receipt
            shows a different total.
          </p>
        </div>

        <div>
          <p className="label">Category</p>
          <div className="grid grid-cols-3 gap-2">
            {categoryDefs.map((def) => {
              const Icon = iconFor(def.id);
              const active = category === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => setCategory(def.id)}
                  aria-pressed={active}
                  className={
                    "p-2.5 rounded-lg border flex flex-col items-center text-center gap-1 transition-colors " +
                    (active
                      ? "border-leaf-500 bg-leaf-50"
                      : "border-sand-200 bg-white hover:bg-sand-50")
                  }
                >
                  <Icon
                    className={
                      "w-5 h-5 " + (active ? "text-leaf-600" : "text-ink-700")
                    }
                  />
                  <span className="text-[11px] leading-tight font-medium text-ink-900">
                    {def.id}
                  </span>
                  {def.tagalog && (
                    <span className="text-[10px] leading-tight text-ink-500">
                      ({def.tagalog})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label">Paid from</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaidFrom("pcf")}
              className={
                "p-3 rounded-lg border text-left transition-colors " +
                (paidFrom === "pcf"
                  ? "border-leaf-500 bg-leaf-50"
                  : "border-sand-200 bg-white hover:bg-sand-50")
              }
            >
              <p className="text-sm font-medium text-ink-900">PCF</p>
              <p className="text-[11px] text-ink-500 mt-0.5">Pooled petty cash</p>
            </button>
            <button
              type="button"
              onClick={() => setPaidFrom("other")}
              className={
                "p-3 rounded-lg border text-left transition-colors " +
                (paidFrom === "other"
                  ? "border-leaf-500 bg-leaf-50"
                  : "border-sand-200 bg-white hover:bg-sand-50")
              }
            >
              <p className="text-sm font-medium text-ink-900">Other fund</p>
              <p className="text-[11px] text-ink-500 mt-0.5">Bank transfer, etc.</p>
            </button>
          </div>
          {paidFrom === "other" && (
            <p className="text-[11px] text-ink-500 mt-1">
              Won&rsquo;t draw down the PCF balance. Recorded for reporting only.
            </p>
          )}
        </div>

        {category === "Maintenance" && (
          <label className="flex items-start gap-2 p-3 rounded-lg bg-sand-50 border border-sand-200 cursor-pointer">
            <input
              type="checkbox"
              checked={majorRepair}
              onChange={(e) => setMajorRepair(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="text-sm text-ink-900">Mark as Major Repair</p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                {suggestMajor
                  ? "Suggested: amount is above the ₱5,000 threshold."
                  : "Use for big-ticket repairs (aircon overhaul, structural, etc.)."}
              </p>
            </div>
          </label>
        )}

        {previewFlags.length > 0 && (
          <div className="rounded-lg bg-clay-50 border border-clay-200 p-3 space-y-2">
            <p className="text-[11px] font-medium text-clay-500 uppercase tracking-wide">
              Heads up
            </p>
            {previewFlags.map((flag) => (
              <div key={flag.kind} className="flex gap-2 text-xs">
                <AlertCircle className="w-3.5 h-3.5 text-clay-500 flex-shrink-0 mt-0.5" />
                <p className="text-ink-700">{flag.message}</p>
              </div>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="date" className="label">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            max={toIsoDate()}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </div>

        {error && <p className="text-sm text-clay-500">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => router.replace(`/entries/${entry.id}`)}
            className="btn flex-1"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
          <button onClick={handleSave} className="btn-primary flex-1">
            <Check className="w-4 h-4" /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
