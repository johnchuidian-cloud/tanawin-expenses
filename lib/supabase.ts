import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-data";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// NEXT_PUBLIC_DEMO=1 swaps the real backend for the in-memory demo dataset
// (lib/demo-data.ts) — fictional data for portfolio screenshots and public
// demos. Unset in production, so the branch compiles away entirely.
export const supabase: SupabaseClient =
  process.env.NEXT_PUBLIC_DEMO === "1"
    ? (createDemoClient() as unknown as SupabaseClient)
    : createClient(url, key);
