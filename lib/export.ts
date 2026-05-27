/**
 * Excel export.
 *
 * Builds a single workbook with three sheets — Entries, PCF Ledger, Receipts —
 * suitable for handing to an accountant or filing with the books. Pulls live
 * data from the store; everything is computed at click time.
 *
 * Stays a pure function returning a filename + Blob trigger so we can later
 * swap the download mechanism (e.g. upload to Google Drive) without touching
 * the UI.
 */

"use client";

import * as XLSX from "xlsx";
import { getEntries, getPcfLedger, getReceipts, getUserById } from "./store";
import { reconciliationStatus } from "./validation";

interface EntryRow {
  id: string;
  date: string;
  vendor: string;
  item: string;
  qty: number;
  "unit price": number;
  total: number;
  category: string;
  "paid from": string;
  "major repair": string;
  "logged by": string;
  "open flags": number;
  notes: number;
  "receipt id": string;
}

interface PcfRow {
  id: string;
  kind: string;
  status: string;
  amount: number;
  date: string;
  "reported by": string;
  "approved by": string;
  "reporter note": string;
  "admin note": string;
}

interface ReceiptRow {
  id: string;
  vendor: string;
  date: string;
  "receipt total": number;
  "captured by": string;
  "line items": number;
  "line item total": number;
  "reconciliation status": string;
  difference: number;
}

function userName(id: string | undefined): string {
  if (!id) return "";
  return getUserById(id)?.name ?? "—";
}

function buildEntryRows(): EntryRow[] {
  const entries = [...getEntries()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    vendor: e.vendor,
    item: e.item,
    qty: e.qty,
    "unit price": e.unitPrice,
    total: e.total,
    category: e.category,
    "paid from": e.paidFrom === "pcf" ? "PCF" : "Other fund",
    "major repair": e.majorRepair ? "Yes" : "",
    "logged by": userName(e.loggedBy),
    "open flags": e.flags.filter((f) => !f.resolved).length,
    notes: e.notes.length,
    "receipt id": e.receiptId ?? "",
  }));
}

function buildPcfRows(): PcfRow[] {
  const ledger = [...getPcfLedger()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  return ledger.map((p) => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    amount: p.amount,
    date: p.date,
    "reported by": userName(p.reportedBy),
    "approved by": userName(p.approvedBy),
    "reporter note": p.note ?? "",
    "admin note": p.decisionNote ?? "",
  }));
}

function buildReceiptRows(): ReceiptRow[] {
  const receipts = [...getReceipts()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  const entries = getEntries();
  return receipts.map((r) => {
    const linked = entries.filter((e) => e.receiptId === r.id);
    const recon = reconciliationStatus(
      r.totalTyped,
      linked.map((e) => e.total),
    );
    return {
      id: r.id,
      vendor: r.vendor,
      date: r.date,
      "receipt total": r.totalTyped,
      "captured by": userName(r.capturedBy),
      "line items": linked.length,
      "line item total": recon.sum,
      "reconciliation status": recon.status,
      difference: recon.difference,
    };
  });
}

/**
 * Builds the workbook and triggers a browser download. Returns the filename
 * used, so the caller can show it in a confirmation.
 */
export function downloadExcelExport(): string {
  const wb = XLSX.utils.book_new();

  const entriesSheet = XLSX.utils.json_to_sheet(buildEntryRows());
  XLSX.utils.book_append_sheet(wb, entriesSheet, "Entries");

  const pcfSheet = XLSX.utils.json_to_sheet(buildPcfRows());
  XLSX.utils.book_append_sheet(wb, pcfSheet, "PCF Ledger");

  const receiptsSheet = XLSX.utils.json_to_sheet(buildReceiptRows());
  XLSX.utils.book_append_sheet(wb, receiptsSheet, "Receipts");

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const filename = `Tanawin-Expenses-${yyyy}-${mm}-${dd}.xlsx`;

  XLSX.writeFile(wb, filename);
  return filename;
}
