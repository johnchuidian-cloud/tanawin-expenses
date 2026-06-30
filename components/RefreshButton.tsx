"use client";

import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { refreshFromSupabase } from "@/lib/store";

/**
 * Force a re-sync from Supabase. The store already refreshes on tab focus, but
 * a money figure that looks stale is alarming — this gives an explicit "pull
 * the latest" the user can trust, with a clear syncing/synced state.
 */
export default function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    setDone(false);
    await refreshFromSupabase();
    setBusy(false);
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      aria-label="Refresh from server"
      className="btn btn-sm bg-white border-sand-200 text-ink-700 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : done ? (
        <Check className="w-3.5 h-3.5 text-leaf-600" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5" />
      )}
      {busy ? "Syncing…" : done ? "Synced" : "Refresh"}
    </button>
  );
}
