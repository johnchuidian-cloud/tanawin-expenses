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
import {
  ensureEntryMedia,
  getEntries,
  getReceipts,
  getUserById,
  loadAllMedia,
  releaseMediaScope,
} from "./store";
import { reconciliationStatus } from "./validation";
import { monthLabel } from "./format";
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
  return months.includes(packMonthKey(dateIso));
}

/**
 * Month of a stored date, read literally off the string.
 *
 * NOT format.ts's toMonthKey, which does `new Date(str)` and then reads the
 * month in the *viewer's* timezone: west of UTC that turns a `2026-06-01` row
 * into "2026-05". loadAllMedia fetches a month with a SQL `date >= 'YYYY-MM-01'
 * AND date <= 'YYYY-MM-31'` range — a literal string comparison — so a
 * timezone-shifted key here would look for a row in a month whose photos were
 * never fetched, and quietly leave its image out of the archive. The two must
 * agree, and the literal reading is the one that matches the database.
 */
function packMonthKey(dateIso: string): string {
  return (dateIso ?? "").slice(0, 7);
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

/**
 * Every month that has a receipt or a standalone receipt photo, oldest first.
 * Used to turn an "all time" request into a month-at-a-time walk.
 */
function allMonthsWithMedia(): string[] {
  const set = new Set<string>();
  // packMonthKey throughout: these keys are handed straight to loadAllMedia,
  // whose SQL range is a literal string comparison. See packMonthKey.
  for (const r of getReceipts()) set.add(packMonthKey(r.date));
  for (const e of getEntries()) {
    // Standalone photos can't be detected before media loads, so include every
    // receiptless entry's month; a month with nothing in it just yields nothing.
    if (!e.receiptId) set.add(packMonthKey(e.date));
  }
  return Array.from(set).sort();
}

/**
 * Above this many months in one request, photos are loaded and released a month
 * at a time instead of all at once. See the SCALE note on buildReceiptsPack.
 */
const CHUNK_ABOVE_MONTHS = 2;

/**
 * Ceiling on the base64 bytes a single pack may accumulate (~90 MB of images).
 * The zip is assembled in memory and handed to the browser as one blob, so it
 * has to fit — on a phone, comfortably. Past this we stop with an instruction
 * instead of letting the tab die: a crashed download is indistinguishable from
 * a broken app to the person doing it.
 */
const MAX_PACK_BYTES = 120 * 1024 * 1024;

/** How many receipts (+ standalone photo entries) a selection covers. */
export function countReceiptsInRange(months?: string[]): number {
  return receiptsInScope(months).length + standalonePhotoEntries(months).length;
}

/**
 * Build the receipts pack for a scope. Returns the zip blob plus counts, or
 * null if there's nothing to pack (caller shows an empty-state message).
 *
 * SCALE — how this walks the data. A single-month pack loads that month's
 * photos and builds the zip in one pass, as before. A wider selection ("All
 * time", a year) walks MONTH AT A TIME, releasing each month's photo bytes
 * before loading the next, because holding them all was the failure mode:
 * measured at today's 868 media rows, the one-pass version peaked at ~360 MB
 * RSS and took ~52 s, and the archive grows ~28 MB per month. Phones do not
 * survive that at a year's worth, and they fail by dying rather than erroring.
 *
 * The zip itself still accumulates, so there is a hard ceiling too — see
 * MAX_PACK_BYTES. Better a clear "pick fewer months" than a crashed tab.
 */
export async function buildReceiptsPack(range: PackRange): Promise<PackResult | null> {
  const months = range.months;
  const wide = !months || months.length > CHUNK_ABOVE_MONTHS;

  // Month-at-a-time for wide selections; one pass otherwise. `undefined` chunk
  // means "the whole selection at once".
  const chunks: (string | undefined)[] = wide
    ? (months && months.length > 0 ? [...months].sort() : allMonthsWithMedia())
    : [undefined];

  const zip = new JSZip();
  const folder = zip.folder("receipts")!;
  const usedNames = new Set<string>();
  // Content dedup: the same photo can be attached to several entries, shared
  // across receipts, or duplicated in an entry's photo list. We write each
  // unique image ONCE and hand back its filename so every receipt/entry that
  // uses it just references the same file — no duplicate copies in the zip.
  //
  // Scoped to the current chunk, not the whole pack: the keys ARE the base64
  // strings, so a pack-wide map would pin every photo in memory and undo the
  // month-at-a-time release below. Duplicates only ever occur between a receipt
  // and its own line items, which share a date and so a chunk — the 34
  // duplicate copies measured in the live data are all of that shape.
  let fileByContent = new Map<string, string>();

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
  let receiptCount = 0;
  let looseCount = 0;
  let bytesAdded = 0;

  // Add an image to the zip under a unique, readable name; returns the name.
  // If this exact image content was already added in this chunk, the existing
  // filename is returned and nothing new is written.
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
    bytesAdded += parts.base64.length;
    photoCount++;
    return name;
  }

  for (const chunk of chunks) {
    const scope = chunk ? [chunk] : months;

    // Photos aren't downloaded at app start — pull them for this slice first.
    // Must happen before standalonePhotoEntries(), which detects loose photos
    // by looking at the (lazily loaded) entry media.
    const mediaOk = chunk ? await loadAllMedia(chunk) : await loadMediaForRange(scope);
    if (!mediaOk) {
      throw new Error("Couldn't download the receipt photos. Check your connection and try again.");
    }

    const receipts = receiptsInScope(scope);

    // A receipt's line items are NOT always dated in the receipt's month —
    // "spread across months" deliberately moves them, and bulk-correct can too
    // (52 of 709 linked entries in the live data). Their photos are therefore
    // outside this chunk's bulk load, and without this they'd be silently
    // missing from the archive. Rare enough to fetch individually.
    //
    // Must happen BEFORE the index below: ensureEntryMedia replaces entry
    // objects rather than mutating them, so an index built first would hold
    // the pre-fetch copies with empty photoUrls.
    if (chunk) {
      const inScopeReceiptIds = new Set(receipts.map((r) => r.id));
      const strays = getEntries()
        .filter((e) => e.receiptId && inScopeReceiptIds.has(e.receiptId) && !inMonths(e.date, scope))
        .map((e) => e.id);
      if (strays.length > 0) {
        await Promise.all(strays.map((id) => ensureEntryMedia(id)));
      }
    }

    const loose = standalonePhotoEntries(scope);

    // Index line items by receipt once per chunk. Scanning every entry for
    // every receipt is O(receipts x entries) — invisible at 194 receipts,
    // ~50M comparisons at a few years' worth.
    const linkedByReceipt = new Map<string, Entry[]>();
    for (const e of getEntries()) {
      if (!e.receiptId) continue;
      const list = linkedByReceipt.get(e.receiptId);
      if (list) list.push(e);
      else linkedByReceipt.set(e.receiptId, [e]);
    }

    // Receipts: one manifest row each, with their photo(s). A receipt's images
    // are its own photo plus any photos attached to its linked line items.
    for (const r of receipts) {
      const linked = linkedByReceipt.get(r.id) ?? [];
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
    receiptCount += receipts.length;

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
    looseCount += loose.length;

    if (bytesAdded > MAX_PACK_BYTES) {
      throw new Error(
        `That's too many receipts for one download (${Math.round(bytesAdded / 1048576)} MB so far). ` +
          `Please pick a shorter period — a month or two at a time works well.`,
      );
    }

    // Free this month's photos before pulling the next one. Skipped for the
    // single-pass case so a normal one-month download leaves the gallery's
    // cache warm.
    if (chunk) {
      releaseMediaScope(chunk);
      fileByContent = new Map();
    }
  }

  if (receiptCount === 0 && looseCount === 0) return null;

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
      `Receipts: ${receiptCount}`,
      looseCount ? `Standalone photo entries: ${looseCount}` : "",
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
    count: receiptCount + looseCount,
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
