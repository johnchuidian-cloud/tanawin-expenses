"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, ImagePlus, Lightbulb, RefreshCw, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import {
  addEntry,
  addNoteToEntry,
  getCategoryDefs,
  getEntries,
} from "@/lib/store";
import { useStoreTick } from "@/lib/useStoreTick";
import { peso, toIsoDate } from "@/lib/format";
import { fileToCompressedDataUrl } from "@/lib/image";
import type { Category, PaymentSource } from "@/lib/types";
import { iconFor, staffCategoryLabel } from "@/lib/category-meta";
import { suggestCategory } from "@/lib/category-hints";
import { flagsForEntry, suggestsMajorRepair } from "@/lib/validation";

export default function StaffNewEntryPage() {
  useStoreTick(); // re-render when categories are added/removed
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useCurrentUser();
  const categoryDefs = getCategoryDefs();

  // When /new is opened from a scanned receipt, pre-fill vendor/date and
  // remember the receipt id so we link the new entry back and return there.
  const presetReceiptId = searchParams.get("receiptId");
  const presetVendor = searchParams.get("vendor") ?? "";
  const presetDate = searchParams.get("date") ?? toIsoDate();

  const [date, setDate] = useState(presetDate);
  const [vendor, setVendor] = useState(presetVendor);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "">("");
  const [majorRepair, setMajorRepair] = useState(false);
  const [paidFrom, setPaidFrom] = useState<PaymentSource>("pcf");
  const [paidFromAutoSuggested, setPaidFromAutoSuggested] = useState(false);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handlePhoto(file: File) {
    setPhotoBusy(true);
    try {
      const compressed = await fileToCompressedDataUrl(file);
      setPhotoUrl(compressed);
    } catch {
      setError("Couldn't read that image. Try another photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleCategoryChange(next: Category | "") {
    setCategory(next);
    // Utilities are usually paid by bank transfer — nudge but don't force.
    // The user can override either way; we only auto-suggest once so we
    // don't fight a deliberate change back.
    if (next === "Utilities" && paidFrom === "pcf" && !paidFromAutoSuggested) {
      setPaidFrom("other");
      setPaidFromAutoSuggested(true);
    }
  }

  const numericQty = Number(qty) || 0;
  const numericUnit = Number(unitPrice) || 0;
  const computedTotal = numericQty * numericUnit;
  const displayedTotal =
    totalOverride !== null ? Number(totalOverride) || 0 : computedTotal;
  const totalIsOverridden = totalOverride !== null && displayedTotal !== computedTotal;

  // Preview flags as the user types — same validation logic that fires on save.
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
      getEntries(),
    ).filter((f) => f.kind !== "missing-category");
  }, [
    date,
    vendor,
    item,
    numericQty,
    numericUnit,
    displayedTotal,
    category,
  ]);

  const suggestMajor = useMemo(
    () => category === "Maintenance" && suggestsMajorRepair(category, displayedTotal),
    [category, displayedTotal],
  );

  // Smart category suggestion — keyword match on vendor + item.
  // Only shows when no category is picked yet; once the user taps any
  // category we step out of the way (their pick beats our guess).
  const suggestion = useMemo(
    () => suggestCategory(vendor, item),
    [vendor, item],
  );
  const showSuggestion = !!suggestion && category === "";

  function handleSubmit() {
    if (!me) return;
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

    const flags = flagsForEntry(
      {
        date,
        vendor: vendor.trim(),
        item: item.trim(),
        qty: numericQty,
        unitPrice: numericUnit,
        total: displayedTotal,
        category,
      },
      getEntries(),
    ).filter((f) => f.kind !== "missing-category");

    const entry = addEntry({
      date,
      vendor: vendor.trim(),
      item: item.trim(),
      qty: numericQty,
      unitPrice: numericUnit,
      total: displayedTotal,
      category,
      paidFrom,
      majorRepair: category === "Maintenance" ? majorRepair : undefined,
      receiptId: presetReceiptId ?? undefined,
      photoUrl: photoUrl ?? undefined,
      loggedBy: me.id,
      flags,
      notes: [],
    });

    // Optional context note — gets attached as a regular comment so it shows
    // up in the entry's conversation thread and on the admin review card if
    // the entry ends up flagged. Especially useful for pre-explaining
    // unusual amounts (Lexi asked me to stock up, market price was high
    // today, etc.) so admin doesn't have to ask later.
    const trimmedNote = note.trim();
    if (trimmedNote.length > 0) {
      addNoteToEntry(entry.id, {
        authorId: me.id,
        body: trimmedNote,
        kind: "comment",
      });
    }

    // If this entry was logged against a receipt, return to that receipt so
    // staff can keep adding line items and watch the reconciliation status
    // update. Otherwise, go back to the home screen (role-appropriate) —
    // that's where people expect to land after saving, and it avoids any
    // edge-case bounce when the entry detail page mounts.
    if (presetReceiptId) {
      router.replace(`/scan/${presetReceiptId}`);
    } else {
      router.replace(me.role === "admin" ? "/dashboard" : "/home");
    }
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div>
          <p className="text-base font-medium text-ink-900">Log new expense</p>
          <p className="text-[11px] text-ink-500">
            One line item per entry — receipts can group entries later
          </p>
        </div>
      </div>

      <div className="px-5 pt-5 space-y-4">
        {presetReceiptId && (
          <div className="rounded-lg bg-sand-50 border border-sand-200 p-3 text-xs text-ink-700">
            Adding a line item to receipt{" "}
            <span className="font-medium">{presetVendor || "—"}</span>. Saving
            will return you to the receipt so you can keep adding items.
          </div>
        )}

        {/* Receipt photo (optional). No `capture` attribute → on phones the OS
            shows the full picker (Photo Library / Take Photo / Files) instead
            of jumping straight to the camera, so uploading from the gallery
            works. */}
        <div>
          <p className="label">Receipt photo (optional)</p>
          {photoUrl ? (
            <div className="rounded-lg border border-leaf-300 bg-leaf-50/40 p-3 flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Receipt preview"
                className="max-h-56 rounded object-contain"
              />
              <div className="flex items-center gap-4 mt-2">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="text-xs text-leaf-600 inline-flex items-center gap-1"
                >
                  <ImagePlus className="w-3.5 h-3.5" /> Replace
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoUrl(null)}
                  className="text-xs text-ink-500 inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={photoBusy}
              className="w-full rounded-lg border-2 border-dashed border-sand-200 bg-sand-50 hover:bg-sand-100 transition-colors flex flex-col items-center justify-center text-center p-5 disabled:opacity-60"
            >
              <ImagePlus className="w-7 h-7 text-ink-300 mb-1.5" />
              <p className="text-sm font-medium text-ink-900">
                {photoBusy ? "Processing photo…" : "Add receipt photo"}
              </p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                Upload from your gallery or take a photo
              </p>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhoto(file);
              // Reset so picking the same file again still fires onChange.
              e.target.value = "";
            }}
          />
        </div>

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
          {showSuggestion && suggestion && (
            <button
              type="button"
              onClick={() => handleCategoryChange(suggestion)}
              className="w-full mb-2 px-3 py-2 rounded-lg bg-leaf-50 border border-leaf-100 flex items-center gap-2 hover:bg-leaf-100 transition-colors text-left"
            >
              <Lightbulb className="w-4 h-4 text-leaf-600 flex-shrink-0" />
              <p className="text-xs text-leaf-600 flex-1">
                Looks like{" "}
                <span className="font-medium">
                  {staffCategoryLabel(suggestion)}
                </span>
                ?{" "}
                <span className="text-leaf-600/70">Tap to apply</span>
              </p>
            </button>
          )}
          <div className="grid grid-cols-3 gap-2">
            {categoryDefs.map((def) => {
              const Icon = iconFor(def.id);
              const active = category === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => handleCategoryChange(def.id)}
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
                      "w-5 h-5 " +
                      (active ? "text-leaf-600" : "text-ink-700")
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
          {!category && (
            <p className="text-[11px] text-ink-500 mt-1">
              Pick a category before saving.
            </p>
          )}
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
              <p className="text-[11px] text-ink-500 mt-0.5">
                Pooled petty cash
              </p>
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
              <p className="text-[11px] text-ink-500 mt-0.5">
                Bank transfer, etc.
              </p>
            </button>
          </div>
          {category === "Utilities" && paidFromAutoSuggested && paidFrom === "other" && (
            <p className="text-[11px] text-ink-500 mt-1">
              Auto-set to &ldquo;Other fund&rdquo; — utilities are usually paid
              by bank transfer. Switch back to PCF if needed.
            </p>
          )}
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
            <p className="text-[11px] text-ink-500">
              You can still save — leave a note below to explain in advance.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="note" className="label">Note (optional)</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={
              previewFlags.length > 0
                ? "e.g. Ate Lexi told me to stock up for the long weekend"
                : "Add context if the price is unusual or someone asked you to buy something specific"
            }
            className="w-full px-3 py-2 rounded-lg border border-sand-200 bg-white text-base text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
          />
          <p className="text-[11px] text-ink-500 mt-1">
            Saves a question later — shows on the entry&rsquo;s thread and on
            Lexi&rsquo;s review card if the entry gets flagged.
          </p>
        </div>

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

        <button onClick={handleSubmit} className="btn-primary w-full">
          <Check className="w-4 h-4" /> Save entry
        </button>
      </div>
    </div>
  );
}
