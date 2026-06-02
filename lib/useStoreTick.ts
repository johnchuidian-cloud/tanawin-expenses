"use client";

import { useEffect, useState } from "react";
import { subscribe, bootstrapFromSupabase } from "@/lib/store";

export function useStoreTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    bootstrapFromSupabase();
    return subscribe(() => setTick((n) => n + 1));
  }, []);
  return tick;
}
