/**
 * Validation rules for entries.
 *
 * These are pure functions: they take data, return flags. No side effects,
 * no UI concerns. The same logic that fires inline at entry time is the
 * logic that powers the review queue.
 *
 * Each check returns either a Flag or null. The caller composes them.
 */

import type { Entry, Flag, AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

/**
 * Checks qty * unitPrice == total within a small tolerance.
 * Catches typos like "qty 1, unit 40, total 20".
 */
export function checkArithmetic(
  qty: number,
  unitPrice: number,
  total: number,
): Flag | null {
  if (!qty || !unitPrice || !total) return null;
  const computed = qty * unitPrice;
  if (Math.abs(computed - total) <= 0.5) return null;
  return {
    kind: "arithmetic",
    message: `Quantity × unit price = ₱${computed.toFixed(2)}, but total entered is ₱${total.toFixed(2)}`,
    resolved: false,
  };
}

/**
 * Checks whether an entry duplicates an existing one by date+vendor+item+total.
 * Returns flag if duplicate found in the provided history.
 */
export function checkDuplicate(
  candidate: Pick<Entry, "date" | "vendor" | "item" | "total">,
  existing: Entry[],
): Flag | null {
  const dupe = existing.find(
    (e) =>
      e.date === candidate.date &&
      e.vendor.toLowerCase() === candidate.vendor.toLowerCase() &&
      e.item.toLowerCase() === candidate.item.toLowerCase() &&
      Math.abs(e.total - candidate.total) < 0.01,
  );
  if (!dupe) return null;
  return {
    kind: "duplicate",
    message: `Same vendor, item, and amount already logged today (entry ${dupe.id.slice(0, 8)})`,
    resolved: false,
  };
}

/**
 * Checks whether an amount is an outlier relative to recent history for
 * the same category. "Outlier" defined as > multiplier * median.
 *
 * If the category has fewer than 5 entries, we skip (not enough signal).
 * If the median is small (< ₱100), we skip too — anything > ₱300 in a
 * "cheap" category looks like an outlier but rarely is meaningful.
 */
export function checkOutlier(
  total: number,
  category: string,
  history: Entry[],
  settings: AppSettings = DEFAULT_SETTINGS,
): Flag | null {
  const sameCategory = history.filter((e) => e.category === category);
  if (sameCategory.length < 5) return null;
  const sorted = sameCategory.map((e) => e.total).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median < 100) return null;
  if (total <= median * settings.outlierMultiplier) return null;
  const multiple = (total / median).toFixed(1);
  return {
    kind: "outlier",
    message: `${multiple}× the typical ${category} entry (median ₱${Math.round(median).toLocaleString()})`,
    resolved: false,
  };
}

/**
 * Missing-category flag is the only one that BLOCKS save. The others
 * surface and let the human decide. This one we treat as a validation
 * error because a row without a category is meaningless.
 */
export function checkMissingCategory(category: string | null | undefined): Flag | null {
  if (category && category.trim().length > 0) return null;
  return {
    kind: "missing-category",
    message: "Please choose a category before saving",
    resolved: false,
  };
}

/**
 * Composes all flags for a new entry. Returns array (possibly empty).
 *
 * Note: missing-category is included but should be treated as a hard
 * validation error by the form layer; the others are advisory.
 */
export function flagsForEntry(
  entry: Pick<Entry, "qty" | "unitPrice" | "total" | "date" | "vendor" | "item" | "category">,
  history: Entry[],
  settings: AppSettings = DEFAULT_SETTINGS,
): Flag[] {
  const flags: Flag[] = [];
  const missing = checkMissingCategory(entry.category);
  if (missing) flags.push(missing);
  const arith = checkArithmetic(entry.qty, entry.unitPrice, entry.total);
  if (arith) flags.push(arith);
  const dupe = checkDuplicate(entry, history);
  if (dupe) flags.push(dupe);
  const outlier = checkOutlier(entry.total, entry.category, history, settings);
  if (outlier) flags.push(outlier);
  return flags;
}

/**
 * Checks whether a Maintenance entry is large enough to suggest Major Repair.
 * Used as a "would you like to flag this as Major Repair?" prompt at entry time —
 * not a hard rule.
 */
export function suggestsMajorRepair(
  category: string,
  total: number,
  settings: AppSettings = DEFAULT_SETTINGS,
): boolean {
  return category === "Maintenance" && total >= settings.majorRepairThreshold;
}

/**
 * Reconciliation status for a receipt: do the linked entries sum to the
 * receipt total within tolerance?
 */
export interface ReconResult {
  status: "reconciled" | "mismatch" | "unfinished";
  sum: number;
  difference: number;
}

export function reconciliationStatus(
  receiptTotal: number,
  linkedEntryTotals: number[],
  settings: AppSettings = DEFAULT_SETTINGS,
): ReconResult {
  const sum = linkedEntryTotals.reduce((acc, n) => acc + n, 0);
  const difference = sum - receiptTotal;
  if (linkedEntryTotals.length === 0) {
    return { status: "unfinished", sum: 0, difference: -receiptTotal };
  }
  if (Math.abs(difference) <= settings.reconciliationTolerance) {
    return { status: "reconciled", sum, difference: 0 };
  }
  // If sum is less than receipt total, treat as unfinished (more entries expected).
  // If sum is greater, that's a mismatch — potentially padding.
  if (sum < receiptTotal) return { status: "unfinished", sum, difference };
  return { status: "mismatch", sum, difference };
}

/**
 * Reconciliation that honors an admin "mark as complete" override. When a
 * receipt is settled (part of it was a personal/non-PCF purchase), it reads
 * as reconciled everywhere — but `settledOverride` stays true and the real
 * `difference` is preserved so the UI can still show the non-PCF gap.
 */
export function effectiveReconciliation(
  receiptTotal: number,
  linkedEntryTotals: number[],
  settled: boolean,
  settings: AppSettings = DEFAULT_SETTINGS,
): ReconResult & { settledOverride: boolean } {
  const base = reconciliationStatus(receiptTotal, linkedEntryTotals, settings);
  if (settled && base.status !== "reconciled") {
    return { status: "reconciled", sum: base.sum, difference: base.difference, settledOverride: true };
  }
  return { ...base, settledOverride: false };
}
