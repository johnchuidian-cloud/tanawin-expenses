"use client";

import { supabase } from "./supabase";
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

export async function bootstrapFromSupabase(): Promise<void> {
  if (_bootstrapped || _bootstrapping) return;
  _bootstrapping = true;

  const [usersRes, receiptsRes, entriesRes, pcfRes, catRes] = await Promise.all([
    supabase.from("users").select("*"),
    supabase.from("receipts").select("*"),
    supabase.from("entries").select("*").order("created_at", { ascending: false }),
    supabase.from("pcf_ledger").select("*").order("created_at", { ascending: false }),
    supabase.from("category_defs").select("*").eq("builtin", false),
  ]);

  if (usersRes.error || receiptsRes.error || entriesRes.error || pcfRes.error || catRes.error) {
    console.error("supabase: bootstrap failed", { usersRes, receiptsRes, entriesRes, pcfRes, catRes });
    _bootstrapping = false;
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
  _bootstrapping = false;
  notify();
  // Let useCurrentUser re-check session against the now-populated users array
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("tanawin:auth"));
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

function mapReceipt(row: Record<string, unknown>): Receipt {
  return {
    id: row.id as string,
    vendor: row.vendor as string,
    date: row.date as string,
    photoUrl: (row.photo_url ?? "") as string,
    ocrText: row.ocr_text as string | undefined,
    totalTyped: row.total_typed as number,
    capturedBy: row.captured_by as string,
    status: row.status as Receipt["status"],
  };
}

function mapEntry(row: Record<string, unknown>): Entry {
  return {
    id: row.id as string,
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
    photoUrl: row.photo_url as string | undefined,
    loggedBy: row.logged_by as string,
    createdAt: row.created_at as string,
    flags: (row.flags ?? []) as Entry["flags"],
    notes: (row.notes ?? []) as Entry["notes"],
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
    photo_url: full.photoUrl ?? null,
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
  if (updates.photoUrl !== undefined) dbUpdates.photo_url = updates.photoUrl;
  if (updates.flags !== undefined) dbUpdates.flags = updates.flags;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

  supabase.from("entries").update(dbUpdates).eq("id", id).then(({ error }) => {
    if (error) console.error("supabase: updateEntry", error);
  });
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
