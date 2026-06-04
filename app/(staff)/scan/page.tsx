"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The old photo-first "Scan receipt" flow has been replaced by the unified
 * "Log new expense" screen (/new), which captures one receipt photo and as
 * many tagged line items as needed. Anyone landing here is sent there.
 */
export default function ScanRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/new");
  }, [router]);
  return (
    <div className="px-5 py-10 text-center text-sm text-ink-500">
      Taking you to Log new expense…
    </div>
  );
}
