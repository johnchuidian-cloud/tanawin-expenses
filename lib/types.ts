/**
 * Core data types for the Tanawin Expense Tracker.
 *
 * These mirror what will live in Supabase tables once we connect a real
 * backend. Keeping them centralised here means changing the data model
 * is one file edit + downstream type errors guide the rest.
 */

export type Role = "admin" | "staff";

/**
 * Category labels are plain strings so admins can add new ones from the
 * app at runtime (see /categories/manage). The list below is the seed of
 * built-in categories that ship with the prototype; custom ones live in
 * the store and persist to localStorage. The Category type stays as
 * `string` for forward-compat — anything serializable can be a category.
 */
export type Category = string;

/**
 * Metadata for one category. `builtin: true` means it came from the seed
 * and can't be deleted via the UI; user-added defs are `builtin: false`.
 */
export interface CategoryDef {
  id: Category; // doubles as the display label and the value stored on entries
  tagalog?: string;
  iconKey: string; // key into the icon registry in lib/category-meta.ts
  builtin: boolean;
  /**
   * Admin-added keyword patterns for the smart category suggestion on
   * /new. These extend (never replace) the built-in defaults shipped in
   * lib/category-hints.ts, so the seed suggestions keep working while
   * admins can teach the form local vocabulary ("paksiw", "chichirya",
   * etc.). Stored case-insensitively as lowercase substrings.
   */
  extraHints?: string[];
}

/**
 * Where the cash for this entry came from.
 *
 *  - "pcf"   — drawn from the pooled petty cash. Affects the PCF balance.
 *  - "other" — paid by direct bank transfer, Lexi's personal funds, or any
 *              other source. Recorded for visibility but doesn't touch PCF.
 *
 * Utilities (PENELCO, water bill, etc.) usually fall into "other" because
 * they're paid by bank transfer from a separate account.
 */
export type PaymentSource = "pcf" | "other";

/**
 * Built-in categories shipped with the prototype, in display order.
 * The actual runtime list (built-in + user-added) comes from
 * `getCategoryDefs()` in lib/store.ts. Don't iterate this directly in
 * UI code — you'll miss the custom ones.
 */
export const BUILTIN_CATEGORIES: Category[] = [
  "Breakfast",
  "Lunch/Dinner",
  "Staff Meals",
  "Coffee",
  "Kitchen",
  "Room Supplies",
  "Cleaning Supplies",
  "Laundry",
  "Utilities",
  "Drinking Water",
  "Communications",
  "Fuel & Gas",
  "Maintenance",
  "Garden and Animals",
  "Admin",
  "Accounting",
  "Compliance",
  "Other",
];

export interface User {
  id: string;
  name: string;
  role: Role;
  pin: string; // 4-digit PIN, mocked for v0; replaced by Supabase Auth later
}

export interface Receipt {
  id: string;
  vendor: string;
  date: string; // ISO date
  photoUrl: string; // Google Drive link (mocked as local URL for now)
  ocrText?: string; // best-effort OCR, used only for search; not for line items
  totalTyped: number; // staff types this from reading the receipt
  capturedBy: string; // user ID
  status: "unfinished" | "reconciled" | "mismatch";
}

export interface Entry {
  id: string;
  date: string; // ISO date
  vendor: string;
  item: string;
  qty: number;
  unitPrice: number;
  total: number; // computed: qty * unitPrice, stored for query simplicity
  category: Category;
  paidFrom: PaymentSource; // explicit funding source — drives PCF balance math
  majorRepair?: boolean; // only meaningful for Maintenance
  receiptId?: string; // optional link to a receipt
  photoUrl?: string; // optional item photo (e.g., broken aircon)
  loggedBy: string; // user ID
  createdAt: string; // ISO timestamp
  flags: Flag[];
  notes: Note[];
}

export type FlagKind = "arithmetic" | "duplicate" | "outlier" | "missing-category";

export interface Flag {
  kind: FlagKind;
  message: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

/**
 * Note kind distinguishes a plain comment from an admin pushback (review
 * "Do not approve"). Surfaces visually in /review and /notes so staff can
 * tell at a glance which messages need their action.
 */
export type NoteKind = "comment" | "pushback";

export interface Note {
  id: string;
  authorId: string;
  body: string;
  kind: NoteKind;
  createdAt: string;
}

export type PcfEntryKind = "top-up" | "drawdown";
export type PcfStatus = "pending" | "approved" | "rejected";

export interface PcfLedgerEntry {
  id: string;
  kind: PcfEntryKind;
  amount: number; // positive for top-ups, positive amount (we store sign by kind)
  date: string; // ISO date
  reportedBy: string; // user ID
  approvedBy?: string; // user ID (admin)
  status: PcfStatus; // pending applies to top-ups awaiting Lexi approval
  note?: string; // reporter's note at submission time
  /**
   * Admin's note attached at approve/reject time. Required for rejections
   * so the reporter sees why; optional for approvals (Lexi might want to
   * leave a question or context even on a yes).
   */
  decisionNote?: string;
  /**
   * Admin marks a rejected top-up as resolved once it's been addressed —
   * staff resubmitted, the cash was found, the missing receipt arrived,
   * etc. Until resolved, the rejection shows on the Rejections tab.
   */
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  linkedEntryId?: string; // for drawdowns: which entry this PCF spent on
  createdAt: string;
}

/**
 * App-level settings, kept in one place so tuning sensitivity etc.
 * is a single source of truth.
 */
export interface AppSettings {
  outlierMultiplier: number; // e.g. 3 = "3x median is an outlier"
  majorRepairThreshold: number; // peso amount that suggests Major Repair
  reconciliationTolerance: number; // peso difference allowed between entries and receipt total
}

export const DEFAULT_SETTINGS: AppSettings = {
  outlierMultiplier: 3,
  majorRepairThreshold: 5000,
  reconciliationTolerance: 1,
};
