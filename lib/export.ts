/**
 * Excel export.
 *
 * Builds a workbook with three sheets — Entries, PCF Ledger, Receipts —
 * suitable for handing to an accountant. Pulls live data from the store at
 * click time.
 *
 * Design notes after the v1 "jumbled" feedback:
 *  - Rows are sorted **oldest → newest** (chronological, how a ledger reads).
 *  - Internal IDs (entry id, receipt id) are dropped — they mean nothing to
 *    anyone using the app, and just added noise.
 *  - Headers are Title Case; money columns get a ₱ number format; every column
 *    gets a sensible width so nothing is cramped.
 *  - The caller passes a date range (a list of YYYY-MM months) so the user can
 *    export one month, several, a whole year, or everything.
 */

"use client";

import * as XLSX from "xlsx";
import { getEntries, getPcfLedger, getReceipts, getUserById } from "./store";
import { effectiveReconciliation } from "./validation";

export interface ExportRange {
  /** YYYY-MM keys to include. Empty / undefined = every record. */
  months?: string[];
  /** Filename suffix, e.g. "2026-06", "2026", "all-time". */
  label?: string;
}

const PESO_FMT = '"₱"#,##0.00';

function userName(id: string | undefined): string {
  if (!id) return "";
  return getUserById(id)?.name ?? "—";
}

/** Keeps a row only if its date falls in the selected months (or no filter). */
function inRange(dateIso: string, months?: string[]): boolean {
  if (!months || months.length === 0) return true;
  return months.includes(dateIso.slice(0, 7)); // YYYY-MM
}

function byDateAsc<T extends { date: string }>(a: T, b: T): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

function buildEntryRows(months?: string[]) {
  return getEntries()
    .filter((e) => inRange(e.date, months))
    .sort(byDateAsc)
    .map((e) => ({
      Date: e.date,
      Vendor: e.vendor,
      Item: e.item,
      Qty: e.qty,
      "Unit Price": e.unitPrice,
      Total: e.total,
      Category: e.category,
      "Paid From": e.paidFrom === "pcf" ? "PCF" : "Other fund",
      "Major Repair": e.majorRepair ? "Yes" : "",
      "Logged By": userName(e.loggedBy),
    }));
}

function buildPcfRows(months?: string[]) {
  return getPcfLedger()
    .filter((p) => inRange(p.date, months))
    .sort(byDateAsc)
    .map((p) => ({
      Date: p.date,
      Kind: p.kind,
      Status: p.status,
      Amount: p.amount,
      "Reported By": userName(p.reportedBy),
      "Approved By": userName(p.approvedBy),
      "Reporter Note": p.note ?? "",
      "Admin Note": p.decisionNote ?? "",
      Resolved: p.resolved ? "Yes" : "",
      "Resolved By": p.resolved ? userName(p.resolvedBy) : "",
    }));
}

function buildReceiptRows(months?: string[]) {
  const entries = getEntries();
  return getReceipts()
    .filter((r) => inRange(r.date, months))
    .sort(byDateAsc)
    .map((r) => {
      const linked = entries.filter((e) => e.receiptId === r.id);
      const recon = effectiveReconciliation(
        r.totalTyped,
        linked.map((e) => e.total),
        !!r.settled,
      );
      return {
        Date: r.date,
        Vendor: r.vendor,
        "Receipt Total": r.totalTyped,
        "Captured By": userName(r.capturedBy),
        "Line Items": linked.length,
        "Line Item Total": recon.sum,
        "Reconciliation Status": recon.settledOverride ? "settled (non-PCF)" : recon.status,
        Difference: recon.difference,
      };
    });
}

/**
 * Applies column widths and a peso number format. SheetJS (community) writes
 * `!cols` widths and per-cell number formats (`z`); cell styling like bold
 * isn't supported, so we lean on widths + formats for readability.
 */
function styleSheet(ws: XLSX.WorkSheet, widths: number[], currencyCols: number[]) {
  ws["!cols"] = widths.map((wch) => ({ wch }));
  if (!ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (const c of currencyCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = PESO_FMT;
    }
  }
}

/** How many entries a given range covers — for the picker's live count. */
export function countEntriesInRange(months?: string[]): number {
  return getEntries().filter((e) => inRange(e.date, months)).length;
}

/**
 * Builds the workbook and triggers a browser download. Returns the filename.
 */
export function downloadExcelExport(range?: ExportRange): string {
  const months = range?.months;
  const wb = XLSX.utils.book_new();

  const entriesSheet = XLSX.utils.json_to_sheet(buildEntryRows(months));
  styleSheet(entriesSheet, [12, 18, 24, 6, 12, 12, 16, 11, 12, 13], [4, 5]);
  XLSX.utils.book_append_sheet(wb, entriesSheet, "Entries");

  const pcfSheet = XLSX.utils.json_to_sheet(buildPcfRows(months));
  styleSheet(pcfSheet, [12, 9, 10, 12, 13, 13, 26, 26, 9, 13], [3]);
  XLSX.utils.book_append_sheet(wb, pcfSheet, "PCF Ledger");

  const receiptsSheet = XLSX.utils.json_to_sheet(buildReceiptRows(months));
  styleSheet(receiptsSheet, [12, 18, 13, 13, 10, 14, 20, 11], [2, 5, 7]);
  XLSX.utils.book_append_sheet(wb, receiptsSheet, "Receipts");

  const label = range?.label ?? "all-time";
  const filename = `Tanawin-Expenses-${label}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
