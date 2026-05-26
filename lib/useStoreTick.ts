"use client";

import { useEffect, useState } from "react";
import { subscribe } from "@/lib/store";

/**
 * Lightweight hook: subscribes to store changes and forces a re-render
 * whenever the store mutates. Used so any component reading from the
 * store stays in sync.
 */
export function useStoreTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    return subscribe(() => setTick((n) => n + 1));
  }, []);
  return tick;
}
