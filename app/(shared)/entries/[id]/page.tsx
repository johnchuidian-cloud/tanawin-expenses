"use client";

export const runtime = "edge";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarRange,
  Check,
  History,
  ImageIcon,
  ImagePlus,
  Landmark,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  addNoteToEntry,
  deleteEntry,
  ensureEntryMedia,
  ensureReceiptPhoto,
  getEntriesByReceipt,
  getEntryById,
  getReceiptById,
  getUserById,
  isEntryMediaLoaded,
  isEntryPersonal,
  isReceiptPhotoLoaded,
  resolveFlag,
  setEntryPersonal,
  setEntryPhotos,
  spreadEntryAcrossMonths,
} from "@/lib/store";
import { formatDate, formatDateTime, peso } from "@/lib/format";
import { paidFromBadgeClasses } from "@/lib/payment-meta";
import { fileToCompressedDataUrl } from "@/lib/image";
import { ImageLightbox } from "@/components/ImageLightbox";
import ReplaceReceiptPhotoButton from "@/components/ReplaceReceiptPhotoButton";
import { staffCategoryLabel } from "@/lib/category-meta";
import type { FlagKind } from "@/lib/types";

const FLAG_LABEL: Record<FlagKind, string> = {
  arithmetic: "Arithmetic mismatch",
  duplicate: "Possible duplicate",
  outlier: "Unusual amount",
  "missing-category": "Missing category",
};

export default function StaffEntryDetailPage() {
  useStoreTick();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const me = useCurrentUser();
  const myId = me?.id ?? null;

  const entry = getEntryById(params.id);

  const sortedNotes = useMemo(
    () =>
      entry
        ? [...entry.notes].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        : [],
    [entry],
  );

  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [spreadMonths, setSpreadMonths] = useState(12);
  const [spreadBusy, setSpreadBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Receipt photos are edited locally and committed with a manual Save, so
  // the user can add several / delete then save once. `photos` is the working
  // copy; `photoDirty` tracks unsaved changes.
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const entryPhotos = useMemo(
    () => entry?.photoUrls ?? (entry?.photoUrl ? [entry.photoUrl] : []),
    [entry?.photoUrls, entry?.photoUrl],
  );

  // Photos + edit history aren't downloaded at app start (they're heavy);
  // fetch this entry's media — and its shared receipt's photo — on open.
  const mediaLoaded = entry ? isEntryMediaLoaded(entry.id) : false;
  const receiptPhotoReady = entry?.receiptId
    ? isReceiptPhotoLoaded(entry.receiptId)
    : true;
  useEffect(() => {
    if (!entry) return;
    ensureEntryMedia(entry.id);
    if (entry.receiptId) ensureReceiptPhoto(entry.receiptId);
  }, [entry?.id, entry?.receiptId, entry]);

  // Sync the working copy from the entry whenever it loads or changes from
  // elsewhere — unless there are unsaved local edits we'd stomp on.
  useEffect(() => {
    if (!entry) return;
    if (photoDirty) return;
    setPhotos(entryPhotos);
  }, [entry?.id, entryPhotos, photoDirty, entry]);

  async function handleAddPhoto(file: File) {
    setPhotoBusy(true);
    try {
      const compressed = await fileToCompressedDataUrl(file);
      setPhotos((prev) => [...prev, compressed]);
      setPhotoDirty(true);
    } catch {
      window.alert("Couldn't read that image. Try another photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleDeletePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoDirty(true);
  }

  function handleSavePhotos() {
    if (!entry || !myId) return;
    const before = entryPhotos.length;
    const after = photos.length;
    let summary: string;
    if (after > before) {
      summary = `Added ${after - before} receipt photo${after - before === 1 ? "" : "s"} (now ${after})`;
    } else if (after < before) {
      summary = `Removed ${before - after} receipt photo${before - after === 1 ? "" : "s"} (now ${after})`;
    } else {
      summary = `Updated receipt photos (${after})`;
    }
    setEntryPhotos(entry.id, photos, {
      at: new Date().toISOString(),
      by: myId,
      summary,
    });
    setPhotoDirty(false);
  }

  function handleDiscardPhotos() {
    setPhotos(entryPhotos);
    setPhotoDirty(false);
  }

  if (!entry) {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center">
        <p className="text-sm text-ink-700">Entry not found.</p>
        <p className="text-xs text-ink-500 mt-1">
          It may have been deleted, or the link is stale.
        </p>
        <Link href="/entries" className="btn btn-sm mt-4">
          Back to entries
        </Link>
      </div>
    );
  }

  const logger = getUserById(entry.loggedBy);
  const openFlags = entry.flags.filter((f) => !f.resolved);
  const resolvedFlags = entry.flags.filter((f) => f.resolved);
  // Admins can edit any entry; staff can edit the ones they logged.
  const canEdit = me?.role === "admin" || me?.id === entry.loggedBy;
  // Admins can clear/push-back flags right here (same actions as the review
  // queue), so they don't have to bounce back to /review.
  const canReview = me?.role === "admin" && openFlags.length > 0;
  // View-only guests see everything except internal notes, and get no
  // write affordances (photos, items, replies).
  const isGuest = me?.role === "guest";
  // When this entry is one line item of a multi-item receipt, the photo lives
  // on the shared receipt (stored once) rather than on the entry itself.
  const receipt = entry.receiptId ? getReceiptById(entry.receiptId) : undefined;
  const receiptItemCount = entry.receiptId ? getEntriesByReceipt(entry.receiptId).length : 0;
  const personal = isEntryPersonal(entry.id);
  // Personal can only be toggled on a line item that's on a receipt (the flag
  // is stored there). Standalone entries don't qualify.
  const canTogglePersonal = canEdit && !!entry.receiptId;
  // Spread: for one-time costs valid over a period (annual compliance etc.).
  // Hidden when the entry is already a part of a spread ("(2/12)" suffix).
  const alreadySpread = /\(\d+\/\d+\)\s*$/.test(entry.item);
  const canSpread = canEdit && !alreadySpread && entry.total > 0;

  async function handleSpread() {
    if (!entry || !me || spreadBusy) return;
    setSpreadBusy(true);
    setError(null);
    const res = await spreadEntryAcrossMonths(entry.id, spreadMonths, me.id);
    setSpreadBusy(false);
    if (!res.ok) {
      setError(res.reason ?? "Couldn't spread this expense.");
      return;
    }
    setSpreadOpen(false);
  }

  async function handleTogglePersonal() {
    if (!entry || !me || personalBusy) return;
    setPersonalBusy(true);
    const res = await setEntryPersonal(entry.id, !personal, me.id);
    setPersonalBusy(false);
    if (!res.ok) setError(res.reason ?? "Couldn't update — try again.");
  }

  async function handleRemove() {
    if (!entry || !me || removing) return;
    const onReceipt = !!entry.receiptId;
    const ok = window.confirm(
      onReceipt
        ? `Remove "${entry.item}" from this receipt?\n\nIt's deleted from the books — the receipt reconciliation and the PCF balance adjust, and the removal is recorded on the receipt. You can undo right after.`
        : `Delete "${entry.item}"?\n\nIt's removed from the books and the PCF balance adjusts. You can undo right after.`,
    );
    if (!ok) return;
    setRemoving(true);
    const res = await deleteEntry(entry.id, me.id);
    if (!res.ok) {
      setRemoving(false);
      setError(res.reason ?? "Couldn't remove this item.");
      return;
    }
    router.replace(onReceipt ? `/gallery/${entry.receiptId}` : "/entries");
  }

  function handleSendReply() {
    if (!myId || !entry) return;
    const trimmed = reply.trim();
    if (trimmed.length === 0) {
      setError("Type a reply before sending.");
      return;
    }
    addNoteToEntry(entry.id, { authorId: myId, body: trimmed, kind: "comment" });
    setReply("");
    setError(null);
  }

  // Review actions — mirror the /review queue card. "Mark OK" clears all open
  // flags (note optional); "Do not approve" records a pushback note and leaves
  // the flag open so the entry stays in the queue. Both use the note box below.
  function handleMarkOk() {
    if (!myId || !entry) return;
    const trimmed = reply.trim();
    if (trimmed.length > 0) {
      addNoteToEntry(entry.id, { authorId: myId, body: trimmed, kind: "comment" });
    }
    for (const flag of openFlags) {
      resolveFlag(entry.id, flag.kind, myId);
    }
    setReply("");
    setError(null);
  }

  function handleDoNotApprove() {
    if (!myId || !entry) return;
    const trimmed = reply.trim();
    if (trimmed.length === 0) {
      setError("Add a note explaining why before you push back.");
      return;
    }
    addNoteToEntry(entry.id, { authorId: myId, body: trimmed, kind: "pushback" });
    setReply("");
    setError(null);
  }

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
        <p className="text-base font-medium text-ink-900 flex-1">Entry</p>
        {canEdit && (
          <Link
            href={`/entries/${entry.id}/edit`}
            className="btn btn-sm bg-white border-sand-200 text-ink-700"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
        )}
      </div>

      {/* Entry summary */}
      <div className="px-5 pt-4">
        <div className="rounded-lg bg-white border border-sand-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-medium text-ink-900">
                {entry.vendor}
              </p>
              <p className="text-sm text-ink-700 mt-0.5">{entry.item}</p>
              <p className="text-[11px] text-ink-500 mt-1">
                {formatDate(entry.date, { withYear: true })} · {staffCategoryLabel(entry.category)}
                {entry.majorRepair && (
                  <span className="ml-1.5 badge badge-amber">
                    <Wrench className="w-3 h-3" /> Major repair
                  </span>
                )}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xl font-medium text-ink-900">
                {peso(entry.total)}
              </p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                {entry.qty} × {peso(entry.unitPrice, { cents: true })}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-sand-100 flex items-center justify-between gap-2">
            <p className="text-[11px] text-ink-500">
              Logged by {logger?.name ?? "—"} · {formatDateTime(entry.createdAt)}
            </p>
            {personal ? (
              <span
                className="badge bg-amber-100 text-amber-800"
                title="Personal purchase — on the receipt, but not deducted from PCF"
              >
                <Wallet className="w-3 h-3" /> Personal
              </span>
            ) : entry.paidFrom === "other" ? (
              <span
                className={"badge " + paidFromBadgeClasses("other")}
                title="Paid from another fund — doesn't affect PCF"
              >
                <Landmark className="w-3 h-3" /> Other fund
              </span>
            ) : (
              <span
                className={"badge " + paidFromBadgeClasses("pcf")}
                title="Drawn from pooled petty cash"
              >
                <Wallet className="w-3 h-3" /> PCF
              </span>
            )}
          </div>
        </div>

        {/* Personal-purchase toggle — keeps the item on the receipt but out of
            the PCF balance. */}
        {canTogglePersonal && (
          <label className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-white border border-sand-200 cursor-pointer">
            <input
              type="checkbox"
              checked={personal}
              disabled={personalBusy}
              onChange={handleTogglePersonal}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="text-sm text-ink-900">Personal purchase</p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                Stays on the receipt, but this amount isn&rsquo;t deducted from the petty cash balance.
              </p>
            </div>
          </label>
        )}

        {/* Spread a one-time cost (annual permit, compliance fee…) across
            consecutive months so each month's reports carry its share. */}
        {canSpread && !spreadOpen && (
          <button
            onClick={() => setSpreadOpen(true)}
            className="mt-2 w-full flex items-start gap-2 p-2.5 rounded-lg bg-white border border-sand-200 hover:bg-sand-50 text-left"
          >
            <CalendarRange className="w-4 h-4 text-ink-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-ink-900">Spread across months</p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                For costs paid once but valid over a period — divides {peso(entry.total)} into
                monthly parts so each month&rsquo;s reports carry its share.
              </p>
            </div>
          </button>
        )}
        {canSpread && spreadOpen && (
          <div className="mt-2 p-3 rounded-lg bg-white border border-leaf-200 space-y-2">
            <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
              <CalendarRange className="w-4 h-4 text-leaf-600" /> Spread across months
            </p>
            <div>
              <label htmlFor="spreadMonths" className="label">How many months?</label>
              <select
                id="spreadMonths"
                value={spreadMonths}
                onChange={(e) => setSpreadMonths(Number(e.target.value))}
                className="input h-10"
                disabled={spreadBusy}
              >
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n} months{n === 12 ? " (a full year)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-ink-500">
              {peso(Math.round((entry.total / spreadMonths) * 100) / 100, { cents: true })} per month ×{" "}
              {spreadMonths}, starting {formatDate(entry.date, { withYear: true })}. The petty cash
              balance and the receipt total don&rsquo;t change — only how the cost lands on each
              month&rsquo;s reports. You can undo right after.
            </p>
            {error && <p className="text-xs text-clay-500">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setSpreadOpen(false); setError(null); }}
                className="btn btn-sm flex-1"
                disabled={spreadBusy}
              >
                Cancel
              </button>
              <button
                onClick={handleSpread}
                disabled={spreadBusy}
                className="btn-primary flex-1 h-9 text-sm disabled:opacity-60"
              >
                {spreadBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CalendarRange className="w-4 h-4" />
                )}
                Spread over {spreadMonths} months
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Part of a multi-item receipt: the photo lives on the shared receipt
          (stored once), shown read-only here. */}
      {entry.receiptId && receipt && (
        <div className="px-5 pt-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-ink-500" /> Receipt
              {receiptItemCount > 1 && (
                <span className="text-ink-500 font-normal">· {receiptItemCount} items</span>
              )}
            </p>
            {me?.role === "admin" && (
              <Link
                href={`/gallery/${entry.receiptId}`}
                className="text-[11px] text-leaf-600"
              >
                Receipt tools ↗
              </Link>
            )}
          </div>
          {!receiptPhotoReady ? (
            <div className="rounded-lg border border-sand-200 bg-sand-50 h-32 flex items-center justify-center gap-2 text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <p className="text-xs">Loading photo…</p>
            </div>
          ) : receipt.photoUrl ? (
            <button
              type="button"
              onClick={() => setLightbox(receipt.photoUrl)}
              className="block w-full rounded-lg border border-sand-200 bg-sand-50 overflow-hidden"
              aria-label="View receipt full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receipt.photoUrl}
                alt={`Receipt for ${entry.vendor}`}
                className="w-full max-h-96 object-contain"
              />
            </button>
          ) : (
            <p className="text-xs text-ink-500">No photo on this receipt.</p>
          )}
          <p className="text-[11px] text-ink-500 mt-1">
            One of {receiptItemCount} item{receiptItemCount === 1 ? "" : "s"} logged on this receipt.
            {!!receipt.vatAmount && (
              <span> · includes {peso(receipt.vatAmount, { cents: true })} VAT</span>
            )}
          </p>
          {!isGuest && (
            <>
              <Link
                href={`/new?receiptId=${entry.receiptId}`}
                className="btn btn-sm w-full mt-2 text-ink-700"
              >
                <Plus className="w-3.5 h-3.5" /> Add another item to this receipt
              </Link>
              {receiptPhotoReady && (
                <div className="mt-2">
                  <ReplaceReceiptPhotoButton
                    receiptId={entry.receiptId}
                    hasPhoto={!!receipt.photoUrl}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Standalone entry (no shared receipt): manage its own photos —
          add, delete, then Save. The manager stays hidden until this entry's
          media has loaded: editing against a not-yet-loaded photo list could
          save over photos the user never saw. */}
      {!entry.receiptId && !mediaLoaded && (
        <div className="px-5 pt-4">
          <p className="text-sm font-medium text-ink-900 mb-2 flex items-center gap-1.5">
            <ImageIcon className="w-4 h-4 text-ink-500" /> Receipts
          </p>
          <div className="rounded-lg border border-sand-200 bg-sand-50 h-24 flex items-center justify-center gap-2 text-ink-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <p className="text-xs">Loading photos…</p>
          </div>
        </div>
      )}
      {!entry.receiptId && mediaLoaded && (
      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-ink-900 mb-2 flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 text-ink-500" /> Receipts
          {photos.length > 0 && (
            <span className="text-ink-500 font-normal">· {photos.length}</span>
          )}
        </p>

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((src, idx) => (
              <div
                key={idx}
                className="relative group rounded-lg border border-sand-200 bg-sand-50 overflow-hidden aspect-square"
              >
                <button
                  type="button"
                  onClick={() => setLightbox(src)}
                  className="block w-full h-full"
                  aria-label={`View receipt ${idx + 1} full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Receipt ${idx + 1} for ${entry.vendor}`}
                    className="w-full h-full object-cover"
                  />
                </button>
                {!isGuest && (
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(idx)}
                    aria-label={`Delete receipt ${idx + 1}`}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-sand-200 flex items-center justify-center hover:bg-clay-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-clay-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add button — full-width when empty, compact row when there are photos */}
        {!isGuest && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={photoBusy}
          className={
            photos.length > 0
              ? "mt-2 w-full rounded-lg border border-dashed border-sand-200 bg-sand-50 hover:bg-sand-100 transition-colors flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-ink-700 disabled:opacity-60"
              : "w-full rounded-lg border-2 border-dashed border-sand-200 bg-sand-50 hover:bg-sand-100 transition-colors flex flex-col items-center justify-center text-center p-5 disabled:opacity-60"
          }
        >
          <ImagePlus className={photos.length > 0 ? "w-4 h-4" : "w-7 h-7 text-ink-300 mb-1.5"} />
          {photos.length > 0 ? (
            <span>{photoBusy ? "Processing…" : "Add another receipt"}</span>
          ) : (
            <>
              <span className="text-sm font-medium text-ink-900">
                {photoBusy ? "Processing photo…" : "Add receipt photo"}
              </span>
              <span className="text-[11px] text-ink-500 mt-0.5">
                Upload from your gallery or take one now
              </span>
            </>
          )}
        </button>
        )}

        {/* Manual save / discard — only when there are unsaved changes */}
        {photoDirty && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSavePhotos}
              className="btn-primary flex-1 h-9 text-sm"
            >
              <Save className="w-4 h-4" /> Save receipts
            </button>
            <button
              type="button"
              onClick={handleDiscardPhotos}
              className="btn h-9 text-sm"
            >
              <X className="w-4 h-4" /> Discard
            </button>
          </div>
        )}
        {photoDirty && (
          <p className="text-[11px] text-clay-500 mt-1">Unsaved changes — tap Save receipts to keep them.</p>
        )}

        {/* No `capture` attribute → phones show the full picker (gallery,
            camera, files) instead of jumping straight to the camera. */}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAddPhoto(file);
            e.target.value = "";
          }}
        />
      </div>
      )}

      {/* Flags */}
      {openFlags.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Open flags · {openFlags.length}
          </p>
          <div className="space-y-2">
            {openFlags.map((flag) => (
              <div
                key={flag.kind}
                className="rounded-lg bg-clay-50 border border-clay-200 p-3 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-clay-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-clay-500">
                    {FLAG_LABEL[flag.kind]}
                  </p>
                  <p className="text-xs text-ink-700 mt-0.5">{flag.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedFlags.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-sm font-medium text-ink-900 mb-2">
            Resolved · {resolvedFlags.length}
          </p>
          <div className="space-y-2">
            {resolvedFlags.map((flag) => {
              const resolver = flag.resolvedBy ? getUserById(flag.resolvedBy) : null;
              return (
                <div
                  key={flag.kind}
                  className="rounded-lg bg-leaf-50/60 border border-leaf-100 p-3 flex items-start gap-2"
                >
                  <Check className="w-4 h-4 text-leaf-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-leaf-600">
                      {FLAG_LABEL[flag.kind]}
                    </p>
                    <p className="text-xs text-ink-700 mt-0.5">{flag.message}</p>
                    {resolver && (
                      <p className="text-[10px] text-ink-500 mt-1">
                        Cleared by {resolver.name}
                        {flag.resolvedAt && ` · ${formatDateTime(flag.resolvedAt)}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit history — appended whenever fields or receipts are changed */}
      {entry.history && entry.history.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-sm font-medium text-ink-900 mb-2 flex items-center gap-1.5">
            <History className="w-4 h-4 text-ink-500" /> Edit history ·{" "}
            {entry.history.length}
          </p>
          <div className="rounded-lg border border-sand-200 bg-white divide-y divide-sand-100">
            {[...entry.history]
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .map((rec, i) => {
                const editor = getUserById(rec.by);
                return (
                  <div key={i} className="px-3 py-2">
                    <p className="text-xs text-ink-900">{rec.summary}</p>
                    <p className="text-[10px] text-ink-500 mt-0.5">
                      {editor?.name ?? "—"} · {formatDateTime(rec.at)}
                    </p>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Notes thread — internal team conversation, hidden from view-only
          guests (accountants/family don't need staff back-and-forth). */}
      {!isGuest && (
      <>
      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Conversation{sortedNotes.length > 0 ? ` · ${sortedNotes.length}` : ""}
        </p>
        {sortedNotes.length === 0 ? (
          <p className="text-xs text-ink-500">
            No notes yet. Start the thread below.
          </p>
        ) : (
          <div className="space-y-2 p-3 rounded-lg bg-sand-50/60 border border-sand-200">
            {sortedNotes.map((note) => {
              const author = getUserById(note.authorId);
              const mine = note.authorId === myId;
              const isPushback = note.kind === "pushback";
              return (
                <div
                  key={note.id}
                  className={"flex " + (mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={
                      "max-w-[85%] rounded-lg px-3 py-2 " +
                      (isPushback
                        ? "bg-clay-50 border border-clay-200"
                        : mine
                          ? "bg-leaf-50 border border-leaf-100"
                          : "bg-white border border-sand-200")
                    }
                  >
                    {isPushback && (
                      <p className="text-[10px] font-medium text-clay-500 uppercase tracking-wide mb-0.5">
                        Did not approve
                      </p>
                    )}
                    <p className="text-xs text-ink-900 break-words whitespace-pre-wrap">
                      {note.body}
                    </p>
                    <p className="text-[10px] text-ink-500 mt-1">
                      {mine ? "You" : author?.name ?? "—"} ·{" "}
                      {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply */}
      <div className="px-5 pt-4">
        <label htmlFor="reply" className="text-[11px] text-ink-500 flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />{" "}
          {canReview ? "Add a note (optional to mark OK, required to not approve)" : "Add a note"}
        </label>
        <textarea
          id="reply"
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            if (error) setError(null);
          }}
          rows={2}
          placeholder="Type your note…"
          className="w-full mt-1 px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
        />
        {error && <p className="text-xs text-clay-500 mt-1">{error}</p>}

        {/* Review actions — shown for admins when the entry still has open
            flags, so Lexi can clear or push back without returning to /review. */}
        {canReview && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleMarkOk}
              className="btn btn-sm flex-1 bg-leaf-500 text-white border-leaf-500"
              aria-label="Mark all flags on this entry as resolved"
            >
              <Check className="w-3.5 h-3.5" /> Mark OK
            </button>
            <button
              onClick={handleDoNotApprove}
              className="btn btn-sm flex-1 bg-white border-clay-200 text-clay-500"
              aria-label="Push back on this entry with a note"
            >
              <X className="w-3.5 h-3.5" /> Do not approve
            </button>
          </div>
        )}

        <button
          onClick={handleSendReply}
          className={
            "btn btn-sm w-full mt-2 " +
            (canReview
              ? "bg-white border-sand-200 text-ink-700"
              : "bg-leaf-500 text-white border-leaf-500")
          }
        >
          <Send className="w-3.5 h-3.5" /> Send note
        </button>
      </div>
      </>
      )}

      {/* Admin-only: remove this item right where Lexi lands when she taps it
          (the receipt page also has it). Reversible via the Undo bar. */}
      {me?.role === "admin" && (
        <div className="px-5 pt-6">
          <button
            onClick={handleRemove}
            disabled={removing}
            className="btn-danger-ghost w-full disabled:opacity-60"
          >
            {removing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {entry.receiptId ? "Remove this item from the receipt" : "Delete this entry"}
          </button>
          <p className="text-[11px] text-ink-500 mt-1.5 text-center">
            {entry.receiptId
              ? "Adjusts the receipt total and PCF balance. You can undo right after."
              : "Removes it from the books and adjusts the PCF balance. You can undo right after."}
          </p>
          {error && <p className="text-xs text-clay-500 mt-1 text-center">{error}</p>}
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox}
          alt={`Receipt for ${entry.vendor}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
