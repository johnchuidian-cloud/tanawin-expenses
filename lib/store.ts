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
import type { Entry, Note, PcfLedgerEntry, Receipt, User } from "./types";

let entries: Entry[] = [...MOCK_ENTRIES];
let receipts: Receipt[] = [...MOCK_RECEIPTS];
let pcfLedger: PcfLedgerEntry[] = [...MOCK_PCF_LEDGER];
const users: User[] = [...MOCK_USERS];

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

export function approvePcfTopUp(id: string, approverId: string): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id ? { ...p, status: "approved", approvedBy: approverId } : p,
  );
  notify();
}

export function rejectPcfTopUp(id: string, approverId: string): void {
  pcfLedger = pcfLedger.map((p) =>
    p.id === id ? { ...p, status: "rejected", approvedBy: approverId } : p,
  );
  notify();
}
