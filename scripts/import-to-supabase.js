/**
 * One-time importer: reads scripts/2026-source.xlsx (the cleaned 5-month
 * Tanawin BnB expense sheet) and INSERTs the rows into the Supabase
 * `entries` table.
 *
 * Required env vars (read from .env.local, .env, or the shell):
 *   NEXT_PUBLIC_SUPABASE_URL      same as the app uses
 *   SUPABASE_SERVICE_ROLE_KEY     write key from Supabase dashboard,
 *                                 Project Settings -> API -> service_role
 *                                 (NEVER commit this — it bypasses RLS)
 *
 * Usage:
 *   node scripts/import-to-supabase.js            # dry-run, prints summary
 *   node scripts/import-to-supabase.js --commit   # actually insert
 *
 * Defaults baked in by product owner decision (2026-06-02):
 *   paid_from = "pcf" for every row (separate funds start post-May)
 *   logged_by = "u_lexi" (admin running the import / phone owner)
 *   Categories not in CATEGORY_MAP fall through to "Other" with a warning.
 *
 * Re-runs are NOT idempotent — each run inserts fresh rows. To redo,
 * delete the previously-inserted rows from Supabase first (filter by
 * the id prefix `e_imp_`).
 */
"use strict";

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ---- env loading (no dotenv dep — read .env.local and .env by hand) ----
function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return;
  const text = fs.readFileSync(filepath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue; // existing wins
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SRC = path.join(__dirname, "2026-source.xlsx");
const COMMIT = process.argv.includes("--commit");
const MONTH_SHEETS = ["January", "February", "March", "April", "May."];

const CATEGORY_MAP = {
  breakfast: "Breakfast",
  "staff meals": "Staff Meals",
  "lunch/dinner": "Lunch/Dinner",
  kitchen: "Kitchen",
  laundry: "Laundry",
  admin: "Admin",
  cleaning: "Cleaning Supplies",
  repair: "Maintenance",
  maintenance: "Maintenance",
  coffee: "Coffee",
  transpo: "Fuel & Gas",
  water: "Drinking Water",
  electricity: "Utilities",
  internet: "Communications",
  garden: "Garden and Animals",
  genset: "Fuel & Gas",
  "linens/towels": "Room Supplies",
  compliance: "Compliance",
  miscellaneous: "Other",
  store: "Other",
};

function excelSerialToISO(serial) {
  const parts = XLSX.SSF.parse_date_code(serial);
  if (!parts) return null;
  const y = String(parts.y).padStart(4, "0");
  const m = String(parts.m).padStart(2, "0");
  const d = String(parts.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function splitPayee(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { vendor: "(unknown)", item: "(unspecified)" };
  const idx = s.indexOf(":");
  if (idx === -1) return { vendor: s, item: "(unspecified)" };
  const vendor = s.slice(0, idx).trim();
  const item = s.slice(idx + 1).trim();
  return {
    vendor: vendor || "(unknown)",
    item: item || "(unspecified)",
  };
}

function mapCategory(raw, unmapped) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) {
    unmapped.set("(blank)", (unmapped.get("(blank)") ?? 0) + 1);
    return "Other";
  }
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
  return "Other";
}

function parseRows() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source xlsx not found: ${SRC}`);
  }
  const wb = XLSX.readFile(SRC);
  const rows = [];
  const unmapped = new Map();
  let skipped = 0;
  let serial = 1;

  for (const sheet of MONTH_SHEETS) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    // Header rows: 0..2; data starts at index 3.
    for (let i = 3; i < raw.length; i++) {
      const r = raw[i];
      const dateSerial = r[1];
      const unitPrice = r[2];
      const qty = r[3];
      const total = r[4];
      const payee = r[5];
      const category = r[6];

      // Skip blank/padding rows.
      if (
        dateSerial == null &&
        total == null &&
        payee == null &&
        category == null
      ) {
        continue;
      }
      const isoDate = typeof dateSerial === "number"
        ? excelSerialToISO(dateSerial)
        : null;
      if (!isoDate) {
        skipped++;
        continue;
      }

      const { vendor, item } = splitPayee(payee);
      const idNum = String(serial).padStart(4, "0");
      serial++;

      // snake_case keys to match the Supabase entries table schema.
      rows.push({
        id: `e_imp_${idNum}`,
        date: isoDate,
        vendor,
        item,
        qty: typeof qty === "number" ? qty : 1,
        unit_price: typeof unitPrice === "number" ? unitPrice : 0,
        total: typeof total === "number" ? total : 0,
        category: mapCategory(category, unmapped),
        paid_from: "pcf",
        major_repair: false,
        logged_by: "u_lexi",
        created_at: `${isoDate}T12:00:00.000Z`,
        flags: [],
        notes: [],
      });
    }
  }

  return { rows, unmapped, skipped };
}

async function main() {
  const { rows, unmapped, skipped } = parseRows();
  const grandTotal = rows.reduce((s, r) => s + (r.total || 0), 0);

  console.log(`Parsed ${rows.length} rows, total ₱${grandTotal.toFixed(2)}.`);
  console.log(`Skipped ${skipped} rows with no parseable date.`);
  if (unmapped.size > 0) {
    console.log("Unmapped categories (defaulted to Other):");
    for (const [k, v] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
  }

  if (!COMMIT) {
    console.log("");
    console.log("DRY RUN — no rows inserted.");
    console.log("Sample row:");
    console.log(JSON.stringify(rows[0], null, 2));
    console.log("");
    console.log("To actually insert, run:  node scripts/import-to-supabase.js --commit");
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("");
    console.error("Missing credentials. Need both:");
    console.error("  NEXT_PUBLIC_SUPABASE_URL");
    console.error("  SUPABASE_SERVICE_ROLE_KEY");
    console.error("");
    console.error("Add the service-role key to .env.local then re-run.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("");
  console.log(`Inserting ${rows.length} rows into Supabase…`);
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("entries").insert(slice);
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error);
      console.error(`Stopped after ${inserted} successful inserts.`);
      process.exit(1);
    }
    inserted += slice.length;
    process.stdout.write(`  ${inserted}/${rows.length}\r`);
  }
  console.log("");
  console.log(`Done. Inserted ${inserted} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
