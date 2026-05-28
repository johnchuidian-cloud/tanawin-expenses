/**
 * Data store.
 *
 * The single layer between the UI and the data. Today it's an in-memory
 * store seeded from mocks. When we connect Supabase, this file is the
 * only one that changes — every function below stays the same shape,
 * just calls Supabase instead of touching local arrays.
 *
 * Implementation note: in-memory state survives within a single page
 * lifecycle but resets on full reload. That's intentional for v0 —
 * we don't want fake data persisting and being mistaken for real.
 */

"use client";

import { MOCK_ENTRIES, MOCK_PCF_LEDGER, MOCK_RECEIPTS, MOCK_USERS } from "../mocks/seed";
import { BUILTIN_CATEGORIES } from "./types";
import type {
  Category,
  CategoryDef,
  Entry,
  Note,
  PcfLedgerEntry,
  Receipt,
  User,
} from "./types";

let entries: Entry[] = [...MOCK_ENTRIES];
let receipts: Receipt[] = [...MOCK_RECEIPTS];
let pcfLedger: PcfLedgerEntry[] = [...MOCK_PCF_LEDGER];
const users: User[] = [...MOCK_USERS];

// ---------- CATEGORIES ----------
// Built-in defs derive their icon key from the built-in list; the actual
// icon component is resolved at render time in lib/category-meta.ts.
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

const CUSTOM_CATEGORIES_KEY = "tanawin.customCategoryDefs";
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
        out[k] = v;
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
    // localStorage unavailable — fall back to in-memory only
  }
}

function loadCustomCategoryDefs(): CategoryDef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is CategoryDef =>
          d &&
          typeof d.id === "string" &&
          typeof d.iconKey === "string" &&
          d.builtin === false,
      )
      // Defensive: never let a custom shadow a builtin
      .filter((d) => !BUILTIN_CATEGORIES.includes(d.id));
  } catch {
    return [];
  }
}

function saveCustomCategoryDefs(defs: CategoryDef[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CUSTOM_CATEGORIES_KEY,
      JSON.stringify(defs.filter((d) => !d.builtin)),
    );
  } catch {
    // localStorage may be unavailable (Safari private, quota, etc.) — fall
    // back to in-memory only. The user sees no error, just no persistence.
  }
}

// Merge persisted hint overrides into both built-in and custom defs at init.
const _hintOverrides = loadHintOverrides();
let categoryDefs: CategoryDef[] = [
  ...BUILTIN_DEFS,
  ...loadCustomCategoryDefs(),
].map((def) =>
  _hintOverrides[def.id] && _hintOverrides[def.id].length > 0
    ? { ...def, extraHints: _hintOverrides[def.id] }
    : def,
);

export function getCategoryDefs(): CategoryDef[] {
  return categoryDefs;
}

export function getCategoryDef(id: Category): CategoryDef | undefined {
  return categoryDefs.find((d) => d.id === id);
}

/**
 * Adds a new (custom) category. Returns the new def, or null if the name
 * collides with an existing category (builtin or custom). Names are
 * trimmed and compared case-insensitively to avoid "Snacks" vs "snacks"
 * fragmentation.
 */
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
  saveCustomCategoryDefs(categoryDefs);
  notify();
  return def;
}

/**
 * Removes a custom category. Returns `{ ok: true }` on success, or
 * `{ ok: false, reason }` if blocked. Built-ins can't be removed; custom
 * categories can't be removed while any entry still references them
 * (the user would lose that data's categorization).
 */
export function deleteCategoryDef(id: Category): {
  ok: boolean;
  reason?: string;
} {
  const def = categoryDefs.find((d) => d.id === id);
  if (!def) return { ok: false, reason: "Category not found." };
  if (def.builtin) {
    return { ok: false, reason: "Built-in categories can't be deleted." };
  }
  const usageCount = entries.filter((e) => e.category === id).length;
  if (usageCount > 0) {
    return {
      ok: false,
      reason: `${usageCount} entr${usageCount === 1 ? "y uses" : "ies use"} this category — reassign them first.`,
    };
  }
  categoryDefs = categoryDefs.filter((d) => d.id !== id);
  saveCustomCategoryDefs(categoryDefs);
  notify();
  return { ok: true };
}

/**
 * Replaces the extra hint keywords for a category. Works on built-ins and
 * customs alike — built-ins keep their default hints (in lib/category-hints.ts)
 * regardless; this list is purely additive.
 *
 * Pass an empty array (or null/undefined) to clear the extras.
 */
export function updateCategoryHints(
  id: Category,
  hints: string[] | null | undefined,
): void {
  const clean = (hints ?? [])
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  // Dedupe in-place — order matters for read display, so keep first occurrences.
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const h of clean) {
    if (!seen.has(h)) {
      seen.add(h);
      deduped.push(h);
    }
  }

  categoryDefs = categoryDefs.map((d) =>
    d.id === id
      ? { ...d, extraHints: deduped.length > 0 ? deduped : undefined }
      : d,
  );

  // Persist only the overrides for any category that still has extras.
  const map: Record<string, string[]> = {};
  for (const d of categoryDefs) {
    if (d.extraHints && d.extraHints.length > 0) {
      map[d.id] = d.extraHints;
    }
  }
  saveHintOverrides(map);
  notify();
}

/** Subscribers re-render when the store changes. Lightweight pub-sub. */
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
  const u = users.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.pin === pin);
  return u ?? null;
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
  const full: Entry = {
    ...entry,
    id: `e_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  entries = [full, ...entries];
  notify();
  return full;
}
export function updateEntry(id: string, updates: Partial<Entry>): void {
  entries = entries.map((e) => (e.id === id ? { ...e, ...updates } : e));
  notify();
}
export function addNoteToEntry(entryId: string, note: Omit<Note, "id" | "createdAt">): void {
  const newNote: Note = {
    ...note,
    id: `n_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  entries = entries.map((e) =>
    e.id === entryId ? { ...e, notes: [...e.notes, newNote] } : e,
  );
  notify();
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
  receipts = [full, ...receipts];
  notify();
  return full;
}
export function updateReceiptStatus(id: string, status: Receipt["status"]): void {
  receipts = receipts.map((r) => (r.id === id ? { ...r, status } : r));
  notify();
}

// ---------- PCF LEDGER ----------
export function getPcfLedger(): PcfLedgerEntry[] {
  return pcfLedger;
}

/**
 * Returns current PCF balance based on approved top-ups minus PCF-funded
 * entries. Entries with paidFrom === "other" (utilities by bank transfer,
 * etc.) are recorded for visibility but don't affect this balance.
 */
export function getPcfBalance(): number {
  const topUps = pcfLedger
    .filter((p) => p.kind === "top-up" && p.status === "approved")
    .reduce((acc, p) => acc + p.amount, 0);
  const drawdowns = entries
    .filter((e) => e.paidFrom === "pcf")
    .reduce((acc, e) => acc + e.total, 0);
  return topUps - drawdowns;
}

/** Self-report a top-up (staff action). Lands as 'pending'. */
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
  return full;
}

export function approvePcfTopUp(
  id: string,
  approverId: string,
  decisionNote?: string,
): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id
      ? {
          ...p,
          status: "approved",
          approvedBy: approverId,
          decisionNote: decisionNote?.trim() || undefined,
        }
      : p,
  );
  notify();
}

export function rejectPcfTopUp(
  id: string,
  approverId: string,
  decisionNote?: string,
): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id
      ? {
          ...p,
          status: "rejected",
          approvedBy: approverId,
          decisionNote: decisionNote?.trim() || undefined,
        }
      : p,
  );
  notify();
}

/**
 * Marks a rejected top-up as resolved (the underlying issue was addressed).
 * Idempotent — already-resolved entries are a no-op. Doesn't change status
 * back to approved; "rejected, resolved" stays distinct in the ledger so
 * the audit trail is preserved.
 */
export function resolvePcfRejection(id: string, resolverId: string): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id && p.status === "rejected" && !p.resolved
      ? {
          ...p,
          resolved: true,
          resolvedBy: resolverId,
          resolvedAt: new Date().toISOString(),
        }
      : p,
  );
  notify();
}
