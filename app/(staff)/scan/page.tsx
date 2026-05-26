"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  Image as ImageIcon,
  Upload,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  addReceipt,
  getEntries,
  getReceipts,
  getUserById,
} from "@/lib/store";
import { peso, relativeDate, toIsoDate } from "@/lib/format";
import { reconciliationStatus } from "@/lib/validation";

export default function StaffScanPage() {
  useStoreTick();
  const router = useRouter();
  const me = useCurrentUser();

  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(toIsoDate());
  const [total, setTotal] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit() {
    if (!me) return;
    if (!vendor.trim()) {
      setError("Vendor is required.");
      return;
    }
    const numeric = Number(total.replace(/,/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter the receipt total (greater than zero).");
      return;
    }
    if (!date) {
      setError("Pick a date.");
      return;
    }

    const receipt = addReceipt({
      vendor: vendor.trim(),
      date,
      photoUrl: photoUrl ?? "",
      totalTyped: numeric,
      capturedBy: me.id,
      status: "unfinished",
    });
    router.replace(`/scan/${receipt.id}`);
  }

  // Unfinished receipts (anyone's) — surface them so reconciliation gets closed.
  const allReceipts = getReceipts();
  const allEntries = getEntries();
  const unfinished = useMemo(() => {
    return allReceipts
      .map((r) => {
        const linked = allEntries.filter((e) => e.receiptId === r.id);
        const recon = reconciliationStatus(
          r.totalTyped,
          linked.map((e) => e.total),
        );
        return { receipt: r, linked, recon };
      })
      .filter(
        (row) =>
          row.recon.status === "unfinished" || row.recon.status === "mismatch",
      )
      .sort((a, b) => (a.receipt.date < b.receipt.date ? 1 : -1));
  }, [allReceipts, allEntries]);

  return (
    <div className="pb-6">
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
          <p className="text-base font-medium text-ink-900">Scan receipt</p>
          <p className="text-[11px] text-ink-500">
            Photo first, then add line items
          </p>
        </div>
      </div>

      {/* Capture */}
      <div className="px-5 pt-5 space-y-4">
        <div
          className={
            "rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-6 cursor-pointer transition-colors " +
            (photoUrl
              ? "border-leaf-300 bg-leaf-50/40"
              : "border-sand-200 bg-sand-50 hover:bg-sand-100")
          }
          onClick={() => fileInput.current?.click()}
        >
          {photoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Receipt preview"
                className="max-h-48 rounded mb-2 object-contain"
              />
              <p className="text-xs text-leaf-600 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Photo ready · tap to replace
              </p>
            </>
          ) : (
            <>
              <Camera className="w-8 h-8 text-ink-300 mb-2" />
              <p className="text-sm font-medium text-ink-900">Take photo</p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                or pick from your gallery
              </p>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        <div>
          <label htmlFor="vendor" className="label">Vendor</label>
          <input
            id="vendor"
            type="text"
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. Puregold"
            className="input"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="total" className="label">Total on receipt (₱)</label>
            <input
              id="total"
              type="text"
              inputMode="decimal"
              value={total}
              onChange={(e) => {
                setTotal(e.target.value.replace(/[^\d.]/g, ""));
                if (error) setError(null);
              }}
              placeholder="0"
              className="input"
            />
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
        </div>

        {error && <p className="text-sm text-clay-500">{error}</p>}

        <button onClick={handleSubmit} className="btn-primary w-full">
          <Upload className="w-4 h-4" /> Save & add line items
        </button>
      </div>

      {/* Unfinished receipts to close */}
      {unfinished.length > 0 && (
        <div className="px-5 pt-8">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Needs reconciling · {unfinished.length}
          </p>
          <p className="text-[11px] text-ink-500 mb-2">
            Receipts where the line items don&rsquo;t add up to the receipt
            total yet.
          </p>
          <div className="space-y-1.5">
            {unfinished.map(({ receipt, recon, linked }) => {
              const capturer = getUserById(receipt.capturedBy);
              const mismatchSign =
                recon.status === "mismatch"
                  ? recon.difference > 0
                    ? "over"
                    : "under"
                  : null;
              return (
                <Link
                  key={receipt.id}
                  href={`/scan/${receipt.id}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded bg-sand-100 flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-4 h-4 text-ink-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-ink-900 truncate">
                        {receipt.vendor} · {peso(receipt.totalTyped)}
                      </p>
                      <p className="text-[11px] text-ink-500 mt-0.5">
                        {relativeDate(receipt.date)} ·{" "}
                        {capturer?.name ?? "—"} · {linked.length} line item
                        {linked.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={
                      "badge " +
                      (mismatchSign ? "badge-amber" : "badge-sand")
                    }
                  >
                    {mismatchSign ? (
                      <>
                        <AlertCircle className="w-3 h-3" /> {mismatchSign} by{" "}
                        {peso(Math.abs(recon.difference))}
                      </>
                    ) : (
                      "Unfinished"
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
