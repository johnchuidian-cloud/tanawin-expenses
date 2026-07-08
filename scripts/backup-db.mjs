/**
 * Full-database backup to local JSON files.
 *
 * Dumps EVERY table in the shared Supabase project (Finance + Kitchen — the
 * table list is discovered from the PostgREST schema, so new tables are
 * picked up automatically) into a dated folder:
 *
 *   C:\Users\<you>\Documents\tanawin-backups\YYYY-MM-DD_HHMM\<table>.json
 *
 * Why this exists: the apps use client-side PIN auth with RLS disabled, so
 * the anon key can modify data. These snapshots are the recovery path if
 * data is ever damaged or deleted. Keeps the 12 most recent snapshots.
 *
 * Run manually:  node scripts/backup-db.mjs
 * Scheduled:     a Windows Task Scheduler job runs scripts/backup-db.cmd weekly.
 *
 * Secrets: reads NEXT_PUBLIC_SUPABASE_URL from .env and
 * SUPABASE_SERVICE_ROLE_KEY from .env.local (gitignored). Nothing sensitive
 * lives in this file.
 */

import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file, key) {
  const p = join(repoRoot, file);
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const URL_ = readEnv(".env", "NEXT_PUBLIC_SUPABASE_URL");
const KEY = readEnv(".env.local", "SUPABASE_SERVICE_ROLE_KEY");
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL (.env) or SUPABASE_SERVICE_ROLE_KEY (.env.local)");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Discover every table from the PostgREST OpenAPI root.
async function listTables() {
  const res = await fetch(`${URL_}/rest/v1/`, { headers: H });
  if (!res.ok) throw new Error(`schema fetch failed: HTTP ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.paths ?? {})
    .filter((p) => p.startsWith("/") && p !== "/" && !p.startsWith("/rpc"))
    .map((p) => p.slice(1));
}

// Fetch all rows, paging past PostgREST's 1000-row cap. Tries to order by a
// stable column for consistent pages; falls back to unordered.
async function dumpTable(table) {
  const orders = ["id", "created_at", "key", "item_key", "finance_entry_id", null];
  for (const col of orders) {
    const rows = [];
    const size = 1000;
    let failed = false;
    for (let from = 0; ; from += size) {
      const q = col ? `${table}?select=*&order=${col}` : `${table}?select=*`;
      const res = await fetch(`${URL_}/rest/v1/${q}`, {
        headers: { ...H, Range: `${from}-${from + size - 1}`, "Range-Unit": "items" },
      });
      if (!res.ok) { failed = true; break; } // bad order column — try next
      const page = await res.json();
      rows.push(...page);
      if (page.length < size) break;
    }
    if (!failed) return rows;
  }
  throw new Error(`could not dump ${table}`);
}

const stamp = new Date();
const pad = (n) => String(n).padStart(2, "0");
const folderName = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
const backupRoot = join(homedir(), "Documents", "tanawin-backups");
const outDir = join(backupRoot, folderName);
mkdirSync(outDir, { recursive: true });

const tables = await listTables();
console.log(`Backing up ${tables.length} tables to ${outDir}`);
let totalRows = 0;
for (const t of tables) {
  try {
    const rows = await dumpTable(t);
    writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows));
    totalRows += rows.length;
    console.log(`  ✓ ${t}: ${rows.length} rows`);
  } catch (err) {
    console.error(`  ✗ ${t}: ${err.message}`);
    process.exitCode = 1;
  }
}
writeFileSync(
  join(outDir, "_manifest.json"),
  JSON.stringify({ at: stamp.toISOString(), tables: tables.length, totalRows }, null, 2),
);
console.log(`Done: ${totalRows} rows total.`);

// Retention: keep the 12 most recent snapshot folders.
const snapshots = readdirSync(backupRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name))
  .map((d) => d.name)
  .sort()
  .reverse();
for (const old of snapshots.slice(12)) {
  rmSync(join(backupRoot, old), { recursive: true, force: true });
  console.log(`  pruned old snapshot ${old}`);
}
