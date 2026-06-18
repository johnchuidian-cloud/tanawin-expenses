/**
 * Receipts pack — a downloadable ZIP that bundles the actual receipt photos
 * together with an accountant-friendly CSV index, so Lexi can hand a whole
 * month's receipts to the bookkeeper in one file.
 *
 * Everything is built in the browser from data already in the store — the
 * receipt photos live in the database as compressed JPEG data URLs (see
 * lib/image.ts), so there's no storage bucket to provision and nothing
 * leaves the app until the user clicks download.
 *
 * Pairs with the Excel export (lib/export.ts): the Excel workbook is the
 * numbers, this pack is the supporting images.
 */

"use client";

import JSZip from "jszip";
import { getEntries, getReceipts, getUserById, loadAllMedia } from "./store";
import { reconciliationStatus } from "./validation";
import { toMonthKey, monthLabel } from "./format";
import type { Entry, Receipt } from "./types";

/**
 * Which receipts to pack. `months` is a list of YYYY-MM keys (one month, a
 * handful, or a whole year's worth); undefined/empty means every receipt ever.
 * `label` is the filename suffix. Mirrors ExportRange in lib/export.ts so the
 * shared RangePicker drives both downloads identically.
 */
export interface PackRange {
  months?: string[];
  label?: string;
}

interface PackResult {
  blob: Blob;
  filename: string;
  /** How many source items (receipts + standalone photo entries) were packed. */
  count: number;
  /** How many image files ended up in the zip. */
  photoCount: number;
}

function userName(id: string | undefined): string {
  if (!id) return "";
  return getUserById(id)?.name ?? "—";
}

/** Split a data URL into its base64 payload + a file extension. */
function dataUrlToParts(dataUrl: string): { base64: string; ext: string } | null {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime === "image/jpeg" ? "jpg" : mime.replace("image/", "");
  return { base64: m[2], ext };
}

/** Filesystem-safe slug for vendor names used in image filenames. */
function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "receipt"
  );
}

/** Quote a CSV field if it contains commas, quotes, or newlines. */
function csvField(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: Array<string | number>): string {
  return fields.map(csvField).join(",");
}

/** True when a date's month is in the selection (empty selection = all). */
function inMonths(dateIso: string, months?: string[]): boolean {
  if (!months || months.length === 0) return true;
  return months.includes(toMonthKey(dateIso));
}

/** Receipts whose date falls in the selection, newest first. */
function receiptsInScope(months?: string[]): Receipt[] {
  return [...getReceipts()]
    .filter((r) => inMonths(r.date, months))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Standalone entries (not tied to a receipt) that carry their own photos. */
function standalonePhotoEntries(months?: string[]): Entry[] {
  return getEntries()
    .filter((e) => !e.receiptId && (e.photoUrls?.length ?? 0) > 0)
    .filter((e) => inMonths(e.date, months))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Load the lazily-fetched photos for a month selection (or all). */
function loadMediaForRange(months?: string[]): Promise<boolean> {
  if (!months || months.length === 0) return loadAllMedia("all");
  return Promise.all(months.map((m) => loadAllMedia(m))).then((rs) => rs.every(Boolean));
}

/** How many receipts (+ standalone photo entries) a selection covers. */
export function countReceiptsInRange(months?: string[]): number {
  return receiptsInScope(months).length + standalonePhotoEntries(months).length;
}

/**
 * Build the receipts pack for a scope. Returns the zip blob plus counts, or
 * null if there's nothing to pack (caller shows an empty-state message).
 */
export async function buildReceiptsPack(range: PackRange): Promise<PackResult | null> {
  const months = range.months;
  // Photos aren't downloaded at app start — pull them for this selection first.
  // This must happen before standalonePhotoEntries(), which detects loose
  // photos by looking at the (lazily loaded) entry media.
  const mediaOk = await loadMediaForRange(months);
  if (!mediaOk) {
    throw new Error("Couldn't download the receipt photos. Check your connection and try again.");
  }

  const receipts = receiptsInScope(months);
  const loose = standalonePhotoEntries(months);
  if (receipts.length === 0 && loose.length === 0) return null;

  const allEntries = getEntries();
  const zip = new JSZip();
  const folder = zip.folder("receipts")!;
  const usedNames = new Set<string>();
  // Pack-wide content dedup: the same photo can be attached to several entries,
  // shared across receipts, or duplicated in an entry's photo list. We write
  // each unique image ONCE and hand back its filename so every receipt/entry
  // that uses it just references the same file — no duplicate copies in the zip.
  const fileByContent = new Map<string, string>();

  // CSV header mirrors the Excel "Receipts" sheet, plus a photo-files column.
  const csv: string[] = [
    csvRow([
      "type",
      "id",
      "date",
      "vendor",
      "items",
      "total",
      "captured/logged by",
      "line items",
      "line item total",
      "reconciliation",
      "difference",
      "photo files",
    ]),
  ];

  let photoCount = 0;

  // Add an image to the zip under a unique, readable name; returns the name.
  // If this exact image content was already added (by any receipt/entry), the
  // existing filename is returned and nothing new is written.
  function addImage(dataUrl: string, date: string, vendor: string, id: string, n: number): string | null {
    const existing = fileByContent.get(dataUrl);
    if (existing) return existing;
    const parts = dataUrlToParts(dataUrl);
    if (!parts) return null;
    const suffix = n > 0 ? `_${n + 1}` : "";
    const base = `${date}_${slug(vendor)}_${id.slice(0, 6)}${suffix}`;
    let name = `${base}.${parts.ext}`;
    let dedupe = 1;
    while (usedNames.has(name)) name = `${base}-${dedupe++}.${parts.ext}`;
    usedNames.add(name);
    folder.file(name, parts.base64, { base64: true });
    fileByContent.set(dataUrl, name);
    photoCount++;
    return name;
  }

  // Receipts: one manifest row each, with their photo(s). A receipt's images
  // are its own photo plus any photos attached to its linked line items.
  for (const r of receipts) {
    const linked = allEntries.filter((e) => e.receiptId === r.id);
    const recon = reconciliationStatus(r.totalTyped, linked.map((e) => e.total));
    const candidates = [r.photoUrl, ...linked.flatMap((e) => e.photoUrls ?? [])]
      .filter((u): u is string => !!u && u.startsWith("data:"));
    const seen = new Set<string>();
    const files: string[] = [];
    for (const url of candidates) {
      if (seen.has(url)) continue;
      seen.add(url);
      const name = addImage(url, r.date, r.vendor, r.id, files.length);
      if (name && !files.includes(name)) files.push(name);
    }
    csv.push(
      csvRow([
        "receipt",
        r.id,
        r.date,
        r.vendor,
        linked.map((e) => e.item).join("; "),
        r.totalTyped,
        userName(r.capturedBy),
        linked.length,
        recon.sum,
        recon.status,
        recon.difference,
        files.join("; ") || "(no photo)",
      ]),
    );
  }

  // Standalone entries with photos but no receipt — still worth handing over.
  for (const e of loose) {
    const files: string[] = [];
    for (const url of (e.photoUrls ?? []).filter((u) => u.startsWith("data:"))) {
      const name = addImage(url, e.date, e.vendor, e.id, files.length);
      if (name && !files.includes(name)) files.push(name);
    }
    csv.push(
      csvRow([
        "entry",
        e.id,
        e.date,
        e.vendor,
        e.item,
        e.total,
        userName(e.loggedBy),
        1,
        e.total,
        "n/a",
        0,
        files.join("; ") || "(no photo)",
      ]),
    );
  }

  const scopeLabel =
    !months || months.length === 0
      ? "All time"
      : months.length === 1
        ? monthLabel(months[0])
        : `${months.length} months`;
  zip.file("index.csv", csv.join("\r\n"));
  zip.file(
    "README.txt",
    [
      `Tanawin Operating Expenses — Receipts pack`,
      `Scope: ${scopeLabel}`,
      `Receipts: ${receipts.length}`,
      loose.length ? `Standalone photo entries: ${loose.length}` : "",
      `Photo files: ${photoCount}`,
      ``,
      `index.csv lists every receipt with its vendor, date, total, line items,`,
      `reconciliation status, and the matching photo file name(s) in the`,
      `receipts/ folder. Pair this with the Excel export for the full ledger.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    filename: `Tanawin-Receipts-${range.label ?? "all-time"}.zip`,
    count: receipts.length + loose.length,
    photoCount,
  };
}

/**
 * Build the pack and trigger a browser download. Returns the result (for a
 * confirmation message) or null if there was nothing to pack.
 */
export async function downloadReceiptsPack(range: PackRange): Promise<PackResult | null> {
  const result = await buildReceiptsPack(range);
  if (!result) return null;

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return result;
}
