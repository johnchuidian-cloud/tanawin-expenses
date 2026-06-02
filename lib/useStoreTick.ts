"use client";

import { useEffect, useState } from "react";
import {
  subscribe,
  bootstrapFromSupabase,
  refreshFromSupabase,
} from "@/lib/store";

/**
 * Subscribes the calling component to in-memory store changes.
 *
 * Also hooks the cross-device freshness behaviour:
 *   - On first mount, hydrate from Supabase (bootstrap-once).
 *   - Whenever the tab becomes visible or the window regains focus,
 *     re-fetch from Supabase so a teammate's changes show up without
 *     a manual page reload.
 */
export function useStoreTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    bootstrapFromSupabase();
    const unsubscribe = subscribe(() => setTick((n) => n + 1));

    function pull() {
      // visibilitychange fires both when the tab hides and shows; only
      // pull when becoming visible.
      if (document.visibilityState === "visible") {
        refreshFromSupabase();
      }
    }

    document.addEventListener("visibilitychange", pull);
    window.addEventListener("focus", pull);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", pull);
      window.removeEventListener("focus", pull);
    };
  }, []);
  return tick;
}
