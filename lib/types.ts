/**
 * Core data types for the Tanawin Expense Tracker.
 *
 * These mirror what will live in Supabase tables once we connect a real
 * backend. Keeping them centralised here means changing the data model
 * is one file edit + downstream type errors guide the rest.
 */

/**
 * "guest" is a view-only role (accountants, family): can browse entries
 * and reports but never add, edit, or comment. The DB role column has a
 * CHECK constraint allowing only admin/staff (no DDL possible), so guests
 * are stored as role='staff' with a role override packed into the users.pin
 * JSON blob — see parseUserPin in lib/store.ts.
 */
export type Role = "admin" | "staff" | "guest";

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
  /**
   * LEGACY plaintext 4-digit PIN. Empty string once the account has been
   * migrated to a hashed PIN (see pinHash) — new/changed PINs are always
   * stored hashed. Kept for backward compat with unmigrated rows.
   */
  pin: string;
  /**
   * SHA-256 hex of the 4-digit PIN (stored as `ph` in the users.pin JSON
   * blob). When present, login compares hashes and the plaintext PIN is
   * never stored. Note: a 4-digit space is brute-forceable offline — this
   * protects against casual reading of the table, not a determined attacker.
   */
  pinHash?: string;
  /**
   * SHA-256 hash of the admin's recovery code (forgot-PIN failsafe), or
   * undefined when none is set. Stored packed inside the users.pin column
   * as JSON (no-DDL workaround — see parseUserPin in lib/store.ts). The
   * plaintext code is shown once at generation and never stored.
   */
  recoveryHash?: string;
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
  /**
   * Log of line items an admin removed from this receipt. The entry itself
   * is gone, but the deletion is recorded here for the audit trail (who
   * removed what, when). Packed into the otherwise-unused ocr_text column —
   * see parseReceiptOcr in lib/store.ts.
   */
  deletions?: AuditRecord[];
  /**
   * Admin override marking the receipt complete even though the PCF line
   * items don't sum to the printed total — e.g. part of the receipt was a
   * personal / non-PCF purchase the admin will reimburse. When set, the
   * receipt reads as reconciled everywhere instead of "unfinished/mismatch".
   * Also packed into the ocr_text blob. `note` optionally explains the gap.
   */
  settled?: {
    at: string;
    by: string;
    note?: string;
  };
  /**
   * Line items (entries) on this receipt that were personal purchases — still
   * printed on the same store receipt, but paid with someone's own money, so
   * their amounts are NOT deducted from the petty cash balance. Stays in
   * reports (clearly marked) and still counts toward reconciling the printed
   * total. Stored as a list of entry ids in the ocr_text blob (eager, so the
   * PCF balance is right at load without fetching photos). See parseReceiptOcr.
   */
  personalEntryIds?: string[];
  /**
   * VAT portion already included in `totalTyped` (Philippine receipts print a
   * VAT-inclusive total plus the VAT breakdown). Informational for the
   * bookkeeper — it does not change the PCF balance or reconciliation. Also
   * packed into the ocr_text blob.
   */
  vatAmount?: number;
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
  photoUrl?: string; // first receipt photo (legacy single-photo accessor)
  photoUrls?: string[]; // all receipt photos attached to this entry
  loggedBy: string; // user ID
  createdAt: string; // ISO timestamp
  flags: Flag[];
  notes: Note[];
  history?: AuditRecord[]; // edit log — appended on field edits and receipt changes
}

/**
 * One entry in an entry's edit history. `summary` is a short human-readable
 * description of what changed, e.g. "Edited vendor, total" or
 * "Added a receipt photo (now 2)".
 */
export interface AuditRecord {
  at: string; // ISO timestamp
  by: string; // user ID who made the change
  summary: string;
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
 * A saved (canonical) vendor and the alternate spellings that should map to
 * it. Aliases are stored normalized (lowercase, punctuation/space-stripped)
 * for matching — see normalizeVendor in lib/store.ts.
 */
export interface SavedVendor {
  /** Canonical display name, e.g. "Puregold". */
  name: string;
  /** Normalized alternate spellings, e.g. ["pure gold", "puregoldsm"]. */
  aliases: string[];
}

/** A staff-proposed vendor awaiting admin approval. */
export interface VendorSuggestion {
  id: string;
  name: string;
  aliases: string[];
  proposedBy: string; // user id
  at: string; // ISO timestamp
  note?: string;
}

/**
 * The shared vendor registry — canonical vendors plus pending suggestions.
 * Persisted as one JSON blob on a sentinel category_defs row (no DDL), so it
 * syncs to every device. See loadVendorRegistry in lib/store.ts.
 */
export interface VendorRegistry {
  v: 1;
  vendors: SavedVendor[];
  suggestions: VendorSuggestion[];
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
