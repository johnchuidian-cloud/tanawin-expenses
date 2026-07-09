"use client";

import { supabase } from "./supabase";
import { reconciliationStatus } from "./validation";
import { BUILTIN_CATEGORIES } from "./types";
import type {
  AuditRecord,
  Category,
  CategoryDef,
  Entry,
  Note,
  PcfAdjustment,
  PcfLedgerEntry,
  Receipt,
  SavedVendor,
  User,
  VendorRegistry,
  VendorSuggestion,
} from "./types";

// ---------- IN-MEMORY STATE ----------
// Synchronous reads always come from here. bootstrapFromSupabase() populates
// these once on app init; mutations update both local state and Supabase.

let entries: Entry[] = [];
let receipts: Receipt[] = [];
let pcfLedger: PcfLedgerEntry[] = [];
let users: User[] = [];

// ---------- BOOTSTRAP ----------

let _bootstrapped = false;
let _bootstrapping = false;
let _bootstrapFailed = false;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _retryDelay = 3000;

/**
 * Photos are deliberately NOT downloaded at bootstrap. Receipt photos are
 * stored as base64 data URLs inside `receipts.photo_url` and the packed
 * `entries.photo_url` media blob, which adds up to tens of MB — downloading
 * them all before the login screen can show four names made the app look
 * broken on slow connections. So bootstrap/refresh select every column
 * EXCEPT photo_url, and photos load on demand (ensureEntryMedia /
 * ensureReceiptPhoto / loadAllMedia) on the pages that actually show them.
 */
const RECEIPT_COLS = "id,vendor,date,ocr_text,total_typed,captured_by,status";
const ENTRY_COLS =
  "id,date,vendor,item,qty,unit_price,total,category,paid_from,major_repair,receipt_id,logged_by,created_at,flags,notes";

/**
 * True once bootstrapFromSupabase has populated the in-memory state.
 * Auth code uses this to distinguish "session present, data not yet loaded"
 * from "session present, user really doesn't exist" — only the second
 * case should bounce the user to the login screen.
 */
export function isBootstrapComplete(): boolean {
  return _bootstrapped;
}

export type BootstrapStatus = "loading" | "ready" | "error";

/** What the login screen shows: spinner (loading), users (ready), retry (error). */
export function getBootstrapStatus(): BootstrapStatus {
  if (_bootstrapped) return "ready";
  return _bootstrapFailed ? "error" : "loading";
}

/** Manual retry from the UI — clears any scheduled auto-retry and goes now. */
export function retryBootstrap(): void {
  if (_bootstrapped || _bootstrapping) return;
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  _bootstrapFailed = false;
  notify();
  bootstrapFromSupabase();
}

/**
 * After a failed bootstrap, mark the error (so the login screen can say so)
 * and schedule an automatic retry with backoff. Previously a failure was
 * only logged to the console and never retried — on flaky Wi-Fi the user
 * list just stayed empty until a full page reload.
 */
function scheduleBootstrapRetry(): void {
  _bootstrapFailed = true;
  notify();
  if (typeof window === "undefined" || _retryTimer) return;
  const delay = _retryDelay;
  _retryDelay = Math.min(_retryDelay * 2, 30_000);
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    _bootstrapFailed = false;
    notify();
    bootstrapFromSupabase();
  }, delay);
}

// Retry immediately when the device comes back online.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (!_bootstrapped) retryBootstrap();
  });
}

/**
 * Hierarchical user order everywhere users are listed (login screen,
 * Manage staff, reports): admin pinned on top, staff below, view-only
 * guests last, each group alphabetical.
 */
const ROLE_RANK: Record<User["role"], number> = { admin: 0, staff: 1, guest: 2 };
function sortUsers(list: User[]): User[] {
  return [...list].sort((a, b) => {
    if (a.role !== b.role) return ROLE_RANK[a.role] - ROLE_RANK[b.role];
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fetch EVERY row from a query, paging past PostgREST's default 1000-row cap.
 * Without this, large tables (entries) silently truncate at 1000 rows — which
 * made all-time totals like the PCF balance read wrong once entries crossed
 * 1000 (the oldest rows dropped, their drawdowns never subtracted).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectAllRows(
  build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>,
): Promise<{ data: Record<string, unknown>[] | null; error: unknown }> {
  const pageSize = 1000;
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}

export async function bootstrapFromSupabase(): Promise<void> {
  if (_bootstrapped || _bootstrapping) return;
  _bootstrapping = true;

  try {
    const [usersRes, receiptsRes, entriesRes, pcfRes, catRes, vendorRes] = await Promise.all([
      supabase.from("users").select("*"),
      selectAllRows((f, t) => supabase.from("receipts").select(RECEIPT_COLS).range(f, t)),
      selectAllRows((f, t) =>
        supabase.from("entries").select(ENTRY_COLS).order("created_at", { ascending: false }).range(f, t),
      ),
      selectAllRows((f, t) =>
        supabase.from("pcf_ledger").select("*").order("created_at", { ascending: false }).range(f, t),
      ),
      supabase.from("category_defs").select("*").eq("builtin", false),
      supabase.from("category_defs").select("id,icon_key").in("id", [VENDOR_ROW_ID, CATEGORY_ALIAS_ROW_ID, PCF_ADJ_ROW_ID]),
    ]);

    if (usersRes.error || receiptsRes.error || entriesRes.error || pcfRes.error || catRes.error) {
      console.error("supabase: bootstrap failed", { usersRes, receiptsRes, entriesRes, pcfRes, catRes });
      scheduleBootstrapRetry();
      return;
    }

    users = sortUsers(usersRes.data!.map(mapUser));
    receipts = receiptsRes.data!.map(mapReceipt);
    entries = entriesRes.data!.map(mapEntry);
    pcfLedger = pcfRes.data!.map(mapPcfLedger);
    // Registries are non-fatal: a hiccup here shouldn't block the app.
    applyRegistryRows(vendorRes?.error ? [] : vendorRes?.data);

    if (catRes.data!.length > 0) {
      const customDefs = catRes.data!.map(mapCategoryDef);
      categoryDefs = [...BUILTIN_DEFS, ...customDefs].map((def) => {
        const overrides = _hintOverrides[def.id];
        return overrides?.length ? { ...def, extraHints: overrides } : def;
      });
    }

    _bootstrapped = true;
    _bootstrapFailed = false;
    _retryDelay = 3000;
    notify();
    // Let useCurrentUser re-check session against the now-populated users array
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("tanawin:auth"));
    }
  } catch (err) {
    // A network-level failure (offline, DNS, timeout) makes fetch reject —
    // previously this escaped the function and left _bootstrapping stuck
    // true, so nothing could ever retry. Catch it and schedule a retry.
    console.error("supabase: bootstrap threw", err);
    scheduleBootstrapRetry();
  } finally {
    _bootstrapping = false;
  }
}

/**
 * Pull fresh data from Supabase without the once-only guard.
 *
 * Called whenever the user switches back to the tab (visibilitychange) or
 * the window regains focus, so anyone looking at the app sees what their
 * teammates have changed without needing to hard-refresh. Skips its own
 * concurrent runs and refuses to run before the initial bootstrap has
 * completed (otherwise it would race the bootstrap and write users twice).
 */
let _refreshing = false;
export async function refreshFromSupabase(): Promise<void> {
  if (!_bootstrapped || _refreshing) return;
  _refreshing = true;
  try {
    const [usersRes, receiptsRes, entriesRes, pcfRes, catRes, vendorRes] = await Promise.all([
      supabase.from("users").select("*"),
      selectAllRows((f, t) => supabase.from("receipts").select(RECEIPT_COLS).range(f, t)),
      selectAllRows((f, t) =>
        supabase.from("entries").select(ENTRY_COLS).order("created_at", { ascending: false }).range(f, t),
      ),
      selectAllRows((f, t) =>
        supabase.from("pcf_ledger").select("*").order("created_at", { ascending: false }).range(f, t),
      ),
      supabase.from("category_defs").select("*").eq("builtin", false),
      supabase.from("category_defs").select("id,icon_key").in("id", [VENDOR_ROW_ID, CATEGORY_ALIAS_ROW_ID, PCF_ADJ_ROW_ID]),
    ]);
    if (
      usersRes.error || receiptsRes.error || entriesRes.error ||
      pcfRes.error || catRes.error
    ) {
      console.error("supabase: refresh failed", {
        usersRes, receiptsRes, entriesRes, pcfRes, catRes,
      });
      return;
    }
    users = sortUsers(usersRes.data!.map(mapUser));
    receipts = receiptsRes.data!.map(mapReceipt);
    entries = entriesRes.data!.map(mapEntry);
    pcfLedger = pcfRes.data!.map(mapPcfLedger);
    applyRegistryRows(vendorRes?.error ? [] : vendorRes?.data);
    const customDefs = catRes.data!.map(mapCategoryDef);
    categoryDefs = [...BUILTIN_DEFS, ...customDefs].map((def) => {
      const overrides = _hintOverrides[def.id];
      return overrides?.length ? { ...def, extraHints: overrides } : def;
    });
    notify();
  } catch (err) {
    // Offline refresh shouldn't crash — keep showing the data we have.
    console.error("supabase: refresh threw", err);
  } finally {
    _refreshing = false;
  }
}

// ---------- ROW MAPPERS (snake_case DB → camelCase TS) ----------

/**
 * The users.pin column is overloaded the same way entries.photo_url is
 * (no DDL possible, so no new columns): a plain "1234" for legacy users, or
 * a JSON blob when extra facts must ride along:
 *   '{"v":1,"ph":"<sha256 of PIN>","rc":"<sha256 hex>","vr":"guest"}'
 *   - ph: SHA-256 hex of the 4-digit PIN. Since 2026-07-08 all new/changed
 *     PINs are stored hashed (never plaintext); a legacy `pin` field is
 *     still read for unmigrated rows.
 *   - rc: hash of the admin's forgot-PIN recovery code (plaintext shown
 *     once at generation, never stored).
 *   - vr: view-role override. The DB role column has a CHECK constraint
 *     allowing only admin/staff, so view-only "guest" users are stored as
 *     role='staff' with vr:'guest' here.
 */
function parseUserPin(raw: unknown): {
  pin: string;
  pinHash?: string;
  recoveryHash?: string;
  roleOverride?: User["role"];
} {
  if (typeof raw !== "string") return { pin: "" };
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { pin?: unknown; ph?: unknown; rc?: unknown; vr?: unknown };
      return {
        pin: typeof o.pin === "string" ? o.pin : "",
        pinHash: typeof o.ph === "string" ? o.ph : undefined,
        recoveryHash: typeof o.rc === "string" ? o.rc : undefined,
        roleOverride: o.vr === "guest" ? "guest" : undefined,
      };
    } catch {
      return { pin: s };
    }
  }
  return { pin: s };
}

/**
 * Pack the auth facts back into the users.pin column. When a pinHash is
 * present the plaintext PIN is never written; the legacy plain form is kept
 * only for rows that still carry a plaintext PIN and nothing else.
 */
function serializeUserAuth(auth: {
  pin?: string;
  pinHash?: string;
  recoveryHash?: string;
  roleOverride?: User["role"];
}): string {
  const { pin, pinHash, recoveryHash, roleOverride } = auth;
  if (pinHash) {
    return JSON.stringify({
      v: 1,
      ph: pinHash,
      ...(recoveryHash ? { rc: recoveryHash } : {}),
      ...(roleOverride === "guest" ? { vr: "guest" } : {}),
    });
  }
  if (!recoveryHash && !roleOverride) return pin ?? "";
  return JSON.stringify({
    v: 1,
    pin: pin ?? "",
    ...(recoveryHash ? { rc: recoveryHash } : {}),
    ...(roleOverride === "guest" ? { vr: "guest" } : {}),
  });
}

/** The vr blob field is the only place guest-ness lives — derive it back. */
function roleOverrideFor(u: User): User["role"] | undefined {
  return u.role === "guest" ? "guest" : undefined;
}

function mapUser(row: Record<string, unknown>): User {
  const auth = parseUserPin(row.pin);
  return {
    id: row.id as string,
    name: row.name as string,
    role: auth.roleOverride ?? (row.role as User["role"]),
    pin: auth.pin,
    pinHash: auth.pinHash,
    recoveryHash: auth.recoveryHash,
  };
}

// ---------- MEDIA CACHE (photos load on demand, not at bootstrap) ----------
// Key present = this row's photo data has been fetched this session. The
// caches survive refreshFromSupabase (which re-maps rows without photo_url),
// so photos don't vanish when the tab refocuses.

const _entryMediaCache = new Map<string, { photoUrls: string[]; history: AuditRecord[] }>();
const _receiptPhotoCache = new Map<string, string>(); // "" = loaded, no photo

/** Has this entry's photos + edit history been fetched yet? */
export function isEntryMediaLoaded(id: string): boolean {
  return _entryMediaCache.has(id);
}

/** Has this receipt's photo been fetched yet? */
export function isReceiptPhotoLoaded(id: string): boolean {
  return _receiptPhotoCache.has(id);
}

/**
 * The receipts.ocr_text column is overloaded (like photo_url on entries):
 * plain OCR text, or a JSON blob '{"v":1,"ocr":"...","del":[AuditRecord]}'
 * once an admin has deleted a line item and we need to log it. ocr_text is
 * read nowhere else, so this is safe.
 */
interface ReceiptOcrBlob {
  ocrText?: string;
  deletions: AuditRecord[];
  settled?: Receipt["settled"];
  personalEntryIds?: string[];
  vatAmount?: number;
}

function parseReceiptOcr(raw: unknown): ReceiptOcrBlob {
  if (typeof raw !== "string" || raw.trim() === "") return { deletions: [] };
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as {
        ocr?: unknown;
        del?: unknown;
        set?: unknown;
        per?: unknown;
        vat?: unknown;
      };
      return {
        ocrText: typeof o.ocr === "string" ? o.ocr : undefined,
        deletions: Array.isArray(o.del) ? (o.del as AuditRecord[]) : [],
        settled:
          o.set && typeof o.set === "object"
            ? (o.set as Receipt["settled"])
            : undefined,
        personalEntryIds:
          Array.isArray(o.per) && o.per.length > 0 ? (o.per as string[]) : undefined,
        vatAmount: typeof o.vat === "number" ? (o.vat as number) : undefined,
      };
    } catch {
      return { ocrText: s, deletions: [] };
    }
  }
  return { ocrText: s, deletions: [] };
}

function serializeReceiptOcr(blob: ReceiptOcrBlob): string | null {
  const { ocrText, deletions, settled, personalEntryIds, vatAmount } = blob;
  const hasOcr = !!(ocrText && ocrText.trim());
  const hasPersonal = !!(personalEntryIds && personalEntryIds.length > 0);
  const hasVat = typeof vatAmount === "number" && vatAmount > 0;
  if (deletions.length === 0 && !settled && !hasPersonal && !hasVat) {
    return hasOcr ? ocrText! : null;
  }
  return JSON.stringify({
    v: 1,
    ...(hasOcr ? { ocr: ocrText } : {}),
    ...(deletions.length > 0 ? { del: deletions } : {}),
    ...(settled ? { set: settled } : {}),
    ...(hasPersonal ? { per: personalEntryIds } : {}),
    ...(hasVat ? { vat: vatAmount } : {}),
  });
}

/**
 * Serialize a receipt's ocr_text blob from its current fields, with optional
 * overrides. Using this (instead of passing fields by hand) means a caller
 * editing one field can't silently drop the others (deletions, settled,
 * personal items, VAT).
 */
function serializeReceiptOcrFor(r: Receipt, overrides: Partial<ReceiptOcrBlob> = {}): string | null {
  return serializeReceiptOcr({
    ocrText: r.ocrText,
    deletions: r.deletions ?? [],
    settled: r.settled,
    personalEntryIds: r.personalEntryIds,
    vatAmount: r.vatAmount,
    ...overrides,
  });
}

function mapReceipt(row: Record<string, unknown>): Receipt {
  const id = row.id as string;
  // Bootstrap/refresh rows omit photo_url; full rows (lazy fetch, inserts)
  // carry it and refresh the cache.
  if ("photo_url" in row) {
    _receiptPhotoCache.set(id, (row.photo_url ?? "") as string);
  }
  const ocr = parseReceiptOcr(row.ocr_text);
  return {
    id,
    vendor: row.vendor as string,
    date: row.date as string,
    photoUrl: _receiptPhotoCache.get(id) ?? "",
    ocrText: ocr.ocrText,
    totalTyped: row.total_typed as number,
    capturedBy: row.captured_by as string,
    status: row.status as Receipt["status"],
    deletions: ocr.deletions,
    settled: ocr.settled,
    personalEntryIds: ocr.personalEntryIds,
    vatAmount: ocr.vatAmount,
  };
}

/**
 * Admin override: mark a receipt complete even when the PCF line items don't
 * sum to the printed total (the gap is a personal / non-PCF purchase the
 * admin reimburses). Sets the receipt's stored status to reconciled and
 * records who/when/why in the ocr_text blob (alongside any deletion log).
 */
export async function markReceiptSettled(
  receiptId: string,
  byUserId: string,
  note?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { ok: false, reason: "Receipt not found — refresh and try again." };
  // Prior state for undo.
  const prevStatus = receipt.status;
  const prevOcr = serializeReceiptOcrFor(receipt);
  const prevSettled = receipt.settled;
  const prevOcrText = receipt.ocrText;
  const prevDeletions = receipt.deletions;
  const settled = {
    at: new Date().toISOString(),
    by: byUserId,
    note: note?.trim() || undefined,
  };
  const ocr = serializeReceiptOcrFor(receipt, { settled });
  receipts = receipts.map((r) =>
    r.id === receiptId ? { ...r, settled, status: "reconciled" } : r,
  );
  notify();
  const { error } = await supabase
    .from("receipts")
    .update({ status: "reconciled", ocr_text: ocr })
    .eq("id", receiptId);
  if (error) {
    console.error("supabase: markReceiptSettled", error);
    return { ok: false, reason: "Couldn't save — check your internet and try again." };
  }
  setUndoable(`Marked “${receipt.vendor}” complete`, async () => {
    receipts = receipts.map((r) =>
      r.id === receiptId
        ? { ...r, settled: prevSettled, status: prevStatus, ocrText: prevOcrText, deletions: prevDeletions }
        : r,
    );
    notify();
    const { error: e } = await supabase
      .from("receipts")
      .update({ status: prevStatus, ocr_text: prevOcr })
      .eq("id", receiptId);
    if (e) {
      console.error("supabase: undo markReceiptSettled", e);
      return { ok: false, reason: "Undo failed — refresh to check." };
    }
    return { ok: true };
  });
  return { ok: true };
}

/** Undo a settled override — reverts to the auto-computed reconciliation. */
export async function unmarkReceiptSettled(
  receiptId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { ok: false, reason: "Receipt not found — refresh and try again." };
  const remaining = entries.filter((e) => e.receiptId === receiptId);
  const status = receiptStatusFor(receipt, remaining);
  const ocr = serializeReceiptOcrFor(receipt, { settled: undefined });
  receipts = receipts.map((r) =>
    r.id === receiptId ? { ...r, settled: undefined, status } : r,
  );
  notify();
  const { error } = await supabase
    .from("receipts")
    .update({ status, ocr_text: ocr })
    .eq("id", receiptId);
  if (error) {
    console.error("supabase: unmarkReceiptSettled", error);
    return { ok: false, reason: "Couldn't save — check your internet and try again." };
  }
  return { ok: true };
}

/**
 * Entry "media" — the receipt photos plus the edit-history log — are packed
 * into the single existing `photo_url` text column as a small JSON blob.
 *
 * Why overload one column instead of adding `photo_urls` / `history`
 * columns? This environment can only reach Supabase through PostgREST
 * (the anon/service keys), which can't run DDL — so adding columns isn't
 * possible here. The `photo_url` column on `entries` is read nowhere except
 * mapEntry (verified), so packing structured JSON into it is safe.
 *
 * Stored shapes we accept on read (newest first):
 *   '{"v":1,"photos":[...],"history":[...]}'  — current format
 *   '["dataurl", ...]'                          — photos-only array
 *   'data:image/...'                            — legacy single photo
 *   '' / null                                   — nothing
 */
function parseEntryMedia(raw: unknown): { photoUrls: string[]; history: AuditRecord[] } {
  if (typeof raw !== "string" || raw.length === 0) return { photoUrls: [], history: [] };
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { photos?: unknown; history?: unknown };
      return {
        photoUrls: Array.isArray(o.photos) ? (o.photos as string[]) : [],
        history: Array.isArray(o.history) ? (o.history as AuditRecord[]) : [],
      };
    } catch {
      return { photoUrls: [], history: [] };
    }
  }
  if (s.startsWith("[")) {
    try {
      const a = JSON.parse(s);
      return { photoUrls: Array.isArray(a) ? (a as string[]) : [], history: [] };
    } catch {
      return { photoUrls: [s], history: [] };
    }
  }
  return { photoUrls: [s], history: [] };
}

/** Pack photos + history back into the JSON blob stored in `photo_url`. */
function serializeEntryMedia(photoUrls: string[], history: AuditRecord[]): string | null {
  if ((!photoUrls || photoUrls.length === 0) && (!history || history.length === 0)) {
    return null;
  }
  return JSON.stringify({ v: 1, photos: photoUrls ?? [], history: history ?? [] });
}

function mapEntry(row: Record<string, unknown>): Entry {
  const id = row.id as string;
  if ("photo_url" in row) {
    _entryMediaCache.set(id, parseEntryMedia(row.photo_url));
  }
  const media = _entryMediaCache.get(id) ?? { photoUrls: [], history: [] };
  return {
    id,
    date: row.date as string,
    vendor: row.vendor as string,
    item: row.item as string,
    qty: row.qty as number,
    unitPrice: row.unit_price as number,
    total: row.total as number,
    category: row.category as string,
    paidFrom: row.paid_from as Entry["paidFrom"],
    majorRepair: (row.major_repair ?? false) as boolean,
    receiptId: row.receipt_id as string | undefined,
    photoUrl: media.photoUrls[0], // legacy single accessor
    photoUrls: media.photoUrls,
    loggedBy: row.logged_by as string,
    createdAt: row.created_at as string,
    flags: (row.flags ?? []) as Entry["flags"],
    notes: (row.notes ?? []) as Entry["notes"],
    history: media.history,
  };
}

function mapPcfLedger(row: Record<string, unknown>): PcfLedgerEntry {
  return {
    id: row.id as string,
    kind: row.kind as PcfLedgerEntry["kind"],
    amount: row.amount as number,
    date: row.date as string,
    reportedBy: row.reported_by as string,
    approvedBy: row.approved_by as string | undefined,
    status: row.status as PcfLedgerEntry["status"],
    note: row.note as string | undefined,
    decisionNote: row.decision_note as string | undefined,
    resolved: (row.resolved ?? false) as boolean,
    resolvedAt: row.resolved_at as string | undefined,
    resolvedBy: row.resolved_by as string | undefined,
    linkedEntryId: row.linked_entry_id as string | undefined,
    createdAt: row.created_at as string,
  };
}

function mapCategoryDef(row: Record<string, unknown>): CategoryDef {
  return {
    id: row.id as string,
    tagalog: row.tagalog as string | undefined,
    iconKey: row.icon_key as string,
    builtin: row.builtin as boolean,
    extraHints: (row.extra_hints ?? []) as string[],
  };
}

// ---------- LAZY MEDIA LOADERS ----------

/** Re-apply cached media onto the in-memory entry/receipt and notify. */
function applyEntryMedia(id: string): void {
  const media = _entryMediaCache.get(id);
  if (!media) return;
  entries = entries.map((e) =>
    e.id === id
      ? { ...e, photoUrls: media.photoUrls, photoUrl: media.photoUrls[0], history: media.history }
      : e,
  );
  notify();
}

function applyReceiptPhoto(id: string): void {
  const photoUrl = _receiptPhotoCache.get(id);
  if (photoUrl === undefined) return;
  receipts = receipts.map((r) => (r.id === id ? { ...r, photoUrl } : r));
  notify();
}

const _entryMediaPending = new Map<string, Promise<void>>();
const _receiptPhotoPending = new Map<string, Promise<void>>();

/**
 * Fetch one entry's photos + edit history (the packed photo_url blob) if we
 * haven't already this session. Resolves immediately when cached; concurrent
 * calls for the same id share one request. On failure it resolves without
 * caching, so a later call retries.
 */
export function ensureEntryMedia(id: string): Promise<void> {
  if (_entryMediaCache.has(id)) return Promise.resolve();
  const pending = _entryMediaPending.get(id);
  if (pending) return pending;
  const p = (async () => {
    const { data, error } = await supabase
      .from("entries")
      .select("photo_url")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("supabase: ensureEntryMedia", error);
      return;
    }
    _entryMediaCache.set(id, parseEntryMedia(data?.photo_url));
    applyEntryMedia(id);
  })()
    .catch((err) => console.error("supabase: ensureEntryMedia threw", err))
    .finally(() => _entryMediaPending.delete(id));
  _entryMediaPending.set(id, p);
  return p;
}

/** Fetch one receipt's photo if we haven't already this session. */
export function ensureReceiptPhoto(id: string): Promise<void> {
  if (_receiptPhotoCache.has(id)) return Promise.resolve();
  const pending = _receiptPhotoPending.get(id);
  if (pending) return pending;
  const p = (async () => {
    const { data, error } = await supabase
      .from("receipts")
      .select("photo_url")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("supabase: ensureReceiptPhoto", error);
      return;
    }
    _receiptPhotoCache.set(id, (data?.photo_url ?? "") as string);
    applyReceiptPhoto(id);
  })()
    .catch((err) => console.error("supabase: ensureReceiptPhoto threw", err))
    .finally(() => _receiptPhotoPending.delete(id));
  _receiptPhotoPending.set(id, p);
  return p;
}

/**
 * Bulk-fetch photos for every receipt and entry in a scope — a YYYY-MM month
 * or "all". Used by the pages that genuinely need many photos at once (the
 * gallery, the receipts pack). Returns false if either fetch failed.
 *
 * A scope that already completed this session is not refetched (photos are
 * effectively immutable once logged), and concurrent calls for the same
 * scope share one request — repeated gallery visits were each re-downloading
 * tens of MB otherwise.
 */
const _mediaScopesLoaded = new Set<string>();
const _mediaScopesPending = new Map<string, Promise<boolean>>();

export function loadAllMedia(scope: "all" | string): Promise<boolean> {
  if (_mediaScopesLoaded.has("all") || _mediaScopesLoaded.has(scope)) {
    return Promise.resolve(true);
  }
  const pending = _mediaScopesPending.get(scope);
  if (pending) return pending;
  const p = loadAllMediaUncached(scope).finally(() => _mediaScopesPending.delete(scope));
  _mediaScopesPending.set(scope, p);
  return p;
}

async function loadAllMediaUncached(scope: "all" | string): Promise<boolean> {
  try {
    let start = "", end = "";
    if (scope !== "all") {
      const [y, m] = scope.split("-").map(Number);
      start = `${scope}-01`;
      end = `${scope}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    }
    // Paginate — the "all" scope (and any month with >1000 rows) would
    // otherwise truncate at PostgREST's 1000-row cap and miss photos.
    const range = (table: string) => (f: number, t: number) => {
      let q = supabase.from(table).select("id,photo_url");
      if (scope !== "all") q = q.gte("date", start).lte("date", end);
      return q.range(f, t);
    };
    const [rRes, eRes] = await Promise.all([
      selectAllRows(range("receipts")),
      selectAllRows(range("entries")),
    ]);
    if (rRes.error || eRes.error) {
      console.error("supabase: loadAllMedia", { rRes, eRes });
      return false;
    }
    for (const row of rRes.data!) {
      _receiptPhotoCache.set(row.id as string, (row.photo_url ?? "") as string);
    }
    for (const row of eRes.data!) {
      _entryMediaCache.set(row.id as string, parseEntryMedia(row.photo_url));
    }
    // Re-apply everything in one pass + one notify.
    receipts = receipts.map((r) => {
      const photoUrl = _receiptPhotoCache.get(r.id);
      return photoUrl === undefined ? r : { ...r, photoUrl };
    });
    entries = entries.map((e) => {
      const media = _entryMediaCache.get(e.id);
      return media
        ? { ...e, photoUrls: media.photoUrls, photoUrl: media.photoUrls[0], history: media.history }
        : e;
    });
    _mediaScopesLoaded.add(scope);
    notify();
    return true;
  } catch (err) {
    console.error("supabase: loadAllMedia threw", err);
    return false;
  }
}

// ---------- CATEGORIES ----------

const BUILTIN_ICON_KEYS: Record<Category, string> = {
  Breakfast: "sun",
  "Lunch/Dinner": "utensils",
  "Staff Meals": "users",
  Coffee: "coffee",
  Kitchen: "chef-hat",
  "Room Supplies": "bath",
  "Cleaning Supplies": "sparkles",
  Laundry: "shirt",
  Utilities: "zap",
  "Drinking Water": "glass-water",
  Communications: "phone",
  "Fuel & Gas": "fuel",
  Maintenance: "wrench",
  "Garden and Animals": "sprout",
  Admin: "briefcase",
  Accounting: "calculator",
  Compliance: "shield-check",
  Other: "more-horizontal",
};

const BUILTIN_TAGALOG: Record<Category, string> = {
  Breakfast: "Almusal",
  "Lunch/Dinner": "Tanghalian/Hapunan",
  "Staff Meals": "Pagkain ng staff",
  Coffee: "Kape",
  Kitchen: "Kusina",
  "Room Supplies": "Gamit sa kwarto",
  "Cleaning Supplies": "Panlinis",
  Laundry: "Labada",
  Utilities: "Kuryente/Tubig",
  "Drinking Water": "Inuming tubig",
  Communications: "Telepono/Internet",
  "Fuel & Gas": "Gasolina/LPG",
  Maintenance: "Pagkumpuni",
  "Garden and Animals": "Hardin at mga hayop",
  Admin: "Pamamahala",
  Accounting: "",
  Compliance: "",
  Other: "Iba pa",
};

const BUILTIN_DEFS: CategoryDef[] = BUILTIN_CATEGORIES.map((id) => ({
  id,
  tagalog: BUILTIN_TAGALOG[id] || undefined,
  iconKey: BUILTIN_ICON_KEYS[id] ?? "package",
  builtin: true,
}));

const CATEGORY_HINTS_KEY = "tanawin.categoryHintOverrides";

function loadHintOverrides(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CATEGORY_HINTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((s) => typeof s === "string")) {
        out[k] = v as string[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveHintOverrides(map: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CATEGORY_HINTS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

const _hintOverrides = loadHintOverrides();
let categoryDefs: CategoryDef[] = BUILTIN_DEFS.map((def) => {
  const overrides = _hintOverrides[def.id];
  return overrides?.length ? { ...def, extraHints: overrides } : def;
});

export function getCategoryDefs(): CategoryDef[] {
  return categoryDefs;
}

export function getCategoryDef(id: Category): CategoryDef | undefined {
  return categoryDefs.find((d) => d.id === id);
}

export function addCategoryDef(input: {
  id: string;
  tagalog?: string;
  iconKey?: string;
}): CategoryDef | null {
  const id = input.id.trim();
  if (id.length === 0) return null;
  const existing = categoryDefs.find(
    (d) => d.id.toLowerCase() === id.toLowerCase(),
  );
  if (existing) return null;
  const def: CategoryDef = {
    id,
    tagalog: input.tagalog?.trim() || undefined,
    iconKey: input.iconKey ?? "package",
    builtin: false,
  };
  categoryDefs = [...categoryDefs, def];
  notify();

  supabase.from("category_defs").insert({
    id: def.id,
    tagalog: def.tagalog ?? null,
    icon_key: def.iconKey,
    builtin: false,
    extra_hints: [],
  }).then(({ error }) => {
    if (error) console.error("supabase: addCategoryDef", error);
  });

  return def;
}

export function deleteCategoryDef(id: Category): { ok: boolean; reason?: string } {
  const def = categoryDefs.find((d) => d.id === id);
  if (!def) return { ok: false, reason: "Category not found." };
  if (def.builtin) return { ok: false, reason: "Built-in categories can't be deleted." };
  const usageCount = entries.filter((e) => e.category === id).length;
  if (usageCount > 0) {
    return {
      ok: false,
      reason: `${usageCount} entr${usageCount === 1 ? "y uses" : "ies use"} this category — reassign them first.`,
    };
  }
  categoryDefs = categoryDefs.filter((d) => d.id !== id);
  notify();

  supabase.from("category_defs").delete().eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: deleteCategoryDef", error);
  });

  return { ok: true };
}

export function updateCategoryHints(
  id: Category,
  hints: string[] | null | undefined,
): void {
  const clean = (hints ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const h of clean) {
    if (!seen.has(h)) { seen.add(h); deduped.push(h); }
  }

  categoryDefs = categoryDefs.map((d) =>
    d.id === id ? { ...d, extraHints: deduped.length > 0 ? deduped : undefined } : d,
  );

  const map: Record<string, string[]> = {};
  for (const d of categoryDefs) {
    if (d.extraHints?.length) map[d.id] = d.extraHints;
  }
  saveHintOverrides(map);
  notify();

  // Persist extra_hints for custom categories to Supabase
  const def = categoryDefs.find((d) => d.id === id);
  if (def && !def.builtin) {
    supabase.from("category_defs")
      .update({ extra_hints: deduped })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("supabase: updateCategoryHints", error);
      });
  }
}

// ---------- CATEGORY DEDUPE (aliases + fuzzy guard + merge) ----------
//
// Categories aren't free-typed (staff pick from a list), so bloat comes from
// admins CREATING near-duplicates ("Cleaning Supplies" vs "Cleaning supplies"
// vs "Cleaners") in manage-categories. Mirrors the vendor registry: a
// creation-time fuzzy guard + a merge tool, with an alias map (old name ->
// canonical id) that grows as merges happen, so a merged-away name can't be
// resurrected by accident. Stored as one JSON blob on a sentinel category_defs
// row "__cat_aliases__" (builtin:true so the category fetch skips it).

const CATEGORY_ALIAS_ROW_ID = "__cat_aliases__";
let categoryAliases: Record<string, string> = {}; // normalized old name -> canonical id

function parseCategoryAliases(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

async function persistCategoryAliases(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("category_defs")
      .upsert(
        { id: CATEGORY_ALIAS_ROW_ID, builtin: true, icon_key: JSON.stringify(categoryAliases) },
        { onConflict: "id" },
      );
    if (error) {
      console.error("supabase: persistCategoryAliases", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("supabase: persistCategoryAliases threw", err);
    return false;
  }
}

// Closed-period adjustment log — see PcfAdjustment. Stored as one JSON array on
// a sentinel category_defs row "__pcf_adjustments__" (builtin:true so the
// category fetch skips it), same no-DDL pattern as the vendor/alias registries.
const PCF_ADJ_ROW_ID = "__pcf_adjustments__";
let pcfAdjustments: PcfAdjustment[] = [];

function parsePcfAdjustments(raw: unknown): PcfAdjustment[] {
  if (typeof raw !== "string" || !raw.trim().startsWith("[")) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return arr.filter(
      (x): x is PcfAdjustment =>
        !!x &&
        typeof (x as PcfAdjustment).at === "string" &&
        typeof (x as PcfAdjustment).delta === "number" &&
        typeof (x as PcfAdjustment).summary === "string",
    );
  } catch {
    return [];
  }
}

async function persistPcfAdjustments(): Promise<void> {
  try {
    const { error } = await supabase
      .from("category_defs")
      .upsert(
        { id: PCF_ADJ_ROW_ID, builtin: true, icon_key: JSON.stringify(pcfAdjustments) },
        { onConflict: "id" },
      );
    if (error) console.error("supabase: persistPcfAdjustments", error);
  } catch (err) {
    console.error("supabase: persistPcfAdjustments threw", err);
  }
}

/** Closed-period reset adjustments, newest first (for the PCF page). */
export function getPcfResetAdjustments(): PcfAdjustment[] {
  return [...pcfAdjustments].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Apply the sentinel registry rows (vendor registry + category aliases + PCF log). */
function applyRegistryRows(rows: Array<Record<string, unknown>> | null | undefined): void {
  const list = Array.isArray(rows) ? rows : [];
  const vRow = list.find((r) => r.id === VENDOR_ROW_ID);
  const cRow = list.find((r) => r.id === CATEGORY_ALIAS_ROW_ID);
  const aRow = list.find((r) => r.id === PCF_ADJ_ROW_ID);
  vendorRegistry = parseVendorRegistry(vRow?.icon_key);
  categoryAliases = parseCategoryAliases(cRow?.icon_key);
  pcfAdjustments = parsePcfAdjustments(aRow?.icon_key);
}

export function getCategoryAliases(): Record<string, string> {
  return categoryAliases;
}

/** Map an old/aliased category name to its canonical id (for stale filters). */
export function resolveCategoryAlias(name: string): string {
  const canon = categoryAliases[normalizeVendor(name)];
  return canon && categoryDefs.some((d) => d.id === canon) ? canon : name;
}

/**
 * When adding a category, is the typed name a duplicate or near-duplicate of
 * an existing one? Returns the match (with `exact` when it's the same name
 * modulo case/spacing, otherwise a fuzzy "did you mean"), or null if it looks
 * genuinely new. Reuses the vendor fuzzy machinery.
 */
export function suggestCanonicalCategory(name: string): { match: string; exact: boolean } | null {
  const norm = normalizeVendor(name);
  if (!norm) return null;
  const exact = categoryDefs.find((d) => normalizeVendor(d.id) === norm);
  if (exact) return { match: exact.id, exact: true };
  const aliased = categoryAliases[norm];
  if (aliased && categoryDefs.some((d) => d.id === aliased)) return { match: aliased, exact: false };

  const squashed = squashVendor(name);
  if (squashed.length < VENDOR_FUZZY_MIN_LEN) return null;
  let best: { id: string; score: number } | null = null;
  for (const d of categoryDefs) {
    const candidates = [squashVendor(d.id), squashVendor(normalizeVendor(d.id).split(" ")[0])];
    let s = 0;
    for (const c of candidates) if (c.length >= VENDOR_FUZZY_MIN_LEN) s = Math.max(s, vendorSimilarity(squashed, c));
    if (s >= VENDOR_FUZZY_THRESHOLD && (!best || s > best.score)) best = { id: d.id, score: s };
  }
  return best ? { match: best.id, exact: false } : null;
}

async function _updateEntriesCategoryByIds(ids: string[], category: string): Promise<void> {
  // Chunk the id list so the PostgREST URL stays a sane length.
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { error } = await supabase.from("entries").update({ category }).in("id", slice);
    if (error) console.error("supabase: _updateEntriesCategoryByIds", error);
  }
}

/**
 * Merge a duplicate category into the correct one: re-tag every entry from
 * `fromId` to `toId`, delete the duplicate, and remember `fromId` as an alias
 * of `toId` (so it can't be recreated by accident). Source must be a custom
 * (deletable) category; the target can be built-in or custom. Undoable.
 */
export async function mergeCategories(
  fromId: string,
  toId: string,
): Promise<{ ok: boolean; reason?: string; moved: number }> {
  if (fromId === toId) return { ok: false, reason: "Pick two different categories.", moved: 0 };
  const fromDef = categoryDefs.find((d) => d.id === fromId);
  const toDef = categoryDefs.find((d) => d.id === toId);
  if (!fromDef || !toDef) return { ok: false, reason: "Category not found — refresh and try again.", moved: 0 };
  if (fromDef.builtin) {
    return { ok: false, reason: "Built-in categories can't be merged away (use one as the target instead).", moved: 0 };
  }

  const affected = entries.filter((e) => e.category === fromId).map((e) => e.id);
  const prevAliases = { ...categoryAliases };

  // Optimistic local update.
  entries = entries.map((e) => (e.category === fromId ? { ...e, category: toId } : e));
  const nextAliases: Record<string, string> = { [normalizeVendor(fromId)]: toId };
  for (const [k, v] of Object.entries(categoryAliases)) nextAliases[k] = v === fromId ? toId : v;
  categoryAliases = nextAliases;
  categoryDefs = categoryDefs.filter((d) => d.id !== fromId);
  notify();

  // Persist: one bulk PATCH by category, delete the def, save aliases.
  const { error: eErr } = await supabase.from("entries").update({ category: toId }).eq("category", fromId);
  if (eErr) {
    console.error("supabase: mergeCategories retag", eErr);
    entries = entries.map((e) => (affected.includes(e.id) ? { ...e, category: fromId } : e));
    categoryAliases = prevAliases;
    categoryDefs = [...categoryDefs, fromDef];
    notify();
    return { ok: false, reason: "Couldn't move the entries — check your internet and try again.", moved: 0 };
  }
  await supabase.from("category_defs").delete().eq("id", fromId);
  await persistCategoryAliases();

  setUndoable(`Merged “${fromId}” into “${toId}”`, async () => {
    categoryDefs = [...categoryDefs.filter((d) => d.id !== fromId), fromDef];
    entries = entries.map((e) => (affected.includes(e.id) ? { ...e, category: fromId } : e));
    categoryAliases = prevAliases;
    notify();
    const { error } = await supabase.from("category_defs").insert({
      id: fromDef.id,
      tagalog: fromDef.tagalog ?? null,
      icon_key: fromDef.iconKey,
      builtin: false,
      extra_hints: fromDef.extraHints ?? [],
    });
    if (error) {
      console.error("supabase: undo mergeCategories", error);
      return { ok: false, reason: "Undo failed — refresh to check." };
    }
    await _updateEntriesCategoryByIds(affected, fromId);
    await persistCategoryAliases();
    return { ok: true };
  });

  return { ok: true, moved: affected.length };
}

// ---------- VENDORS (shared canonical registry) ----------
//
// Canonical vendor names + their alternate spellings, plus staff-proposed
// suggestions awaiting admin approval. Stored as one JSON blob on a sentinel
// category_defs row (id "__vendors__", builtin:true so the category fetch —
// which filters builtin=false — never sees it). No DDL; syncs to all devices.

const VENDOR_ROW_ID = "__vendors__";
let vendorRegistry: VendorRegistry = { v: 1, vendors: [], suggestions: [] };

/** Lowercase, strip punctuation, collapse whitespace — for matching. */
export function normalizeVendor(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/** Normalized name with spaces removed — catches "Pure Gold" vs "Puregold". */
function squashVendor(s: string): string {
  return normalizeVendor(s).replace(/\s+/g, "");
}

/** Levenshtein edit distance (single-char insert/delete/substitute steps). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Similarity 0..1 between two strings (1 = identical), by edit distance. */
function vendorSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function parseVendorRegistry(raw: unknown): VendorRegistry {
  const empty: VendorRegistry = { v: 1, vendors: [], suggestions: [] };
  if (typeof raw !== "string" || raw.trim() === "") return empty;
  try {
    const o = JSON.parse(raw) as Partial<VendorRegistry>;
    return {
      v: 1,
      vendors: Array.isArray(o.vendors)
        ? o.vendors
            .filter((x): x is SavedVendor => !!x && typeof x.name === "string")
            .map((x) => ({ name: x.name, aliases: Array.isArray(x.aliases) ? x.aliases : [] }))
        : [],
      suggestions: Array.isArray(o.suggestions)
        ? (o.suggestions.filter(
            (x) => !!x && typeof (x as VendorSuggestion).name === "string",
          ) as VendorSuggestion[])
        : [],
    };
  } catch {
    return empty;
  }
}

async function persistVendorRegistry(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("category_defs")
      .upsert(
        { id: VENDOR_ROW_ID, builtin: true, icon_key: JSON.stringify(vendorRegistry) },
        { onConflict: "id" },
      );
    if (error) {
      console.error("supabase: persistVendorRegistry", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("supabase: persistVendorRegistry threw", err);
    return false;
  }
}

export function getVendorRegistry(): VendorRegistry {
  return vendorRegistry;
}
export function getSavedVendors(): SavedVendor[] {
  return [...vendorRegistry.vendors].sort((a, b) => a.name.localeCompare(b.name));
}
export function getPendingVendorSuggestions(): VendorSuggestion[] {
  return [...vendorRegistry.suggestions].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Names offered as plain autocomplete on the vendor field: saved canonical
 * names plus every vendor already used on an entry/receipt, de-duplicated.
 */
export function getVendorAutocomplete(): string[] {
  const seen = new Map<string, string>(); // normalized -> display
  for (const v of vendorRegistry.vendors) seen.set(normalizeVendor(v.name), v.name);
  for (const e of entries) {
    const k = normalizeVendor(e.vendor);
    if (k && !seen.has(k)) seen.set(k, e.vendor);
  }
  for (const r of receipts) {
    const k = normalizeVendor(r.vendor);
    if (k && !seen.has(k)) seen.set(k, r.vendor);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

/** Min length + similarity for the fuzzy typo fallback (conservative). */
const VENDOR_FUZZY_MIN_LEN = 4;
const VENDOR_FUZZY_THRESHOLD = 0.85;

/**
 * If the typed vendor looks like a known variant, return the canonical name to
 * suggest ("Did you mean…?"). Returns null when it already matches a canonical
 * name exactly, or nothing close is found. Suggest-only — never auto-applies.
 *
 * Order: exact spacing/alias match first (high confidence), then a conservative
 * fuzzy fallback (edit distance) that catches typos like "Puregld" → "Puregold"
 * and "Beeperas" → "Beperas Water Treatment Services" (matched on the first
 * word). Abbreviations like "BWTS" are deliberately NOT auto-detected — admins
 * save those as aliases instead.
 */
export function suggestCanonicalVendor(input: string): string | null {
  const norm = normalizeVendor(input);
  if (!norm) return null;
  const squashed = squashVendor(input);
  for (const v of vendorRegistry.vendors) {
    const canonNorm = normalizeVendor(v.name);
    if (norm === canonNorm) return null; // already canonical
    if (v.aliases.includes(norm)) return v.name; // known alias
    if (squashed && squashed === squashVendor(v.name)) return v.name; // spacing-only diff
    if (v.aliases.some((a) => squashVendor(a) === squashed)) return v.name;
  }

  // Fuzzy fallback — only for inputs of a few characters, and only the single
  // best high-similarity vendor. Compared against the full name, its first
  // word, and any aliases.
  if (squashed.length < VENDOR_FUZZY_MIN_LEN) return null;
  let best: { name: string; score: number } | null = null;
  for (const v of vendorRegistry.vendors) {
    const candidates = [
      squashVendor(v.name),
      squashVendor(normalizeVendor(v.name).split(" ")[0]),
      ...v.aliases.map((a) => squashVendor(a)),
    ].filter((c) => c.length >= VENDOR_FUZZY_MIN_LEN);
    let bestForVendor = 0;
    for (const c of candidates) {
      bestForVendor = Math.max(bestForVendor, vendorSimilarity(squashed, c));
    }
    if (bestForVendor >= VENDOR_FUZZY_THRESHOLD && (!best || bestForVendor > best.score)) {
      best = { name: v.name, score: bestForVendor };
    }
  }
  return best?.name ?? null;
}

/** Add or update a canonical vendor (admin). Merges aliases if it exists. */
export async function addSavedVendor(
  name: string,
  aliases: string[] = [],
): Promise<{ ok: boolean; reason?: string }> {
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "Vendor name is required." };
  const normAliases = Array.from(
    new Set(aliases.map(normalizeVendor).filter((a) => a && a !== normalizeVendor(clean))),
  );
  const prev = vendorRegistry;
  const existing = vendorRegistry.vendors.find(
    (v) => normalizeVendor(v.name) === normalizeVendor(clean),
  );
  if (existing) {
    vendorRegistry = {
      ...vendorRegistry,
      vendors: vendorRegistry.vendors.map((v) =>
        v === existing
          ? { name: clean, aliases: Array.from(new Set([...v.aliases, ...normAliases])) }
          : v,
      ),
    };
  } else {
    vendorRegistry = {
      ...vendorRegistry,
      vendors: [...vendorRegistry.vendors, { name: clean, aliases: normAliases }],
    };
  }
  notify();
  if (!(await persistVendorRegistry())) {
    vendorRegistry = prev;
    notify();
    return { ok: false, reason: "Couldn't save — check your internet and try again." };
  }
  return { ok: true };
}

/** Remove a canonical vendor (admin). */
export async function removeSavedVendor(name: string): Promise<{ ok: boolean; reason?: string }> {
  const prev = vendorRegistry;
  vendorRegistry = {
    ...vendorRegistry,
    vendors: vendorRegistry.vendors.filter(
      (v) => normalizeVendor(v.name) !== normalizeVendor(name),
    ),
  };
  notify();
  if (!(await persistVendorRegistry())) {
    vendorRegistry = prev;
    notify();
    return { ok: false, reason: "Couldn't save — try again." };
  }
  return { ok: true };
}

/** Staff proposes a vendor to be saved (admin approves later). */
export async function proposeVendor(
  name: string,
  proposedBy: string,
  note?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "Type a vendor name first." };
  const norm = normalizeVendor(clean);
  if (vendorRegistry.vendors.some((v) => normalizeVendor(v.name) === norm)) {
    return { ok: false, reason: "That vendor is already saved." };
  }
  if (vendorRegistry.suggestions.some((s) => normalizeVendor(s.name) === norm)) {
    return { ok: false, reason: "That vendor has already been suggested." };
  }
  const suggestion: VendorSuggestion = {
    id: `vs_${Math.random().toString(36).slice(2, 10)}`,
    name: clean,
    aliases: [],
    proposedBy,
    at: new Date().toISOString(),
    note: note?.trim() || undefined,
  };
  const prev = vendorRegistry;
  vendorRegistry = { ...vendorRegistry, suggestions: [...vendorRegistry.suggestions, suggestion] };
  notify();
  if (!(await persistVendorRegistry())) {
    vendorRegistry = prev;
    notify();
    return { ok: false, reason: "Couldn't send — check your internet and try again." };
  }
  return { ok: true };
}

/** Admin approves a suggestion → it becomes a saved vendor. */
export async function approveVendorSuggestion(id: string): Promise<{ ok: boolean; reason?: string }> {
  const sug = vendorRegistry.suggestions.find((s) => s.id === id);
  if (!sug) return { ok: false, reason: "Suggestion not found — refresh and try again." };
  const prev = vendorRegistry;
  const norm = normalizeVendor(sug.name);
  const vendors = vendorRegistry.vendors.some((v) => normalizeVendor(v.name) === norm)
    ? vendorRegistry.vendors
    : [...vendorRegistry.vendors, { name: sug.name, aliases: sug.aliases }];
  vendorRegistry = {
    ...vendorRegistry,
    vendors,
    suggestions: vendorRegistry.suggestions.filter((s) => s.id !== id),
  };
  notify();
  if (!(await persistVendorRegistry())) {
    vendorRegistry = prev;
    notify();
    return { ok: false, reason: "Couldn't save — try again." };
  }
  return { ok: true };
}

/** Admin dismisses a suggestion. */
export async function rejectVendorSuggestion(id: string): Promise<{ ok: boolean; reason?: string }> {
  const prev = vendorRegistry;
  vendorRegistry = {
    ...vendorRegistry,
    suggestions: vendorRegistry.suggestions.filter((s) => s.id !== id),
  };
  notify();
  if (!(await persistVendorRegistry())) {
    vendorRegistry = prev;
    notify();
    return { ok: false, reason: "Couldn't save — try again." };
  }
  return { ok: true };
}

/** How many entries/receipts currently use any of these vendor spellings. */
export function countVendorUsage(names: string[]): number {
  const norms = new Set(names.map(normalizeVendor));
  const e = entries.filter((x) => norms.has(normalizeVendor(x.vendor))).length;
  const r = receipts.filter((x) => norms.has(normalizeVendor(x.vendor))).length;
  return e + r;
}

/**
 * Consolidate vendors: rewrite every entry & receipt whose vendor matches any
 * of `fromNames` to `canonicalName`, register the canonical vendor, and keep
 * the old spellings as aliases so future entries get auto-suggested. Admin
 * cleanup tool — mirrors the bulk-correction REST pattern.
 */
export async function mergeVendors(
  fromNames: string[],
  canonicalName: string,
  byUserId: string,
): Promise<{ ok: boolean; reason?: string; changed: number }> {
  const canonical = canonicalName.trim();
  if (!canonical) return { ok: false, reason: "Pick the correct vendor name.", changed: 0 };
  const canonNorm = normalizeVendor(canonical);
  const fromNorms = new Set(fromNames.map(normalizeVendor).filter((n) => n && n !== canonNorm));

  // Rewrite matching entries (optimistic local + fire-and-forget PATCH each).
  const entryHits = entries.filter((e) => fromNorms.has(normalizeVendor(e.vendor)));
  for (const e of entryHits) {
    updateEntry(e.id, { vendor: canonical });
    appendEntryHistory(e.id, {
      at: new Date().toISOString(),
      by: byUserId,
      summary: `Vendor corrected to “${canonical}”`,
    });
  }

  // Rewrite matching receipts.
  const receiptHits = receipts.filter((r) => fromNorms.has(normalizeVendor(r.vendor)));
  receipts = receipts.map((r) =>
    fromNorms.has(normalizeVendor(r.vendor)) ? { ...r, vendor: canonical } : r,
  );
  notify();
  for (const r of receiptHits) {
    const { error } = await supabase.from("receipts").update({ vendor: canonical }).eq("id", r.id);
    if (error) console.error("supabase: mergeVendors receipt", error);
  }

  // Record the canonical vendor + fold the old spellings in as aliases.
  await addSavedVendor(canonical, Array.from(fromNorms));

  return { ok: true, changed: entryHits.length + receiptHits.length };
}

// ---------- PUB-SUB ----------

const subscribers = new Set<() => void>();
function notify() {
  subscribers.forEach((fn) => fn());
}
export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ---------- USERS ----------

export function getUsers(): User[] {
  return users;
}
export function getUserById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}
/**
 * Is this PIN already taken by another user? Returns the other user's name,
 * or null when free. Compares hashed and legacy-plaintext PINs alike (two
 * users sharing a PIN would make name+PIN login ambiguous).
 */
export async function pinInUse(excludeUserId: string, pin: string): Promise<string | null> {
  const hash = await sha256Hex(pin);
  const u = users.find(
    (x) => x.id !== excludeUserId && (x.pinHash === hash || (x.pin !== "" && x.pin === pin)),
  );
  return u?.name ?? null;
}

export async function authenticateByPin(name: string, pin: string): Promise<User | null> {
  const u = users.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!u) return null;
  // Hashed PIN (current format) — compare digests. Legacy plaintext rows
  // (not yet migrated) compare directly.
  if (u.pinHash) {
    return (await sha256Hex(pin)) === u.pinHash ? u : null;
  }
  return u.pin !== "" && u.pin === pin ? u : null;
}

/**
 * Admin: update a user's display name and/or PIN. Used when staff
 * are replaced — admin renames the slot and resets the PIN.
 * Role (admin/staff) is intentionally NOT editable here.
 */
export async function updateUser(
  id: string,
  patch: { name?: string; pin?: string },
): Promise<void> {
  const cur = users.find((u) => u.id === id);
  if (!cur) return;
  const trimmedName = patch.name?.trim();
  const trimmedPin = patch.pin?.trim();
  // New/changed PINs are stored hashed, never plaintext.
  const newPinHash = trimmedPin ? await sha256Hex(trimmedPin) : undefined;
  users = users.map((u) =>
    u.id === id
      ? {
          ...u,
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(newPinHash ? { pin: "", pinHash: newPinHash } : {}),
        }
      : u,
  );
  notify();

  const update: Record<string, string> = {};
  if (trimmedName) update.name = trimmedName;
  // The pin column may carry the packed recovery hash and the guest role
  // override — preserve both when the PIN changes (see parseUserPin).
  if (newPinHash) {
    update.pin = serializeUserAuth({
      pinHash: newPinHash,
      recoveryHash: cur.recoveryHash,
      roleOverride: roleOverrideFor(cur),
    });
  }
  if (Object.keys(update).length === 0) return;

  supabase
    .from("users")
    .update(update)
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("supabase: updateUser", error);
    });
}

// ---------- ADMIN FORGOT-PIN RECOVERY ----------

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Canonical form for comparing recovery codes: uppercase, no dashes/spaces. */
function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Generate a fresh recovery code for a user (in practice: the admin),
 * store only its hash, and return the plaintext ONCE for display. The
 * caller must tell the user to write it down — it is not recoverable.
 * Replaces any previous code.
 */
export async function generateRecoveryCode(userId: string): Promise<string | null> {
  const cur = users.find((u) => u.id === userId);
  if (!cur) return null;

  // 12 chars from an unambiguous alphabet (no 0/O/1/I/L) ≈ 58 bits.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  let raw = "";
  for (let i = 0; i < 12; i++) raw += alphabet[rnd[i] % alphabet.length];
  const display = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const hash = await sha256Hex(raw);

  users = users.map((u) => (u.id === userId ? { ...u, recoveryHash: hash } : u));
  notify();

  const { error } = await supabase
    .from("users")
    .update({
      pin: serializeUserAuth({
        pin: cur.pin,
        pinHash: cur.pinHash,
        recoveryHash: hash,
        roleOverride: roleOverrideFor(cur),
      }),
    })
    .eq("id", userId);
  if (error) {
    console.error("supabase: generateRecoveryCode", error);
    return null;
  }
  return display;
}

/**
 * Forgot-PIN failsafe: validate the recovery code and set a new PIN. The
 * code is one-time — it's cleared on successful use, so the admin should
 * generate a fresh one from Manage staff afterwards.
 */
export async function resetPinWithRecoveryCode(
  userId: string,
  code: string,
  newPin: string,
): Promise<{ ok: boolean; reason?: string }> {
  const cur = users.find((u) => u.id === userId);
  if (!cur) return { ok: false, reason: "User not found — try refreshing." };
  if (!cur.recoveryHash) {
    return { ok: false, reason: "No recovery code is set up for this account." };
  }
  if (!/^\d{4}$/.test(newPin)) {
    return { ok: false, reason: "The new PIN must be exactly 4 digits." };
  }
  const newPinHash = await sha256Hex(newPin);
  const collision = users.find(
    (u) => u.id !== userId && (u.pinHash === newPinHash || (u.pin !== "" && u.pin === newPin)),
  );
  if (collision) {
    return { ok: false, reason: "That PIN is already used by someone else — pick another." };
  }
  const hash = await sha256Hex(normalizeRecoveryCode(code));
  if (hash !== cur.recoveryHash) {
    return { ok: false, reason: "Recovery code doesn't match. Check for typos." };
  }

  // Success: set the new PIN (hashed) and burn the code (one-time use).
  users = users.map((u) =>
    u.id === userId ? { ...u, pin: "", pinHash: newPinHash, recoveryHash: undefined } : u,
  );
  notify();

  const { error } = await supabase
    .from("users")
    .update({
      pin: serializeUserAuth({ pinHash: newPinHash, roleOverride: roleOverrideFor(cur) }),
    })
    .eq("id", userId);
  if (error) {
    console.error("supabase: resetPinWithRecoveryCode", error);
    return { ok: false, reason: "Couldn't save the new PIN — check your connection." };
  }
  return { ok: true };
}

// ---------- ENTRIES ----------

export function getEntries(): Entry[] {
  return entries;
}
export function getEntryById(id: string): Entry | undefined {
  return entries.find((e) => e.id === id);
}
export function getEntriesByReceipt(receiptId: string): Entry[] {
  return entries.filter((e) => e.receiptId === receiptId);
}
export function getEntriesByUser(userId: string): Entry[] {
  return entries.filter((e) => e.loggedBy === userId);
}

export function addEntry(entry: Omit<Entry, "id" | "createdAt">): Entry {
  // Normalise incoming photos: a caller may pass a single photoUrl (legacy)
  // or a photoUrls array. Everything is stored as the media blob.
  const photos = entry.photoUrls ?? (entry.photoUrl ? [entry.photoUrl] : []);
  const history = entry.history ?? [];
  const full: Entry = {
    ...entry,
    photoUrls: photos,
    photoUrl: photos[0],
    history,
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  // We know this entry's media — seed the cache so nothing refetches it.
  _entryMediaCache.set(full.id, { photoUrls: photos, history });
  entries = [full, ...entries];
  notify();

  supabase.from("entries").insert({
    id: full.id,
    date: full.date,
    vendor: full.vendor,
    item: full.item,
    qty: full.qty,
    unit_price: full.unitPrice,
    total: full.total,
    category: full.category,
    paid_from: full.paidFrom,
    major_repair: full.majorRepair ?? false,
    receipt_id: full.receiptId ?? null,
    photo_url: serializeEntryMedia(photos, history),
    logged_by: full.loggedBy,
    created_at: full.createdAt,
    flags: full.flags,
    notes: full.notes,
  }).then(({ error }) => {
    if (error) console.error("supabase: addEntry", error);
  });

  return full;
}

export function updateEntry(id: string, updates: Partial<Entry>): void {
  const before = entries.find((e) => e.id === id);
  entries = entries.map((e) => (e.id === id ? { ...e, ...updates } : e));
  notify();

  // Editing an entry from a closed (pre-reset) period must not shift today's
  // PCF balance — it's already folded into the reset figure. If this edit
  // changed the entry's drawdown contribution, nudge the reset to absorb it.
  if (before && (updates.total !== undefined || updates.paidFrom !== undefined)) {
    void freezeClosedPeriodDelta(
      before.createdAt,
      pcfDrawContribution(before),
      pcfDrawContribution(entries.find((e) => e.id === id)),
      { summary: `Edited “${before.item}” (${shortDate(before.date)}) in a closed period` },
    );
  }

  // NOTE: photos and history live in the packed `photo_url` blob and are
  // written only via setEntryPhotos / appendEntryHistory — never here — so a
  // field edit can't accidentally clobber the receipt photos or audit log.
  const dbUpdates: Record<string, unknown> = {};
  if (updates.date !== undefined) dbUpdates.date = updates.date;
  if (updates.vendor !== undefined) dbUpdates.vendor = updates.vendor;
  if (updates.item !== undefined) dbUpdates.item = updates.item;
  if (updates.qty !== undefined) dbUpdates.qty = updates.qty;
  if (updates.unitPrice !== undefined) dbUpdates.unit_price = updates.unitPrice;
  if (updates.total !== undefined) dbUpdates.total = updates.total;
  if (updates.category !== undefined) dbUpdates.category = updates.category;
  if (updates.paidFrom !== undefined) dbUpdates.paid_from = updates.paidFrom;
  if (updates.majorRepair !== undefined) dbUpdates.major_repair = updates.majorRepair;
  if (updates.receiptId !== undefined) dbUpdates.receipt_id = updates.receiptId;
  if (updates.flags !== undefined) dbUpdates.flags = updates.flags;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

  if (Object.keys(dbUpdates).length === 0) return;
  supabase.from("entries").update(dbUpdates).eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: updateEntry", error);
  });
}

/**
 * Replace the full set of receipt photos on an entry (used by the entry
 * detail receipt manager: add, replace, delete then Save). Optionally
 * records an audit entry describing the change.
 */
export function setEntryPhotos(
  id: string,
  photoUrls: string[],
  record?: AuditRecord,
): void {
  // Photos + history share one packed DB column, so we must have the current
  // blob before writing — otherwise a save made before the lazy media fetch
  // finished would silently erase the entry's edit history (or photos).
  (async () => {
    await ensureEntryMedia(id);
    if (!_entryMediaCache.has(id)) {
      console.error("setEntryPhotos: media not loaded (offline?) — write skipped to avoid data loss");
      return;
    }
    const cur = entries.find((e) => e.id === id);
    if (!cur) return;
    const history = record ? [...(cur.history ?? []), record] : cur.history ?? [];
    _entryMediaCache.set(id, { photoUrls, history });
    entries = entries.map((e) =>
      e.id === id ? { ...e, photoUrls, photoUrl: photoUrls[0], history } : e,
    );
    notify();

    const { error } = await supabase
      .from("entries")
      .update({ photo_url: serializeEntryMedia(photoUrls, history) })
      .eq("id", id);
    if (error) console.error("supabase: setEntryPhotos", error);
  })();
}

/** Append one audit record to an entry's edit history. */
export function appendEntryHistory(id: string, record: AuditRecord): void {
  // Same blob-sharing caveat as setEntryPhotos: never write photo_url
  // without the current photos in hand.
  (async () => {
    await ensureEntryMedia(id);
    if (!_entryMediaCache.has(id)) {
      console.error("appendEntryHistory: media not loaded (offline?) — write skipped to avoid data loss");
      return;
    }
    const cur = entries.find((e) => e.id === id);
    if (!cur) return;
    const history = [...(cur.history ?? []), record];
    const photoUrls = cur.photoUrls ?? (cur.photoUrl ? [cur.photoUrl] : []);
    _entryMediaCache.set(id, { photoUrls, history });
    entries = entries.map((e) => (e.id === id ? { ...e, history } : e));
    notify();

    const { error } = await supabase
      .from("entries")
      .update({ photo_url: serializeEntryMedia(photoUrls, history) })
      .eq("id", id);
    if (error) console.error("supabase: appendEntryHistory", error);
  })();
}

/** Same day-of-month N months after an ISO date, clamped to month length. */
function addMonthsClamped(dateIso: string, add: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = (m - 1) + add;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/**
 * Spread a one-time expense across N consecutive months — for costs paid once
 * but valid over a period (annual compliance fees, yearly permits, etc.).
 *
 * The original entry KEEPS its id, date, receipt link, photos, flags, and
 * notes, and becomes part 1/N with total/N; N−1 sibling entries are created
 * in the following months (same day, clamped). Because these are ordinary
 * entries, every existing sum — monthly analytics, charts, Excel, receipt
 * reconciliation, and the (all-time) PCF balance — stays correct with no
 * special cases: the parts add up to exactly the original amount.
 */
export async function spreadEntryAcrossMonths(
  entryId: string,
  months: number,
  byUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return { ok: false, reason: "Entry not found — refresh and try again." };
  if (!Number.isInteger(months) || months < 2 || months > 12) {
    return { ok: false, reason: "Pick between 2 and 12 months." };
  }
  if (!(entry.total > 0)) return { ok: false, reason: "This entry has no amount to spread." };

  // Don't spread an entry from a period already reconciled: splitting it
  // rewrites month totals inside a closed period and creates siblings that
  // would move the current balance. Closed periods stay frozen.
  const spreadReset = latestPcfReset();
  if (spreadReset && entry.createdAt && entry.createdAt <= (spreadReset.createdAt ?? "")) {
    return {
      ok: false,
      reason: `This entry is from a period already reconciled (closed on ${spreadReset.date}), so it can't be spread.`,
    };
  }

  // Split to the centavo: equal parts, first part absorbs the remainder so
  // the sum is exactly the original total.
  const cents = Math.round(entry.total * 100);
  const baseCents = Math.floor(cents / months);
  const firstCents = cents - baseCents * (months - 1);
  const partTotal = (i: number) => (i === 0 ? firstCents : baseCents) / 100;
  const partItem = (i: number) => `${entry.item} (${i + 1}/${months})`;

  const now = new Date().toISOString();
  const siblings: Entry[] = Array.from({ length: months - 1 }, (_, k) => {
    const i = k + 1;
    return {
      id: `e_${Math.random().toString(36).slice(2, 10)}`,
      date: addMonthsClamped(entry.date, i),
      vendor: entry.vendor,
      item: partItem(i),
      qty: 1,
      unitPrice: partTotal(i),
      total: partTotal(i),
      category: entry.category,
      paidFrom: entry.paidFrom,
      majorRepair: entry.majorRepair,
      receiptId: entry.receiptId,
      photoUrls: [],
      loggedBy: entry.loggedBy,
      createdAt: now,
      flags: [],
      notes: [],
      history: [
        {
          at: now,
          by: byUserId,
          summary: `Part of “${entry.item}” (${peso0(entry.total)}) spread across ${months} months`,
        },
      ],
    };
  });

  // Server-first: insert the siblings, then shrink the original. If the
  // sibling insert fails nothing has changed; if the original update fails we
  // remove the siblings again rather than leave a double-counted total.
  const prev = { item: entry.item, qty: entry.qty, unitPrice: entry.unitPrice, total: entry.total };
  try {
    const { error: insErr } = await supabase.from("entries").insert(
      siblings.map((e) => ({
        id: e.id,
        date: e.date,
        vendor: e.vendor,
        item: e.item,
        qty: e.qty,
        unit_price: e.unitPrice,
        total: e.total,
        category: e.category,
        paid_from: e.paidFrom,
        major_repair: e.majorRepair ?? false,
        receipt_id: e.receiptId ?? null,
        photo_url: serializeEntryMedia([], e.history ?? []),
        logged_by: e.loggedBy,
        created_at: e.createdAt,
        flags: e.flags,
        notes: e.notes,
      })),
    );
    if (insErr) {
      console.error("supabase: spreadEntryAcrossMonths insert", insErr);
      return { ok: false, reason: "Couldn't save — check your internet and try again." };
    }
    const { error: updErr } = await supabase
      .from("entries")
      .update({ item: partItem(0), qty: 1, unit_price: partTotal(0), total: partTotal(0) })
      .eq("id", entryId);
    if (updErr) {
      console.error("supabase: spreadEntryAcrossMonths update", updErr);
      await supabase.from("entries").delete().in("id", siblings.map((e) => e.id));
      return { ok: false, reason: "Couldn't save — check your internet and try again." };
    }
  } catch (err) {
    console.error("supabase: spreadEntryAcrossMonths threw", err);
    return { ok: false, reason: "No connection. Check your internet and try again." };
  }

  // Server confirmed — reflect locally.
  for (const e of siblings) {
    _entryMediaCache.set(e.id, { photoUrls: [], history: e.history ?? [] });
  }
  entries = [
    ...siblings,
    ...entries.map((e) =>
      e.id === entryId
        ? { ...e, item: partItem(0), qty: 1, unitPrice: partTotal(0), total: partTotal(0) }
        : e,
    ),
  ];
  notify();
  appendEntryHistory(entryId, {
    at: now,
    by: byUserId,
    summary: `Spread ${peso0(prev.total)} across ${months} months (this entry is part 1/${months})`,
  });

  const siblingIds = siblings.map((e) => e.id);
  setUndoable(`Spread “${prev.item}” across ${months} months`, async () => {
    const ok = await _hardDeleteEntries(siblingIds);
    entries = entries.map((e) => (e.id === entryId ? { ...e, ...prev } : e));
    notify();
    const { error } = await supabase
      .from("entries")
      .update({ item: prev.item, qty: prev.qty, unit_price: prev.unitPrice, total: prev.total })
      .eq("id", entryId);
    if (error) {
      console.error("supabase: undo spreadEntryAcrossMonths", error);
      return { ok: false, reason: "Undo failed — refresh to check." };
    }
    return { ok };
  });

  return { ok: true };
}

/** Whole-peso display for history summaries (₱12,000 not ₱12,000.00). */
function peso0(n: number): string {
  return `₱${Math.round(n).toLocaleString()}`;
}

/** Readable short date for log summaries, e.g. "Jan 15, 2026". */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function addNoteToEntry(
  entryId: string,
  note: Omit<Note, "id" | "createdAt">,
): void {
  const newNote: Note = {
    ...note,
    id: `n_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  entries = entries.map((e) =>
    e.id === entryId ? { ...e, notes: [...e.notes, newNote] } : e,
  );
  notify();

  const entry = entries.find((e) => e.id === entryId);
  if (entry) {
    supabase.from("entries").update({ notes: entry.notes }).eq("id", entryId).then(({ error }) => {
      if (error) console.error("supabase: addNoteToEntry", error);
    });
  }
}

export function resolveFlag(entryId: string, flagKind: string, resolverId: string): void {
  entries = entries.map((e) => {
    if (e.id !== entryId) return e;
    return {
      ...e,
      flags: e.flags.map((f) =>
        f.kind === flagKind && !f.resolved
          ? { ...f, resolved: true, resolvedBy: resolverId, resolvedAt: new Date().toISOString() }
          : f,
      ),
    };
  });
  notify();

  const entry = entries.find((e) => e.id === entryId);
  if (entry) {
    supabase.from("entries").update({ flags: entry.flags }).eq("id", entryId).then(({ error }) => {
      if (error) console.error("supabase: resolveFlag", error);
    });
  }
}

// ---------- RECEIPTS ----------

export function getReceipts(): Receipt[] {
  return receipts;
}
export function getReceiptById(id: string): Receipt | undefined {
  return receipts.find((r) => r.id === id);
}

export function addReceipt(r: Omit<Receipt, "id">): Receipt {
  const full: Receipt = {
    ...r,
    id: `r_${Math.random().toString(36).slice(2, 10)}`,
  };
  _receiptPhotoCache.set(full.id, full.photoUrl ?? "");
  receipts = [full, ...receipts];
  notify();

  supabase.from("receipts").insert({
    id: full.id,
    vendor: full.vendor,
    date: full.date,
    photo_url: full.photoUrl,
    ocr_text: full.ocrText ?? null,
    total_typed: full.totalTyped,
    captured_by: full.capturedBy,
    status: full.status,
  }).then(({ error }) => {
    if (error) console.error("supabase: addReceipt", error);
  });

  return full;
}

export function updateReceiptStatus(id: string, status: Receipt["status"]): void {
  receipts = receipts.map((r) => (r.id === id ? { ...r, status } : r));
  notify();

  supabase.from("receipts").update({ status }).eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: updateReceiptStatus", error);
  });
}

// ---------- UNDO (session-scoped: reverse YOUR most recent action) ----------
// Saves hit the shared DB immediately, so "undo" can't be a global time
// machine. Instead each major action (log purchase, add items, remove item,
// mark complete) registers an inverse; the header/footer UndoToast offers it
// for a short window. Only the latest action is held — a new action replaces
// the previous undoable.

type UndoFn = () => Promise<{ ok: boolean; reason?: string }>;
let _undo: { label: string; fn: UndoFn } | null = null;
let _undoSeq = 0;

function setUndoable(label: string, fn: UndoFn): void {
  _undo = { label, fn };
  _undoSeq += 1;
  notify();
}

/** Current undoable (label + a seq that changes when a new one is registered). */
export function getUndoable(): { label: string; seq: number } | null {
  return _undo ? { label: _undo.label, seq: _undoSeq } : null;
}

export function clearUndoable(): void {
  if (_undo) {
    _undo = null;
    notify();
  }
}

export async function performUndo(): Promise<{ ok: boolean; reason?: string }> {
  const u = _undo;
  if (!u) return { ok: false, reason: "Nothing to undo." };
  _undo = null;
  notify();
  try {
    return await u.fn();
  } catch (err) {
    console.error("supabase: performUndo threw", err);
    return { ok: false, reason: "Undo failed — refresh to check the current state." };
  }
}

/** Hard-delete entries by id (used by undo inverses). FK-safe on its own. */
async function _hardDeleteEntries(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const { error } = await supabase.from("entries").delete().in("id", ids);
  if (error) {
    console.error("supabase: _hardDeleteEntries", error);
    return false;
  }
  entries = entries.filter((e) => !ids.includes(e.id));
  ids.forEach((id) => _entryMediaCache.delete(id));
  return true;
}

/**
 * Log a whole purchase in one go: one receipt (photo stored once) plus a
 * line-item Entry per item, each linked to that receipt. This is what the
 * "Log new expense" screen calls — it's why staff no longer have to
 * re-upload the same receipt for every item.
 *
 * `receiptTotal` is the optional printed total for the verify-against-receipt
 * check; when omitted it defaults to the sum of the line items (so the
 * receipt reconciles cleanly).
 */
export async function addPurchase(input: {
  vendor: string;
  date: string;
  photoUrl?: string;
  paidFrom: Entry["paidFrom"];
  capturedBy: string;
  receiptTotal?: number;
  /** VAT already included in the receipt total — informational. */
  vatAmount?: number;
  items: Array<{
    item: string;
    qty: number;
    unitPrice: number;
    total: number;
    category: string;
    majorRepair?: boolean;
    /** Personal purchase — keep on the receipt but don't deduct from PCF. */
    isPersonal?: boolean;
    flags: Entry["flags"];
  }>;
}): Promise<
  | { ok: true; receipt: Receipt; entries: Entry[] }
  | { ok: false; reason: string }
> {
  const sum = input.items.reduce((s, it) => s + it.total, 0);
  const totalTyped = input.receiptTotal ?? sum;
  const diff = sum - totalTyped;
  const status: Receipt["status"] =
    Math.abs(diff) <= 0.5 ? "reconciled" : diff < 0 ? "unfinished" : "mismatch";

  const now = new Date().toISOString();
  const receipt: Receipt = {
    id: `r_${Math.random().toString(36).slice(2, 10)}`,
    vendor: input.vendor,
    date: input.date,
    photoUrl: input.photoUrl ?? "",
    totalTyped,
    capturedBy: input.capturedBy,
    status,
  };
  const created: Entry[] = input.items.map((it) => ({
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    date: input.date,
    vendor: input.vendor,
    item: it.item,
    qty: it.qty,
    unitPrice: it.unitPrice,
    total: it.total,
    category: it.category,
    paidFrom: input.paidFrom,
    majorRepair: it.majorRepair,
    receiptId: receipt.id,
    photoUrls: [],
    loggedBy: input.capturedBy,
    createdAt: now,
    flags: it.flags,
    notes: [],
    history: [],
  }));

  // Personal line items + VAT ride in the receipt's ocr_text blob.
  const personalEntryIds = created
    .filter((_, i) => input.items[i].isPersonal)
    .map((e) => e.id);
  receipt.personalEntryIds = personalEntryIds.length > 0 ? personalEntryIds : undefined;
  receipt.vatAmount = input.vatAmount && input.vatAmount > 0 ? input.vatAmount : undefined;
  const receiptOcr = serializeReceiptOcrFor(receipt);

  // Persist FIRST, then update local state. This used to be optimistic
  // (instant local update + fire-and-forget writes), which meant a failed
  // write — flaky Wi-Fi, mid-deploy hiccup — looked saved on screen and
  // silently vanished on the next refresh. Staff lost real entries that
  // way; an expense tracker must not pretend money was recorded.
  //
  // Order matters: the entries' receipt_id has a foreign key to
  // receipts.id, so the receipt row MUST exist before the entries insert.
  try {
    const { error: rErr } = await supabase.from("receipts").insert({
      id: receipt.id,
      vendor: receipt.vendor,
      date: receipt.date,
      photo_url: receipt.photoUrl,
      ocr_text: receiptOcr,
      total_typed: receipt.totalTyped,
      captured_by: receipt.capturedBy,
      status: receipt.status,
    });
    if (rErr) {
      console.error("supabase: addPurchase receipt", rErr);
      return { ok: false, reason: "Couldn't reach the server. Check your internet and tap Save again — your items are still here." };
    }
    const { error: eErr } = await supabase.from("entries").insert(
      created.map((e) => ({
        id: e.id,
        date: e.date,
        vendor: e.vendor,
        item: e.item,
        qty: e.qty,
        unit_price: e.unitPrice,
        total: e.total,
        category: e.category,
        paid_from: e.paidFrom,
        major_repair: e.majorRepair ?? false,
        receipt_id: e.receiptId ?? null,
        photo_url: null,
        logged_by: e.loggedBy,
        created_at: e.createdAt,
        flags: e.flags,
        notes: e.notes,
      })),
    );
    if (eErr) {
      console.error("supabase: addPurchase entries", eErr);
      // Don't leave an orphaned receipt behind the failed line items.
      await supabase.from("receipts").delete().eq("id", receipt.id);
      return { ok: false, reason: "The save didn't go through. Check your internet and tap Save again — your items are still here." };
    }
  } catch (err) {
    console.error("supabase: addPurchase threw", err);
    return { ok: false, reason: "No connection. Check your internet and tap Save again — your items are still here." };
  }

  // Server confirmed — now reflect it locally. Seed the media caches too:
  // we know the photo and the (empty) entry media at creation.
  _receiptPhotoCache.set(receipt.id, receipt.photoUrl ?? "");
  for (const e of created) {
    _entryMediaCache.set(e.id, { photoUrls: [], history: [] });
  }
  receipts = [receipt, ...receipts];
  entries = [...created, ...entries];
  notify();

  // Undo = delete the whole purchase (entries first for FK, then receipt).
  const createdIds = created.map((e) => e.id);
  setUndoable(
    `Logged ${created.length} item${created.length === 1 ? "" : "s"} · ${receipt.vendor}`,
    async () => {
      const ok = await _hardDeleteEntries(createdIds);
      const { error } = await supabase.from("receipts").delete().eq("id", receipt.id);
      if (error) {
        console.error("supabase: undo addPurchase", error);
        return { ok: false, reason: "Undo failed — refresh to check." };
      }
      receipts = receipts.filter((r) => r.id !== receipt.id);
      _receiptPhotoCache.delete(receipt.id);
      notify();
      return { ok };
    },
  );

  return { ok: true, receipt, entries: created };
}

/**
 * Replace a receipt's photo with a better shot (blurry first attempt,
 * crumpled receipt re-photographed flat, etc.). Overwrites the old photo —
 * there's no photo history on receipts. Persist-first: local state only
 * updates after the server confirms.
 */
export async function replaceReceiptPhoto(
  receiptId: string,
  photoUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { ok: false, reason: "Receipt not found — refresh and try again." };
  try {
    const { error } = await supabase
      .from("receipts")
      .update({ photo_url: photoUrl })
      .eq("id", receiptId);
    if (error) {
      console.error("supabase: replaceReceiptPhoto", error);
      return { ok: false, reason: "Couldn't save the new photo — check your internet and try again." };
    }
  } catch (err) {
    console.error("supabase: replaceReceiptPhoto threw", err);
    return { ok: false, reason: "No connection — check your internet and try again." };
  }
  _receiptPhotoCache.set(receiptId, photoUrl);
  receipts = receipts.map((r) => (r.id === receiptId ? { ...r, photoUrl } : r));
  notify();
  return { ok: true };
}

/**
 * Append line items to an EXISTING receipt — used when someone realizes a
 * logged purchase is missing an item ("edit the entry, add to the same
 * receipt"). Vendor/date/funding come from the receipt's purchase; the
 * receipt's reconciliation status is recomputed against the new item sum.
 *
 * Same persist-first contract as addPurchase: the server must confirm
 * before local state changes, so a failed save is visible and retryable.
 */
export async function addItemsToReceipt(input: {
  receiptId: string;
  capturedBy: string;
  paidFrom: Entry["paidFrom"];
  items: Array<{
    item: string;
    qty: number;
    unitPrice: number;
    total: number;
    category: string;
    majorRepair?: boolean;
    isPersonal?: boolean;
    flags: Entry["flags"];
  }>;
}): Promise<{ ok: true; entries: Entry[] } | { ok: false; reason: string }> {
  const receipt = receipts.find((r) => r.id === input.receiptId);
  if (!receipt) {
    return { ok: false, reason: "Receipt not found — refresh and try again." };
  }
  if (input.items.length === 0) {
    return { ok: false, reason: "Add at least one item." };
  }

  const now = new Date().toISOString();
  const created: Entry[] = input.items.map((it) => ({
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    date: receipt.date,
    vendor: receipt.vendor,
    item: it.item,
    qty: it.qty,
    unitPrice: it.unitPrice,
    total: it.total,
    category: it.category,
    paidFrom: input.paidFrom,
    majorRepair: it.majorRepair,
    receiptId: receipt.id,
    photoUrls: [],
    loggedBy: input.capturedBy,
    createdAt: now,
    flags: it.flags,
    notes: [],
    history: [],
  }));

  try {
    const { error } = await supabase.from("entries").insert(
      created.map((e) => ({
        id: e.id,
        date: e.date,
        vendor: e.vendor,
        item: e.item,
        qty: e.qty,
        unit_price: e.unitPrice,
        total: e.total,
        category: e.category,
        paid_from: e.paidFrom,
        major_repair: e.majorRepair ?? false,
        receipt_id: e.receiptId ?? null,
        photo_url: null,
        logged_by: e.loggedBy,
        created_at: e.createdAt,
        flags: e.flags,
        notes: e.notes,
      })),
    );
    if (error) {
      console.error("supabase: addItemsToReceipt", error);
      return { ok: false, reason: "The save didn't go through. Check your internet and tap Save again — your items are still here." };
    }
  } catch (err) {
    console.error("supabase: addItemsToReceipt threw", err);
    return { ok: false, reason: "No connection. Check your internet and tap Save again — your items are still here." };
  }

  // Server confirmed — update local state and recompute the receipt status.
  // A settled receipt stays complete regardless of the new item sum.
  const priorStatus = receipt.status;
  const priorPersonal = receipt.personalEntryIds;
  const linkedAfter = [
    ...entries.filter((e) => e.receiptId === receipt.id),
    ...created,
  ];
  const status = receipt.settled ? "reconciled" : receiptStatusFor(receipt, linkedAfter);
  for (const e of created) {
    _entryMediaCache.set(e.id, { photoUrls: [], history: [] });
  }
  // Carry over any personal line items added in this batch.
  const newPersonal = created.filter((_, i) => input.items[i].isPersonal).map((e) => e.id);
  const mergedPersonal = [...(receipt.personalEntryIds ?? []), ...newPersonal];
  const personalEntryIds = mergedPersonal.length > 0 ? mergedPersonal : undefined;
  const ocr = serializeReceiptOcrFor(receipt, { personalEntryIds });
  entries = [...created, ...entries];
  receipts = receipts.map((r) => (r.id === receipt.id ? { ...r, status, personalEntryIds } : r));
  notify();

  supabase
    .from("receipts")
    .update({ status, ocr_text: ocr })
    .eq("id", receipt.id)
    .then(({ error }) => {
      if (error) console.error("supabase: addItemsToReceipt status", error);
    });

  // Undo = delete the just-added items and restore the receipt's prior status.
  const addedIds = created.map((e) => e.id);
  setUndoable(
    `Added ${created.length} item${created.length === 1 ? "" : "s"} · ${receipt.vendor}`,
    async () => {
      const ok = await _hardDeleteEntries(addedIds);
      receipts = receipts.map((r) =>
        r.id === receipt.id ? { ...r, status: priorStatus, personalEntryIds: priorPersonal } : r,
      );
      notify();
      const { error } = await supabase
        .from("receipts")
        .update({
          status: priorStatus,
          ocr_text: serializeReceiptOcrFor(receipt, { personalEntryIds: priorPersonal }),
        })
        .eq("id", receipt.id);
      if (error) console.error("supabase: undo addItemsToReceipt", error);
      return { ok };
    },
  );

  return { ok: true, entries: created };
}

// ---------- RECEIPT RESTRUCTURING (experimental merge / split / delete) ----------

/** Recompute a receipt's reconciliation status from its current line items. */
function receiptStatusFor(receipt: Receipt, linked: Entry[]): Receipt["status"] {
  return reconciliationStatus(receipt.totalTyped, linked.map((e) => e.total)).status;
}

/**
 * Merge a duplicate receipt into the one being kept: its line items move to
 * the kept receipt, then the duplicate receipt row is deleted. If the kept
 * receipt has no photo and the duplicate does, the photo moves too.
 *
 * Persistence order matters (FK): the entries must be re-pointed at the kept
 * receipt BEFORE the duplicate is deleted, or the delete is rejected while
 * rows still reference it.
 */
export async function mergeReceipts(
  keepId: string,
  duplicateId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (keepId === duplicateId) return { ok: false, reason: "Pick a different receipt." };
  if (!receipts.find((r) => r.id === keepId) || !receipts.find((r) => r.id === duplicateId)) {
    return { ok: false, reason: "Receipt not found — refresh and try again." };
  }

  // Load both photos so we can carry the duplicate's over if needed.
  await Promise.all([ensureReceiptPhoto(keepId), ensureReceiptPhoto(duplicateId)]);
  const keep = receipts.find((r) => r.id === keepId)!;
  const duplicate = receipts.find((r) => r.id === duplicateId)!;
  const adoptPhoto = !keep.photoUrl && !!duplicate.photoUrl;
  const newPhoto = adoptPhoto ? duplicate.photoUrl : keep.photoUrl;

  const movedIds = entries.filter((e) => e.receiptId === duplicateId).map((e) => e.id);
  const linkedAfter = entries.filter(
    (e) => e.receiptId === keepId || e.receiptId === duplicateId,
  );
  const status = receiptStatusFor(keep, linkedAfter);

  // Optimistic local update.
  entries = entries.map((e) =>
    e.receiptId === duplicateId ? { ...e, receiptId: keepId } : e,
  );
  if (adoptPhoto) _receiptPhotoCache.set(keepId, newPhoto);
  _receiptPhotoCache.delete(duplicateId);
  receipts = receipts
    .filter((r) => r.id !== duplicateId)
    .map((r) => (r.id === keepId ? { ...r, photoUrl: newPhoto, status } : r));
  notify();

  // Persist, in FK-safe order.
  if (movedIds.length > 0) {
    const { error } = await supabase
      .from("entries")
      .update({ receipt_id: keepId })
      .in("id", movedIds);
    if (error) {
      console.error("supabase: mergeReceipts entries", error);
      return { ok: false, reason: "Couldn't move the line items — refresh and try again." };
    }
  }
  const keepUpdate: Record<string, unknown> = { status };
  if (adoptPhoto) keepUpdate.photo_url = newPhoto;
  const { error: updErr } = await supabase.from("receipts").update(keepUpdate).eq("id", keepId);
  if (updErr) console.error("supabase: mergeReceipts keep", updErr);
  const { error: delErr } = await supabase.from("receipts").delete().eq("id", duplicateId);
  if (delErr) {
    console.error("supabase: mergeReceipts delete", delErr);
    return { ok: false, reason: "Items were moved, but the duplicate receipt couldn't be deleted." };
  }
  return { ok: true };
}

/**
 * Split one line item off its receipt into a standalone entry. The receipt
 * photo is copied onto the entry so it keeps its evidence, and a history
 * record marks the split. If that was the receipt's last line item, the
 * now-empty receipt is deleted.
 */
export async function splitEntryFromReceipt(
  entryId: string,
  byUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry?.receiptId) return { ok: false, reason: "This entry isn't on a receipt." };
  const receiptId = entry.receiptId;

  // Need the receipt photo (to copy) and the entry's media blob (to merge into).
  await Promise.all([ensureReceiptPhoto(receiptId), ensureEntryMedia(entryId)]);
  if (!_entryMediaCache.has(entryId) || !_receiptPhotoCache.has(receiptId)) {
    return { ok: false, reason: "Couldn't load the photos — check your connection and try again." };
  }

  const cur = entries.find((e) => e.id === entryId)!;
  const receipt = receipts.find((r) => r.id === receiptId);
  const receiptPhoto = _receiptPhotoCache.get(receiptId) ?? "";
  const photoUrls = receiptPhoto
    ? [...(cur.photoUrls ?? []), receiptPhoto]
    : cur.photoUrls ?? [];
  const history: AuditRecord[] = [
    ...(cur.history ?? []),
    {
      at: new Date().toISOString(),
      by: byUserId,
      summary: `Split off its receipt (${cur.vendor}) into a standalone entry`,
    },
  ];
  const remaining = entries.filter((e) => e.receiptId === receiptId && e.id !== entryId);
  const deleteReceipt = !!receipt && remaining.length === 0;
  const newStatus = receipt && !deleteReceipt ? receiptStatusFor(receipt, remaining) : undefined;

  // Optimistic local update.
  _entryMediaCache.set(entryId, { photoUrls, history });
  entries = entries.map((e) =>
    e.id === entryId
      ? { ...e, receiptId: undefined, photoUrls, photoUrl: photoUrls[0], history }
      : e,
  );
  if (deleteReceipt) {
    receipts = receipts.filter((r) => r.id !== receiptId);
    _receiptPhotoCache.delete(receiptId);
  } else if (newStatus) {
    receipts = receipts.map((r) => (r.id === receiptId ? { ...r, status: newStatus } : r));
  }
  notify();

  // Persist: detach the entry first (clears the FK reference), then the receipt.
  const { error: entErr } = await supabase
    .from("entries")
    .update({ receipt_id: null, photo_url: serializeEntryMedia(photoUrls, history) })
    .eq("id", entryId);
  if (entErr) {
    console.error("supabase: splitEntryFromReceipt entry", entErr);
    return { ok: false, reason: "Couldn't split the entry — refresh and try again." };
  }
  if (deleteReceipt) {
    const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
    if (error) console.error("supabase: splitEntryFromReceipt delete receipt", error);
  } else if (newStatus) {
    const { error } = await supabase
      .from("receipts")
      .update({ status: newStatus })
      .eq("id", receiptId);
    if (error) console.error("supabase: splitEntryFromReceipt status", error);
  }
  return { ok: true };
}

/**
 * Delete an entry outright — for true duplicates (the same purchase logged
 * twice). Removing a PCF entry raises the PCF balance accordingly, which is
 * correct for a duplicate. If the entry was on a receipt, the receipt's
 * reconciliation status is recomputed (the receipt itself is kept, photo and
 * all, even if this was its last line item).
 */
export async function deleteEntry(
  id: string,
  byUserId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return { ok: false, reason: "Entry not found." };
  const receiptId = entry.receiptId;

  // Capture the entry's exact stored row (incl. the packed photo_url blob)
  // BEFORE deleting, so undo can re-create it faithfully — even if its
  // photos/history were never lazily loaded into memory.
  const { data: pre } = await supabase
    .from("entries")
    .select("photo_url")
    .eq("id", id)
    .maybeSingle();
  const rawPhotoUrl = (pre?.photo_url ?? null) as string | null;
  const snapshot = entry;
  // Drawdown this entry contributes right now — captured before we mutate the
  // receipt's personal set, so a closed-period deletion can be neutralised.
  const drawBefore = pcfDrawContribution(entry);

  entries = entries.filter((e) => e.id !== id);
  _entryMediaCache.delete(id);

  // When the deleted entry was a line item on a receipt, recompute the
  // receipt's reconciliation status against the remaining items AND log the
  // deletion so there's a record of what was removed (the entry itself is
  // gone). The log lives in the receipt's ocr_text blob.
  let newStatus: Receipt["status"] | undefined;
  let newOcr: string | null | undefined;
  // Prior receipt state, captured for undo.
  const priorReceipt = receiptId ? receipts.find((r) => r.id === receiptId) : undefined;
  const priorStatus = priorReceipt?.status;
  const priorDeletions = priorReceipt?.deletions;
  const priorSettled = priorReceipt?.settled;
  const priorOcrText = priorReceipt?.ocrText;
  const priorPersonal = priorReceipt?.personalEntryIds;
  const priorVat = priorReceipt?.vatAmount;
  if (receiptId) {
    const receipt = priorReceipt;
    if (receipt) {
      const remaining = entries.filter((e) => e.receiptId === receiptId);
      // A settled receipt stays complete even as line items change.
      newStatus = receipt.settled ? "reconciled" : receiptStatusFor(receipt, remaining);
      const record: AuditRecord = {
        at: new Date().toISOString(),
        by: byUserId ?? entry.loggedBy,
        summary: `Deleted line item “${entry.item}” · ₱${Math.round(entry.total).toLocaleString()}`,
      };
      const deletions = [...(receipt.deletions ?? []), record];
      // If the removed line item was a personal purchase, drop it from the set.
      const trimmedPersonal = receipt.personalEntryIds?.filter((pid) => pid !== id);
      const personalEntryIds =
        trimmedPersonal && trimmedPersonal.length > 0 ? trimmedPersonal : undefined;
      newOcr = serializeReceiptOcrFor(receipt, { deletions, personalEntryIds });
      receipts = receipts.map((r) =>
        r.id === receiptId ? { ...r, status: newStatus!, deletions, personalEntryIds } : r,
      );
    }
  }
  notify();

  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) {
    console.error("supabase: deleteEntry", error);
    return { ok: false, reason: "Couldn't delete the entry — refresh and try again." };
  }
  if (receiptId && newStatus) {
    const { error: stErr } = await supabase
      .from("receipts")
      .update({ status: newStatus, ocr_text: newOcr })
      .eq("id", receiptId);
    if (stErr) console.error("supabase: deleteEntry receipt status", stErr);
  }

  // If this entry was in a closed (pre-reset) period, removing its drawdown
  // would inflate the current balance. Freeze the period by nudging the reset.
  await freezeClosedPeriodDelta(snapshot.createdAt, drawBefore, 0, {
    summary: `Deleted “${snapshot.item}” (${shortDate(snapshot.date)}) from a closed period`,
    by: byUserId ?? snapshot.loggedBy,
  });

  // Undo = re-create the entry exactly, and roll the receipt back to its
  // pre-deletion status + deletion log.
  setUndoable(`Removed “${snapshot.item}”`, async () => {
    const { error: insErr } = await supabase.from("entries").insert({
      id: snapshot.id,
      date: snapshot.date,
      vendor: snapshot.vendor,
      item: snapshot.item,
      qty: snapshot.qty,
      unit_price: snapshot.unitPrice,
      total: snapshot.total,
      category: snapshot.category,
      paid_from: snapshot.paidFrom,
      major_repair: snapshot.majorRepair ?? false,
      receipt_id: snapshot.receiptId ?? null,
      photo_url: rawPhotoUrl,
      logged_by: snapshot.loggedBy,
      created_at: snapshot.createdAt,
      flags: snapshot.flags,
      notes: snapshot.notes,
    });
    if (insErr) {
      console.error("supabase: undo deleteEntry", insErr);
      return { ok: false, reason: "Undo failed — refresh to check." };
    }
    const media = parseEntryMedia(rawPhotoUrl);
    _entryMediaCache.set(snapshot.id, media);
    entries = [
      { ...snapshot, photoUrls: media.photoUrls, photoUrl: media.photoUrls[0], history: media.history },
      ...entries,
    ];
    // Restore the closed-period freeze we applied on delete (reverse the nudge).
    await freezeClosedPeriodDelta(snapshot.createdAt, 0, drawBefore, {
      summary: `Restored “${snapshot.item}” (${shortDate(snapshot.date)})`,
      by: byUserId ?? snapshot.loggedBy,
    });
    if (receiptId && priorReceipt) {
      receipts = receipts.map((r) =>
        r.id === receiptId
          ? {
              ...r,
              status: priorStatus!,
              deletions: priorDeletions,
              settled: priorSettled,
              ocrText: priorOcrText,
              personalEntryIds: priorPersonal,
              vatAmount: priorVat,
            }
          : r,
      );
      await supabase
        .from("receipts")
        .update({
          status: priorStatus,
          ocr_text: serializeReceiptOcr({
            ocrText: priorOcrText,
            deletions: priorDeletions ?? [],
            settled: priorSettled,
            personalEntryIds: priorPersonal,
            vatAmount: priorVat,
          }),
        })
        .eq("id", receiptId);
    }
    notify();
    return { ok: true };
  });

  return { ok: true };
}

// ---------- PCF LEDGER ----------

export function getPcfLedger(): PcfLedgerEntry[] {
  return pcfLedger;
}

/**
 * Set of entry ids marked as personal purchases across all receipts. These are
 * line items paid with someone's own money — kept on the receipt but excluded
 * from the petty cash drawdown. Built from the receipts' ocr_text blobs, which
 * load eagerly, so the PCF balance is correct without fetching photos.
 */
export function getPersonalEntryIds(): Set<string> {
  const set = new Set<string>();
  for (const r of receipts) {
    for (const id of r.personalEntryIds ?? []) set.add(id);
  }
  return set;
}

/** Sum of PCF-funded entry totals, excluding personal purchases. */
export function getPcfDrawdownTotal(entryList: Entry[] = entries): number {
  const personal = getPersonalEntryIds();
  return entryList
    .filter((e) => e.paidFrom === "pcf" && !personal.has(e.id))
    .reduce((acc, e) => acc + e.total, 0);
}

export function getPcfBalance(): number {
  const topUps = pcfLedger
    .filter((p) => p.kind === "top-up" && p.status === "approved")
    .reduce((acc, p) => acc + p.amount, 0);
  return topUps - getPcfDrawdownTotal();
}

/**
 * The most recent "balance reset" ledger row, if any. clearPcfBalance folds
 * every entry that existed at reset time into one offsetting figure; reset
 * rows carry the `p_clear_` id prefix. Used to know which entries are in a
 * closed (reconciled) period.
 */
function latestPcfReset(): PcfLedgerEntry | undefined {
  return pcfLedger
    .filter((p) => p.kind === "top-up" && p.status === "approved" && p.id.startsWith("p_clear_"))
    .reduce<PcfLedgerEntry | undefined>(
      (latest, p) => (!latest || (p.createdAt ?? "") > (latest.createdAt ?? "") ? p : latest),
      undefined,
    );
}

/** How much this entry currently adds to the PCF drawdown (0 if not PCF / personal). */
function pcfDrawContribution(e: Entry | undefined | null): number {
  if (!e) return 0;
  return e.paidFrom === "pcf" && !isEntryPersonal(e.id) ? e.total : 0;
}

/**
 * Keep closed periods frozen. When a PCF entry that predates the most recent
 * balance reset changes how much it contributes to the drawdown (edited total,
 * funding source, personal flag, or deletion), that change would otherwise
 * move the *current* balance — the entry is already folded into the reset
 * figure, so the all-time sum would count the change twice (this is the bug
 * that let a deleted January expense inflate July's petty cash). We cancel it
 * by nudging the reset figure by the same delta, leaving today's balance
 * untouched. Post-reset entries are left alone — they legitimately move the
 * balance — and if no reset has been booked there's nothing to protect.
 *
 * The reset baseline is keyed on when the reset ROW was created, not the
 * entry's (often back-dated) expense date: the reset captured whatever rows
 * existed at reset time regardless of the date written on them.
 */
async function freezeClosedPeriodDelta(
  entryCreatedAt: string | undefined,
  oldContribution: number,
  newContribution: number,
  log?: { summary: string; by?: string },
): Promise<void> {
  const reset = latestPcfReset();
  if (!reset || !entryCreatedAt || entryCreatedAt > (reset.createdAt ?? "")) return;
  const delta = Math.round((newContribution - oldContribution) * 100) / 100;
  if (Math.abs(delta) < 0.005) return;
  const newAmount = Math.round((reset.amount + delta) * 100) / 100;
  pcfLedger = pcfLedger.map((p) => (p.id === reset.id ? { ...p, amount: newAmount } : p));
  notify();
  const { error } = await supabase
    .from("pcf_ledger")
    .update({ amount: newAmount })
    .eq("id", reset.id);
  if (error) console.error("supabase: freezeClosedPeriodDelta", error);

  // Record the adjustment so it's visible to admins rather than a silent
  // change to the reset figure. Best-effort: a log failure never blocks the
  // balance correction above.
  if (log) {
    pcfAdjustments = [
      ...pcfAdjustments,
      { at: new Date().toISOString(), by: log.by, delta, summary: log.summary },
    ];
    notify();
    await persistPcfAdjustments();
  }
}

/** Is this entry flagged as a personal purchase (excluded from PCF)? */
export function isEntryPersonal(entryId: string): boolean {
  return receipts.some((r) => r.personalEntryIds?.includes(entryId));
}

/**
 * Mark/unmark a line item as a personal purchase. The flag lives on the
 * entry's receipt (ocr_text blob), so the entry must belong to a receipt.
 * Excludes the amount from the PCF balance while keeping it on the receipt.
 */
export async function setEntryPersonal(
  entryId: string,
  isPersonal: boolean,
  byUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return { ok: false, reason: "Entry not found — refresh and try again." };
  if (!entry.receiptId) {
    return { ok: false, reason: "This entry isn't on a receipt, so it can't be marked personal." };
  }
  const receipt = receipts.find((r) => r.id === entry.receiptId);
  if (!receipt) return { ok: false, reason: "Receipt not found — refresh and try again." };

  const cur = receipt.personalEntryIds ?? [];
  const next = isPersonal
    ? Array.from(new Set([...cur, entryId]))
    : cur.filter((id) => id !== entryId);
  const personalEntryIds = next.length > 0 ? next : undefined;
  const prevPersonal = receipt.personalEntryIds;
  const ocr = serializeReceiptOcrFor(receipt, { personalEntryIds });

  receipts = receipts.map((r) => (r.id === receipt.id ? { ...r, personalEntryIds } : r));
  notify();

  const { error } = await supabase
    .from("receipts")
    .update({ ocr_text: ocr })
    .eq("id", receipt.id);
  if (error) {
    console.error("supabase: setEntryPersonal", error);
    receipts = receipts.map((r) =>
      r.id === receipt.id ? { ...r, personalEntryIds: prevPersonal } : r,
    );
    notify();
    return { ok: false, reason: "Couldn't save — check your internet and try again." };
  }

  // Toggling personal on a closed-period PCF entry changes its drawdown; keep
  // that period frozen so today's balance doesn't move.
  const wasPersonal = cur.includes(entryId);
  await freezeClosedPeriodDelta(
    entry.createdAt,
    entry.paidFrom === "pcf" && !wasPersonal ? entry.total : 0,
    entry.paidFrom === "pcf" && !isPersonal ? entry.total : 0,
    {
      summary: `${isPersonal ? "Marked" : "Unmarked"} “${entry.item}” (${shortDate(entry.date)}) as personal`,
      by: byUserId,
    },
  );

  appendEntryHistory(entryId, {
    at: new Date().toISOString(),
    by: byUserId,
    summary: isPersonal
      ? "Marked as a personal purchase (excluded from PCF)"
      : "Unmarked personal purchase",
  });
  return { ok: true };
}

/**
 * Set (or clear, with null) the VAT amount already included in a receipt's
 * printed total. Informational only — no effect on PCF or reconciliation.
 */
export async function setReceiptVat(
  receiptId: string,
  vatAmount: number | null,
  byUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { ok: false, reason: "Receipt not found — refresh and try again." };
  const next = vatAmount && vatAmount > 0 ? vatAmount : undefined;
  const prev = receipt.vatAmount;
  const ocr = serializeReceiptOcrFor(receipt, { vatAmount: next });

  receipts = receipts.map((r) => (r.id === receiptId ? { ...r, vatAmount: next } : r));
  notify();

  const { error } = await supabase
    .from("receipts")
    .update({ ocr_text: ocr })
    .eq("id", receiptId);
  if (error) {
    console.error("supabase: setReceiptVat", error);
    receipts = receipts.map((r) => (r.id === receiptId ? { ...r, vatAmount: prev } : r));
    notify();
    return { ok: false, reason: "Couldn't save — check your internet and try again." };
  }
  void byUserId; // reserved for a future audit record
  return { ok: true };
}

export function reportPcfTopUp(input: {
  amount: number;
  date: string;
  reportedBy: string;
  note?: string;
}): PcfLedgerEntry {
  const full: PcfLedgerEntry = {
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    kind: "top-up",
    amount: input.amount,
    date: input.date,
    reportedBy: input.reportedBy,
    status: "pending",
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  pcfLedger = [full, ...pcfLedger];
  notify();

  supabase.from("pcf_ledger").insert({
    id: full.id,
    kind: full.kind,
    amount: full.amount,
    date: full.date,
    reported_by: full.reportedBy,
    status: full.status,
    note: full.note ?? null,
    created_at: full.createdAt,
  }).then(({ error }) => {
    if (error) console.error("supabase: reportPcfTopUp", error);
  });

  return full;
}

export function approvePcfTopUp(
  id: string,
  approverId: string,
  decisionNote?: string,
): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id
      ? { ...p, status: "approved", approvedBy: approverId, decisionNote: decisionNote?.trim() || undefined }
      : p,
  );
  notify();

  supabase.from("pcf_ledger").update({
    status: "approved",
    approved_by: approverId,
    decision_note: decisionNote?.trim() || null,
  }).eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: approvePcfTopUp", error);
  });
}

export function rejectPcfTopUp(
  id: string,
  approverId: string,
  decisionNote?: string,
): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id
      ? { ...p, status: "rejected", approvedBy: approverId, decisionNote: decisionNote?.trim() || undefined }
      : p,
  );
  notify();

  supabase.from("pcf_ledger").update({
    status: "rejected",
    approved_by: approverId,
    decision_note: decisionNote?.trim() || null,
  }).eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: rejectPcfTopUp", error);
  });
}

/**
 * Admin: reconcile the PCF by booking a `p_clear_` marker entry. This marker
 * is what "closes" a period — everything created up to it becomes settled, so
 * later edits to those expenses are absorbed by it (see freezeClosedPeriodDelta)
 * rather than moving the current balance.
 *
 * Two modes (`zero`):
 *   - zero: true  → also reset the balance to ₱0, by sizing the marker to
 *                   offset the current balance (start fresh from a known state).
 *   - zero: false → LOCK ONLY: the marker's amount is ₱0, so the balance is
 *                   carried forward unchanged. Closes the month without zeroing
 *                   the running float.
 * Either way the marker anchors the closed-period freeze; nothing is deleted.
 *
 * `date` is the day the marker is booked on. The admin picks which month
 * they're closing, so a run in early June to close May lands the entry in May
 * (dated to the last day of that month). Defaults to today when omitted.
 */
export function clearPcfBalance(
  adminId: string,
  opts?: { date?: string; note?: string; zero?: boolean },
): void {
  const zero = opts?.zero ?? true;
  const currentBalance = getPcfBalance();

  // Reset-to-zero books a top-up of -balance (amount sign carries the meaning;
  // the Supabase numeric column is happy with either sign). Lock-only books a
  // ₱0 marker so the balance carries forward untouched. Both anchor the freeze.
  const amount = zero ? -currentBalance : 0;
  const now = new Date().toISOString();
  const datePart = opts?.date?.trim() || now.slice(0, 10);
  const carried = `₱${currentBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const full: PcfLedgerEntry = {
    id: `p_clear_${Math.random().toString(36).slice(2, 10)}`,
    kind: "top-up",
    amount,
    date: datePart,
    reportedBy: adminId,
    approvedBy: adminId,
    status: "approved",
    note:
      opts?.note?.trim() ||
      (zero
        ? `Balance reset by admin — reconciled to ₱0 on ${datePart}`
        : `Period locked by admin on ${datePart} — balance ${carried} carried forward`),
    createdAt: now,
  };
  pcfLedger = [full, ...pcfLedger];
  notify();

  supabase
    .from("pcf_ledger")
    .insert({
      id: full.id,
      kind: full.kind,
      amount: full.amount,
      date: full.date,
      reported_by: full.reportedBy,
      approved_by: full.approvedBy,
      status: full.status,
      note: full.note ?? null,
      created_at: full.createdAt,
    })
    .then(({ error }) => {
      if (error) console.error("supabase: clearPcfBalance", error);
    });
}

export function resolvePcfRejection(id: string, resolverId: string): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id && p.status === "rejected" && !p.resolved
      ? { ...p, resolved: true, resolvedBy: resolverId, resolvedAt: new Date().toISOString() }
      : p,
  );
  notify();

  const entry = pcfLedger.find((p) => p.id === id);
  if (entry) {
    supabase.from("pcf_ledger").update({
      resolved: true,
      resolved_by: resolverId,
      resolved_at: entry.resolvedAt,
    }).eq("id", id).then(({ error }) => {
      if (error) console.error("supabase: resolvePcfRejection", error);
    });
  }
}
