"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { downloadExcelExport } from "@/lib/export";

/**
 * One-click Excel export. Triggers a browser download of a workbook with
 * Entries, PCF Ledger, and Receipts sheets. Shows a short confirmation
 * with the filename so the user knows what landed in their Downloads
 * folder (mobile browsers often hide the download bar).
 */
export default function ExportButton({
  variant = "default",
}: {
  /** "default" = full btn, "sm" = compact for tight headers */
  variant?: "default" | "sm";
}) {
  const [lastFilename, setLastFilename] = useState<string | null>(null);

  function handleClick() {
    const filename = downloadExcelExport();
    setLastFilename(filename);
    // Clear the confirmation after a few seconds.
    setTimeout(() => setLastFilename((cur) => (cur === filename ? null : cur)), 5000);
  }

  const isSm = variant === "sm";

  return (
    <div>
      <button
        onClick={handleClick}
        className={
          isSm
            ? "btn btn-sm bg-white border-sand-200 text-ink-700"
            : "btn-primary"
        }
      >
        <Download className={isSm ? "w-3.5 h-3.5" : "w-4 h-4"} />
        {isSm ? "Excel" : "Download Excel"}
      </button>
      {lastFilename && (
        <p className="text-[11px] text-leaf-600 mt-1">
          Saved {lastFilename}
        </p>
      )}
    </div>
  );
}
