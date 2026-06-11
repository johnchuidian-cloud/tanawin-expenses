"use client";

import { supabase } from "./supabase";
import { BUILTIN_CATEGORIES } from "./types";
import type {
  AuditRecord,
  Category,
  CategoryDef,
  Entry,
  Note,
  PcfLedgerEntry,
  Receipt,
  User,
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

export async function bootstrapFromSupabase(): Promise<void> {
  if (_bootstrapped || _bootstrapping) return;
  _bootstrapping = true;

  try {
    const [usersRes, receiptsRes, entriesRes, pcfRes, catRes] = await Promise.all([
      supabase.from("users").select("*"),
      supabase.from("receipts").select(RECEIPT_COLS),
      supabase.from("entries").select(ENTRY_COLS).order("created_at", { ascending: false }),
      supabase.from("pcf_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("category_defs").select("*").eq("builtin", false),
    ]);

    if (usersRes.error || receiptsRes.error || entriesRes.error || pcfRes.error || catRes.error) {
      console.error("supabase: bootstrap failed", { usersRes, receiptsRes, entriesRes, pcfRes, catRes });
      scheduleBootstrapRetry();
      return;
    }

    users = usersRes.data!.map(mapUser);
    receipts = receiptsRes.data!.map(mapReceipt);
    entries = entriesRes.data!.map(mapEntry);
    pcfLedger = pcfRes.data!.map(mapPcfLedger);

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
    const [usersRes, receiptsRes, entriesRes, pcfRes, catRes] = await Promise.all([
      supabase.from("users").select("*"),
      supabase.from("receipts").select(RECEIPT_COLS),
      supabase.from("entries").select(ENTRY_COLS).order("created_at", { ascending: false }),
      supabase.from("pcf_ledger").select("*").order("created_at", { ascending: false }),
      supabase.from("category_defs").select("*").eq("builtin", false),
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
    users = usersRes.data!.map(mapUser);
    receipts = receiptsRes.data!.map(mapReceipt);
    entries = entriesRes.data!.map(mapEntry);
    pcfLedger = pcfRes.data!.map(mapPcfLedger);
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

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as User["role"],
    pin: row.pin as string,
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

function mapReceipt(row: Record<string, unknown>): Receipt {
  const id = row.id as string;
  // Bootstrap/refresh rows omit photo_url; full rows (lazy fetch, inserts)
  // carry it and refresh the cache.
  if ("photo_url" in row) {
    _receiptPhotoCache.set(id, (row.photo_url ?? "") as string);
  }
  return {
    id,
    vendor: row.vendor as string,
    date: row.date as string,
    photoUrl: _receiptPhotoCache.get(id) ?? "",
    ocrText: row.ocr_text as string | undefined,
    totalTyped: row.total_typed as number,
    capturedBy: row.captured_by as string,
    status: row.status as Receipt["status"],
  };
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
 */
export async function loadAllMedia(scope: "all" | string): Promise<boolean> {
  try {
    let rq = supabase.from("receipts").select("id,photo_url");
    let eq = supabase.from("entries").select("id,photo_url");
    if (scope !== "all") {
      const [y, m] = scope.split("-").map(Number);
      const start = `${scope}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${scope}-${String(lastDay).padStart(2, "0")}`;
      rq = rq.gte("date", start).lte("date", end);
      eq = eq.gte("date", start).lte("date", end);
    }
    const [rRes, eRes] = await Promise.all([rq, eq]);
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
export function authenticateByPin(name: string, pin: string): User | null {
  const u = users.find(
    (x) => x.name.toLowerCase() === name.toLowerCase() && x.pin === pin,
  );
  return u ?? null;
}

/**
 * Admin: update a user's display name and/or PIN. Used when staff
 * are replaced — admin renames the slot and resets the PIN.
 * Role (admin/staff) is intentionally NOT editable here.
 */
export function updateUser(
  id: string,
  patch: { name?: string; pin?: string },
): void {
  const trimmedName = patch.name?.trim();
  const trimmedPin = patch.pin?.trim();
  users = users.map((u) =>
    u.id === id
      ? {
          ...u,
          ...(trimmedName ? { name: trimmedName } : {}),
          ...(trimmedPin ? { pin: trimmedPin } : {}),
        }
      : u,
  );
  notify();

  const update: Record<string, string> = {};
  if (trimmedName) update.name = trimmedName;
  if (trimmedPin) update.pin = trimmedPin;
  if (Object.keys(update).length === 0) return;

  supabase
    .from("users")
    .update(update)
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("supabase: updateUser", error);
    });
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
  entries = entries.map((e) => (e.id === id ? { ...e, ...updates } : e));
  notify();

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
export function addPurchase(input: {
  vendor: string;
  date: string;
  photoUrl?: string;
  paidFrom: Entry["paidFrom"];
  capturedBy: string;
  receiptTotal?: number;
  items: Array<{
    item: string;
    qty: number;
    unitPrice: number;
    total: number;
    category: string;
    majorRepair?: boolean;
    flags: Entry["flags"];
  }>;
}): { receipt: Receipt; entries: Entry[] } {
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

  // Update in-memory state immediately so the UI is instant. Seed the media
  // caches too — we know the photo and the (empty) entry media at creation.
  _receiptPhotoCache.set(receipt.id, receipt.photoUrl ?? "");
  for (const e of created) {
    _entryMediaCache.set(e.id, { photoUrls: [], history: [] });
  }
  receipts = [receipt, ...receipts];
  entries = [...created, ...entries];
  notify();

  // Persist in order: the entries' receipt_id has a foreign key to
  // receipts.id, so the receipt row MUST exist before the entries insert —
  // otherwise the FK rejects them. Await the receipt, then the entries.
  (async () => {
    const { error: rErr } = await supabase.from("receipts").insert({
      id: receipt.id,
      vendor: receipt.vendor,
      date: receipt.date,
      photo_url: receipt.photoUrl,
      ocr_text: null,
      total_typed: receipt.totalTyped,
      captured_by: receipt.capturedBy,
      status: receipt.status,
    });
    if (rErr) {
      console.error("supabase: addPurchase receipt", rErr);
      return;
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
    if (eErr) console.error("supabase: addPurchase entries", eErr);
  })();

  return { receipt, entries: created };
}

// ---------- PCF LEDGER ----------

export function getPcfLedger(): PcfLedgerEntry[] {
  return pcfLedger;
}

export function getPcfBalance(): number {
  const topUps = pcfLedger
    .filter((p) => p.kind === "top-up" && p.status === "approved")
    .reduce((acc, p) => acc + p.amount, 0);
  const drawdowns = entries
    .filter((e) => e.paidFrom === "pcf")
    .reduce((acc, e) => acc + e.total, 0);
  return topUps - drawdowns;
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
 * Admin: zero out the PCF balance by booking an offsetting "top-up" entry.
 *
 * Doesn't delete any history — instead inserts a single approved ledger
 * entry equal to whatever amount is needed to bring balance to 0. Used at
 * reconciliation time when the admin has verified cash on hand and wants
 * the books to start fresh from a known state.
 *
 * `date` is the day the reconciliation entry is booked on. The admin picks
 * which month they're closing, so a reset run in early June to close out
 * May lands the entry in May (dated to the last day of that month) instead
 * of polluting June's totals. Defaults to today when omitted.
 *
 * If the balance is already 0 (within rounding), this is a no-op.
 */
export function clearPcfBalance(
  adminId: string,
  opts?: { date?: string; note?: string },
): void {
  const currentBalance = getPcfBalance();
  if (Math.abs(currentBalance) < 0.005) return;

  // To bring balance to 0, we need a top-up of -currentBalance.
  // PcfLedgerEntry.amount is non-negative, so we flip sign + kind: when the
  // balance is negative (drawdowns > top-ups), insert a positive top-up.
  // When positive (top-ups > drawdowns), the offset would need to be a
  // drawdown — but the prototype's only real shortfall scenario is the
  // negative case, so we keep it as a top-up of `-balance` and let the
  // sign on `amount` carry the meaning. Supabase column is numeric and
  // happy with either.
  const amount = -currentBalance;
  const now = new Date().toISOString();
  const datePart = opts?.date?.trim() || now.slice(0, 10);
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
      `Balance reset by admin — reconciled to ₱0 on ${datePart}`,
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
