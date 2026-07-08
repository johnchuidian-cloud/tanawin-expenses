/**
 * Full-database backup to local JSON files — covers BOTH Supabase projects:
 *
 *   shared/ — the Finance+Kitchen project (creds from this repo's .env + .env.local)
 *   menu/   — the Tanawin Menu project   (creds from ../tanawin-menu/.env.local,
 *             skipped with a note if that repo isn't present on this machine)
 *
 * Table lists are discovered from each project's PostgREST schema, so new
 * tables are picked up automatically. Snapshots land in dated folders:
 *
 *   C:\Users\<you>\Documents\tanawin-backups\YYYY-MM-DD_HHMM\<project>\<table>.json
 *
 * Why this exists: Finance/Kitchen use client-side PIN auth with RLS disabled,
 * so the anon key can modify data; Menu holds live order records. These
 * snapshots are the recovery path if data is ever damaged or deleted.
 * Keeps the 12 most recent snapshots.
 *
 * Run manually:  node scripts/backup-db.mjs
 * Scheduled:     the "Tanawin DB Backup" Windows task runs scripts/backup-db.cmd weekly.
 *
 * Secrets: read from env files only (all gitignored). Nothing sensitive here.
 */

import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(absPath, key) {
  if (!existsSync(absPath)) return undefined;
  for (const line of readFileSync(absPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const menuRepo = join(repoRoot, "..", "..", "tanawin-menu");
const PROJECTS = [
  {
    name: "shared", // Finance + Kitchen (one Supabase project)
    url: readEnv(join(repoRoot, ".env"), "NEXT_PUBLIC_SUPABASE_URL"),
    key: readEnv(join(repoRoot, ".env.local"), "SUPABASE_SERVICE_ROLE_KEY"),
    required: true,
  },
  {
    name: "menu", // Tanawin Menu (its own Supabase project)
    url: readEnv(join(menuRepo, ".env.local"), "SUPABASE_URL"),
    key: readEnv(join(menuRepo, ".env.local"), "SUPABASE_SERVICE_ROLE_KEY"),
    required: false,
  },
];

// Discover every table from the PostgREST OpenAPI root.
async function listTables(url, headers) {
  const res = await fetch(`${url}/rest/v1/`, { headers });
  if (!res.ok) throw new Error(`schema fetch failed: HTTP ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.paths ?? {})
    .filter((p) => p.startsWith("/") && p !== "/" && !p.startsWith("/rpc"))
    .map((p) => p.slice(1));
}

// Fetch all rows, paging past PostgREST's 1000-row cap. Tries to order by a
// stable column for consistent pages; falls back to unordered.
async function dumpTable(url, headers, table) {
  const orders = ["id", "created_at", "key", "item_key", "finance_entry_id", null];
  for (const col of orders) {
    const rows = [];
    const size = 1000;
    let failed = false;
    for (let from = 0; ; from += size) {
      const q = col ? `${table}?select=*&order=${col}` : `${table}?select=*`;
      const res = await fetch(`${url}/rest/v1/${q}`, {
        headers: { ...headers, Range: `${from}-${from + size - 1}`, "Range-Unit": "items" },
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
const snapshotDir = join(backupRoot, folderName);

let grandTotal = 0;
const manifest = { at: stamp.toISOString(), projects: {} };

for (const p of PROJECTS) {
  if (!p.url || !p.key) {
    const msg = `${p.name}: credentials not found — skipped`;
    if (p.required) { console.error(msg); process.exitCode = 1; }
    else console.warn(msg);
    manifest.projects[p.name] = "skipped (no credentials)";
    continue;
  }
  const headers = { apikey: p.key, Authorization: `Bearer ${p.key}` };
  const outDir = join(snapshotDir, p.name);
  mkdirSync(outDir, { recursive: true });
  try {
    const tables = await listTables(p.url, headers);
    console.log(`[${p.name}] backing up ${tables.length} tables`);
    let projectRows = 0;
    for (const t of tables) {
      try {
        const rows = await dumpTable(p.url, headers, t);
        writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows));
        projectRows += rows.length;
        console.log(`  ✓ ${t}: ${rows.length} rows`);
      } catch (err) {
        console.error(`  ✗ ${t}: ${err.message}`);
        process.exitCode = 1;
      }
    }
    manifest.projects[p.name] = { tables: tables.length, rows: projectRows };
    grandTotal += projectRows;
  } catch (err) {
    console.error(`[${p.name}] ${err.message}`);
    manifest.projects[p.name] = `failed: ${err.message}`;
    process.exitCode = 1;
  }
}

mkdirSync(snapshotDir, { recursive: true });
writeFileSync(join(snapshotDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Done: ${grandTotal} rows total.`);

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
