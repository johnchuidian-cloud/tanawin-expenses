"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  ImagePlus,
  Lightbulb,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCurrentUser, homePathFor } from "@/lib/auth";
import {
  addItemsToReceipt,
  addPurchase,
  getCategoryDefs,
  getEntries,
  getEntriesByReceipt,
  getReceiptById,
} from "@/lib/store";
import { useStoreTick } from "@/lib/useStoreTick";
import { peso, toIsoDate } from "@/lib/format";
import { fileToCompressedDataUrl } from "@/lib/image";
import type { Category, PaymentSource } from "@/lib/types";
import { iconFor, staffCategoryLabel } from "@/lib/category-meta";
import { suggestCategory } from "@/lib/category-hints";
import { flagsForEntry, suggestsMajorRepair } from "@/lib/validation";

interface LineItem {
  id: string;
  item: string;
  qty: number;
  unitPrice: number;
  total: number;
  category: Category;
  majorRepair: boolean;
}

function newId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function NewPurchasePage() {
  useStoreTick();
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useCurrentUser();
  const categoryDefs = getCategoryDefs();

  // ---- Append mode: ?receiptId=... adds items to an EXISTING receipt
  // (reached from an entry's detail/edit page or a receipt page). Vendor,
  // date, photo, and funding all come from that purchase — the form only
  // collects the missing items.
  const appendReceiptId = searchParams.get("receiptId");
  const appendReceipt = appendReceiptId ? getReceiptById(appendReceiptId) : undefined;
  const appendMode = !!appendReceipt;
  const appendSiblings = appendReceipt ? getEntriesByReceipt(appendReceipt.id) : [];
  const appendPaidFrom: PaymentSource = appendSiblings[0]?.paidFrom ?? "pcf";
  const appendSiblingsTotal = appendSiblings.reduce((s, e) => s + e.total, 0);

  // ---- Shared purchase fields ----
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(toIsoDate());
  const [paidFrom, setPaidFrom] = useState<PaymentSource>("pcf");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [receiptTotal, setReceiptTotal] = useState("");
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  // ---- Line items already added ----
  const [items, setItems] = useState<LineItem[]>([]);

  // ---- The item currently being entered/edited ----
  const [editId, setEditId] = useState<string | null>(null);
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "">("");
  const [majorRepair, setMajorRepair] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const numQty = Number(qty) || 0;
  const numUnit = Number(unitPrice) || 0;
  const computedTotal = numQty * numUnit;
  const editorTotal = totalOverride !== null ? Number(totalOverride) || 0 : computedTotal;
  const totalIsOverridden = totalOverride !== null && editorTotal !== computedTotal;

  const effectiveVendor = appendMode ? appendReceipt!.vendor : vendor;
  const suggestion = useMemo(
    () => suggestCategory(effectiveVendor, itemName),
    [effectiveVendor, itemName],
  );
  const showSuggestion = !!suggestion && category === "";

  const suggestMajor = useMemo(
    () => category === "Maintenance" && suggestsMajorRepair(category, editorTotal),
    [category, editorTotal],
  );

  const itemsTotal = items.reduce((s, it) => s + it.total, 0);
  const receiptTotalNum = receiptTotal.trim() ? Number(receiptTotal) || 0 : null;
  const totalMismatch =
    receiptTotalNum !== null && items.length > 0 && Math.abs(itemsTotal - receiptTotalNum) > 0.5;

  function clearEditor() {
    setEditId(null);
    setItemName("");
    setQty("1");
    setUnitPrice("");
    setTotalOverride(null);
    setCategory("");
    setMajorRepair(false);
  }

  function handleCategoryChange(next: Category | "") {
    setCategory(next);
    // Utilities are usually a bank transfer — nudge the whole purchase once.
    if (next === "Utilities" && paidFrom === "pcf") setPaidFrom("other");
  }

  function commitItem() {
    if (!itemName.trim()) return setError("Item name is required.");
    if (numQty <= 0) return setError("Quantity must be greater than zero.");
    if (numUnit <= 0) return setError("Unit price must be greater than zero.");
    if (!category) return setError("Pick a tag for this item.");
    setError(null);

    const li: LineItem = {
      id: editId ?? newId(),
      item: itemName.trim(),
      qty: numQty,
      unitPrice: numUnit,
      total: editorTotal,
      category,
      majorRepair: category === "Maintenance" ? majorRepair : false,
    };
    setItems((list) =>
      editId ? list.map((x) => (x.id === editId ? li : x)) : [...list, li],
    );
    clearEditor();
  }

  function editItem(li: LineItem) {
    setEditId(li.id);
    setItemName(li.item);
    setQty(String(li.qty));
    setUnitPrice(String(li.unitPrice));
    setTotalOverride(li.total !== li.qty * li.unitPrice ? String(li.total) : null);
    setCategory(li.category);
    setMajorRepair(li.majorRepair);
    setError(null);
  }

  function deleteItem(id: string) {
    setItems((list) => list.filter((x) => x.id !== id));
    if (editId === id) clearEditor();
  }

  async function handlePhoto(file: File) {
    setPhotoBusy(true);
    try {
      setPhoto(await fileToCompressedDataUrl(file));
    } catch {
      setError("Couldn't read that image. Try another photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSave() {
    if (!me || saving) return;
    if (!appendMode && !vendor.trim()) return setError("Vendor is required.");
    if (!appendMode && !date) return setError("Pick a date.");
    if (items.length === 0) return setError("Add at least one item.");

    const saveVendor = appendMode ? appendReceipt!.vendor : vendor.trim();
    const saveDate = appendMode ? appendReceipt!.date : date;

    const history = getEntries();
    const purchaseItems = items.map((li) => ({
      item: li.item,
      qty: li.qty,
      unitPrice: li.unitPrice,
      total: li.total,
      category: li.category,
      majorRepair: li.category === "Maintenance" ? li.majorRepair : undefined,
      flags: flagsForEntry(
        {
          date: saveDate,
          vendor: saveVendor,
          item: li.item,
          qty: li.qty,
          unitPrice: li.unitPrice,
          total: li.total,
          category: li.category,
        },
        history,
      ).filter((f) => f.kind !== "missing-category"),
    }));

    // Wait for the server to confirm before leaving the page. If the save
    // fails, everything stays in the form so tapping Save again is enough.
    setSaving(true);
    setError(null);

    if (appendMode) {
      const res = await addItemsToReceipt({
        receiptId: appendReceipt!.id,
        capturedBy: me.id,
        paidFrom: appendPaidFrom,
        items: purchaseItems,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      // Land on the receipt so the updated item list is right there.
      router.replace(
        me.role === "admin" ? `/gallery/${appendReceipt!.id}` : `/scan/${appendReceipt!.id}`,
      );
      return;
    }

    const res = await addPurchase({
      vendor: saveVendor,
      date: saveDate,
      photoUrl: photo ?? undefined,
      paidFrom,
      capturedBy: me.id,
      receiptTotal: receiptTotalNum ?? undefined,
      items: purchaseItems,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }

    router.replace(homePathFor(me.role));
  }

  // View-only guests can't log expenses — the nav hides /new, but guard the
  // route too in case of a direct link. (Placed after all hooks so the hook
  // order stays identical across renders.)
  if (me?.role === "guest") {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center">
        <p className="text-sm text-ink-700">This account is view-only.</p>
        <p className="text-xs text-ink-500 mt-1">
          Guests can browse entries and reports but can&rsquo;t add or change anything.
        </p>
        <button onClick={() => router.replace("/entries")} className="btn btn-sm mt-4">
          Back to entries
        </button>
      </div>
    );
  }

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
        <div>
          <p className="text-base font-medium text-ink-900">
            {appendMode ? "Add items to this receipt" : "Log new expense"}
          </p>
          <p className="text-[11px] text-ink-500">
            {appendMode
              ? `${appendReceipt!.vendor} · ${appendReceipt!.date}`
              : "One receipt, as many tagged items as you need"}
          </p>
        </div>
      </div>

      <div className="px-5 pt-5 space-y-5">
        {/* Append mode: the purchase already exists — show it, don't re-ask. */}
        {appendMode && (
          <div className="rounded-lg border border-leaf-200 bg-leaf-50/50 p-3">
            <p className="text-sm text-ink-900">
              Adding to <span className="font-medium">{appendReceipt!.vendor}</span>
            </p>
            <p className="text-[11px] text-ink-500 mt-0.5">
              {appendReceipt!.date} · {appendSiblings.length} item
              {appendSiblings.length === 1 ? "" : "s"} already logged ·{" "}
              {peso(appendSiblingsTotal)} of {peso(appendReceipt!.totalTyped)} receipt total
            </p>
            <p className="text-[11px] text-ink-500 mt-1">
              New items share the receipt&rsquo;s photo, date, and{" "}
              {appendPaidFrom === "pcf" ? "PCF" : "Other fund"} payment.
            </p>
          </div>
        )}

        {/* Vendor + date */}
        {!appendMode && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label htmlFor="vendor" className="label">Vendor / store</label>
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
          <div className="col-span-2">
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
        </div>
        )}

        {/* Receipt photo — explicit Take photo / Upload choice */}
        {!appendMode && (
        <div>
          <p className="label">Receipt photo (optional)</p>
          {photo ? (
            <div className="rounded-lg border border-leaf-300 bg-leaf-50/40 p-3 flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Receipt preview" className="max-h-48 rounded object-contain" />
              <div className="flex items-center gap-4 mt-2">
                <button
                  type="button"
                  onClick={() => uploadInput.current?.click()}
                  className="text-xs text-leaf-600 inline-flex items-center gap-1"
                >
                  <ImagePlus className="w-3.5 h-3.5" /> Replace
                </button>
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="text-xs text-ink-500 inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cameraInput.current?.click()}
                disabled={photoBusy}
                className="rounded-lg border border-sand-200 bg-white hover:bg-sand-50 transition-colors flex flex-col items-center justify-center text-center py-4 disabled:opacity-60"
              >
                <Camera className="w-6 h-6 text-ink-700 mb-1" />
                <span className="text-sm font-medium text-ink-900">
                  {photoBusy ? "Processing…" : "Take photo"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => uploadInput.current?.click()}
                disabled={photoBusy}
                className="rounded-lg border border-sand-200 bg-white hover:bg-sand-50 transition-colors flex flex-col items-center justify-center text-center py-4 disabled:opacity-60"
              >
                <ImagePlus className="w-6 h-6 text-ink-700 mb-1" />
                <span className="text-sm font-medium text-ink-900">Upload</span>
              </button>
            </div>
          )}
          {/* capture="environment" forces the camera; the upload input omits it
              so it opens the gallery/files picker. */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
              e.target.value = "";
            }}
          />
          <input
            ref={uploadInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePhoto(f);
              e.target.value = "";
            }}
          />
        </div>
        )}

        {/* Items already added */}
        {items.length > 0 && (
          <div>
            <p className="label">Items on this receipt · {items.length}</p>
            <div className="space-y-1.5">
              {items.map((li) => {
                const Icon = iconFor(li.category);
                const isEditing = editId === li.id;
                return (
                  <div
                    key={li.id}
                    className={
                      "flex items-center gap-2 p-2.5 rounded-lg border " +
                      (isEditing
                        ? "border-leaf-300 bg-leaf-50/40"
                        : "border-sand-200 bg-white")
                    }
                  >
                    <div className="w-8 h-8 rounded-lg bg-sand-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-ink-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-900 truncate">{li.item}</p>
                      <p className="text-[11px] text-ink-500">
                        {li.qty} × {peso(li.unitPrice, { cents: true })} · {li.category}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-ink-900">{peso(li.total)}</p>
                    <button
                      type="button"
                      onClick={() => editItem(li)}
                      aria-label="Edit item"
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-sand-100"
                    >
                      <Pencil className="w-3.5 h-3.5 text-ink-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteItem(li.id)}
                      aria-label="Delete item"
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-clay-50"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-clay-500" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs mt-2 px-1">
              <span className="text-ink-500">Items total</span>
              <span className="font-medium text-ink-900">{peso(itemsTotal)}</span>
            </div>
          </div>
        )}

        {/* Item editor */}
        <div className="rounded-lg border border-sand-200 bg-sand-50/60 p-3 space-y-3">
          <p className="text-sm font-medium text-ink-900">
            {editId ? "Edit item" : "Add an item"}
          </p>

          <div>
            <label htmlFor="item" className="label">Item</label>
            <input
              id="item"
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Rice 5kg"
              className="input"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
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
              <label htmlFor="unitPrice" className="label">Unit ₱</label>
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
            <div>
              <label htmlFor="lineTotal" className="label">Total ₱</label>
              <input
                id="lineTotal"
                type="text"
                inputMode="decimal"
                value={totalOverride ?? String(computedTotal || "")}
                onChange={(e) => setTotalOverride(e.target.value.replace(/[^\d.]/g, ""))}
                className="input"
              />
            </div>
          </div>
          {totalIsOverridden && (
            <button
              type="button"
              onClick={() => setTotalOverride(null)}
              className="text-[11px] text-leaf-600 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reset total to {peso(computedTotal)}
            </button>
          )}

          {/* Tag / category */}
          <div>
            <p className="label">Tag</p>
            {showSuggestion && suggestion && (
              <button
                type="button"
                onClick={() => handleCategoryChange(suggestion)}
                className="w-full mb-2 px-3 py-2 rounded-lg bg-leaf-50 border border-leaf-100 flex items-center gap-2 hover:bg-leaf-100 transition-colors text-left"
              >
                <Lightbulb className="w-4 h-4 text-leaf-600 flex-shrink-0" />
                <p className="text-xs text-leaf-600 flex-1">
                  Looks like <span className="font-medium">{staffCategoryLabel(suggestion)}</span>?{" "}
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
                      "p-2 rounded-lg border flex flex-col items-center text-center gap-1 transition-colors " +
                      (active
                        ? "border-leaf-500 bg-leaf-50"
                        : "border-sand-200 bg-white hover:bg-sand-50")
                    }
                  >
                    <Icon className={"w-5 h-5 " + (active ? "text-leaf-600" : "text-ink-700")} />
                    <span className="text-[10px] leading-tight font-medium text-ink-900">
                      {def.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {category === "Maintenance" && (
            <label className="flex items-start gap-2 p-2.5 rounded-lg bg-white border border-sand-200 cursor-pointer">
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
                    ? "Suggested: above the ₱5,000 threshold."
                    : "Big-ticket repairs (aircon overhaul, structural, etc.)."}
                </p>
              </div>
            </label>
          )}

          <div className="flex gap-2">
            {editId && (
              <button type="button" onClick={clearEditor} className="btn btn-sm flex-1">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
            <button
              type="button"
              onClick={commitItem}
              className="btn-primary flex-1 h-9 text-sm"
            >
              {editId ? (
                <>
                  <Check className="w-4 h-4" /> Update item
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" /> Add item
                </>
              )}
            </button>
          </div>
        </div>

        {/* Paid from */}
        {!appendMode && (
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
        </div>
        )}

        {/* Optional receipt total — verify line items add up */}
        {!appendMode && (
        <div>
          <label htmlFor="receiptTotal" className="label">
            Receipt total (optional)
          </label>
          <input
            id="receiptTotal"
            type="text"
            inputMode="decimal"
            value={receiptTotal}
            onChange={(e) => setReceiptTotal(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Type the total printed on the receipt"
            className="input"
          />
          {totalMismatch ? (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-clay-500">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <p>
                Items add up to {peso(itemsTotal)}, but the receipt total is{" "}
                {peso(receiptTotalNum ?? 0)}. Check for a missing item or a typo —
                you can still save.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-ink-500 mt-1">
              Leave blank to use the items total. Fill it in to double-check the
              items add up.
            </p>
          )}
        </div>
        )}

        {/* Append mode: live reconciliation against the receipt's total */}
        {appendMode && items.length > 0 && (
          <p className="text-[11px] text-ink-500">
            After saving, items on this receipt will total{" "}
            <span className="font-medium text-ink-700">
              {peso(appendSiblingsTotal + itemsTotal)}
            </span>{" "}
            of the {peso(appendReceipt!.totalTyped)} printed total.
          </p>
        )}

        {error && <p className="text-sm text-clay-500">{error}</p>}

        <button onClick={handleSave} disabled={saving} className="btn-primary w-full disabled:opacity-70">
          {saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Check className="w-4 h-4" />
              Save purchase
              {items.length > 0 && (
                <span className="font-normal opacity-90">
                  · {items.length} item{items.length === 1 ? "" : "s"} · {peso(itemsTotal)}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
