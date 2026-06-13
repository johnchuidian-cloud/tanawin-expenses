/**
 * Demo mode — a fully fictional dataset and a mock PostgREST client.
 *
 * When NEXT_PUBLIC_DEMO=1, lib/supabase.ts exports this mock instead of the
 * real client: reads serve the canned rows below, writes succeed locally and
 * persist nowhere. Used for portfolio screenshots and demo deployments so
 * the real business's data never appears anywhere public.
 *
 * Rows use DB column names (snake_case) because they flow through the same
 * mapUser/mapReceipt/mapEntry row mappers as real PostgREST responses.
 */

function receiptSvg(vendor: string, total: string, lines: string[]): string {
  const items = lines
    .map((l, i) => `<text x="24" y="${150 + i * 34}" font-size="20" fill="#333" font-family="monospace">${l}</text>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520">` +
    `<rect width="400" height="520" fill="#fdfdf8"/>` +
    `<rect x="8" y="8" width="384" height="504" fill="none" stroke="#ddd"/>` +
    `<text x="200" y="60" font-size="26" text-anchor="middle" fill="#111" font-family="monospace">${vendor}</text>` +
    `<text x="200" y="92" font-size="16" text-anchor="middle" fill="#666" font-family="monospace">*** OFFICIAL RECEIPT ***</text>` +
    items +
    `<text x="24" y="440" font-size="24" fill="#111" font-family="monospace">TOTAL  ${total}</text>` +
    `<text x="200" y="490" font-size="14" text-anchor="middle" fill="#999" font-family="monospace">DEMO DATA — NOT A REAL RECEIPT</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const USERS = [
  { id: "u_lexi", name: "Alex", role: "admin", pin: "1234" },
  { id: "u_janice", name: "Bea", role: "staff", pin: "0001" },
  { id: "u_sherill", name: "Carlo", role: "staff", pin: "0002" },
  { id: "u_rio", name: "Dani", role: "staff", pin: "0003" },
  { id: "u_guest", name: "Guest", role: "staff", pin: '{"v":1,"pin":"0000","vr":"guest"}' },
];

const RECEIPTS = [
  {
    id: "r_demo1", vendor: "Riverside Market", date: "2026-06-10",
    photo_url: receiptSvg("RIVERSIDE MARKET", "P 1,240.00", ["Rice 10kg ........ 620.00", "Eggs 2 trays ...... 360.00", "Cooking oil ....... 260.00"]),
    ocr_text: null, total_typed: 1240, captured_by: "u_janice", status: "reconciled",
  },
  {
    id: "r_demo2", vendor: "Bayan Hardware", date: "2026-06-08",
    photo_url: receiptSvg("BAYAN HARDWARE", "P 3,150.00", ["PVC pipe x4 ....... 980.00", "Faucet set ........ 1,450.00", "Sealant ........... 720.00"]),
    ocr_text: null, total_typed: 3150, captured_by: "u_sherill", status: "reconciled",
  },
  {
    id: "r_demo3", vendor: "Casa Verde Farms", date: "2026-06-05",
    photo_url: receiptSvg("CASA VERDE FARMS", "P 860.00", ["Salad greens ...... 320.00", "Tomatoes 3kg ...... 240.00", "Herbs assorted .... 300.00"]),
    ocr_text: null, total_typed: 860, captured_by: "u_janice", status: "mismatch",
  },
  {
    id: "r_demo4", vendor: "Island Gas", date: "2026-05-28",
    photo_url: receiptSvg("ISLAND GAS", "P 1,100.00", ["LPG 11kg refill ... 1,100.00"]),
    ocr_text: null, total_typed: 1100, captured_by: "u_rio", status: "reconciled",
  },
  {
    id: "r_demo5", vendor: "Metro Office Supply", date: "2026-05-20",
    photo_url: receiptSvg("METRO OFFICE SUPPLY", "P 745.00", ["Printer ink ....... 495.00", "Folders x20 ....... 250.00"]),
    ocr_text: null, total_typed: 745, captured_by: "u_janice", status: "reconciled",
  },
];

function e(
  id: string, date: string, vendor: string, item: string, qty: number,
  unitPrice: number, category: string, paidFrom: "pcf" | "other",
  loggedBy: string, receiptId: string | null,
  extra?: { flags?: unknown[]; notes?: unknown[]; total?: number },
) {
  return {
    id, date, vendor, item, qty,
    unit_price: unitPrice,
    total: extra?.total ?? qty * unitPrice,
    category, paid_from: paidFrom, major_repair: false,
    receipt_id: receiptId, photo_url: null, logged_by: loggedBy,
    created_at: `${date}T03:30:00.000Z`,
    flags: extra?.flags ?? [], notes: extra?.notes ?? [],
  };
}

const ENTRIES = [
  e("e_d01", "2026-06-10", "Riverside Market", "Rice 10kg", 1, 620, "Kitchen", "pcf", "u_janice", "r_demo1"),
  e("e_d02", "2026-06-10", "Riverside Market", "Eggs (2 trays)", 2, 180, "Breakfast", "pcf", "u_janice", "r_demo1"),
  e("e_d03", "2026-06-10", "Riverside Market", "Cooking oil 2L", 1, 260, "Kitchen", "pcf", "u_janice", "r_demo1"),
  e("e_d04", "2026-06-08", "Bayan Hardware", "PVC pipe (4 pcs)", 4, 245, "Maintenance", "other", "u_sherill", "r_demo2"),
  e("e_d05", "2026-06-08", "Bayan Hardware", "Faucet set", 1, 1450, "Maintenance", "other", "u_sherill", "r_demo2"),
  e("e_d06", "2026-06-08", "Bayan Hardware", "Sealant", 2, 360, "Maintenance", "other", "u_sherill", "r_demo2"),
  e("e_d07", "2026-06-05", "Casa Verde Farms", "Salad greens", 2, 160, "Breakfast", "pcf", "u_janice", "r_demo3"),
  e("e_d08", "2026-06-05", "Casa Verde Farms", "Tomatoes 3kg", 3, 80, "Kitchen", "pcf", "u_janice", "r_demo3", {
    flags: [{ kind: "duplicate", message: "Same vendor, item, and amount already logged today (entry e_d07b)", resolved: false }],
    notes: [
      { id: "n_d1", authorId: "u_lexi", body: "This looks logged twice — was there really a second tomato run?", kind: "pushback", createdAt: "2026-06-06T01:10:00.000Z" },
    ],
  }),
  e("e_d09", "2026-06-04", "Island Power Co.", "Electricity bill — May", 1, 8420, "Utilities", "other", "u_lexi", null),
  e("e_d10", "2026-06-02", "Aqua Pure", "Drinking water (8 jugs)", 8, 35, "Drinking Water", "pcf", "u_rio", null, {
    notes: [
      { id: "n_d2", authorId: "u_rio", body: "Two jugs were for the staff house.", kind: "comment", createdAt: "2026-06-02T05:00:00.000Z" },
      { id: "n_d3", authorId: "u_lexi", body: "Noted — thanks for flagging.", kind: "comment", createdAt: "2026-06-02T08:30:00.000Z" },
    ],
  }),
  e("e_d11", "2026-05-28", "Island Gas", "LPG 11kg refill", 1, 1100, "Fuel & Gas", "pcf", "u_rio", "r_demo4"),
  e("e_d12", "2026-05-25", "Sunshine Laundry", "Linen wash (12kg)", 12, 45, "Laundry", "pcf", "u_janice", null),
  e("e_d13", "2026-05-20", "Metro Office Supply", "Printer ink", 1, 495, "Admin", "pcf", "u_janice", "r_demo5"),
  e("e_d14", "2026-05-20", "Metro Office Supply", "Folders (20 pcs)", 20, 12.5, "Admin", "pcf", "u_janice", "r_demo5"),
  e("e_d15", "2026-05-15", "Casa Verde Farms", "Garden soil + seedlings", 1, 980, "Garden and Animals", "pcf", "u_sherill", null),
  e("e_d16", "2026-05-10", "NetLink ISP", "Internet — May", 1, 2299, "Communications", "other", "u_lexi", null),
  e("e_d17", "2026-04-22", "Riverside Market", "Coffee beans 2kg", 2, 420, "Coffee", "pcf", "u_rio", null),
  e("e_d18", "2026-04-15", "Bayan Hardware", "Light bulbs (6 pcs)", 6, 85, "Maintenance", "pcf", "u_sherill", null),
];

const PCF_LEDGER = [
  {
    id: "p_d1", kind: "top-up", amount: 25000, date: "2026-06-01",
    reported_by: "u_janice", approved_by: "u_lexi", status: "approved",
    note: "Monthly float via bank transfer", decision_note: null,
    resolved: false, resolved_at: null, resolved_by: null,
    linked_entry_id: null, created_at: "2026-06-01T02:00:00.000Z",
  },
  {
    id: "p_d2", kind: "top-up", amount: 15000, date: "2026-05-05",
    reported_by: "u_janice", approved_by: "u_lexi", status: "approved",
    note: "Mid-month replenishment", decision_note: null,
    resolved: false, resolved_at: null, resolved_by: null,
    linked_entry_id: null, created_at: "2026-05-05T02:00:00.000Z",
  },
  {
    id: "p_d3", kind: "top-up", amount: 5000, date: "2026-06-11",
    reported_by: "u_rio", approved_by: null, status: "pending",
    note: "Cash advance for weekend market run", decision_note: null,
    resolved: false, resolved_at: null, resolved_by: null,
    linked_entry_id: null, created_at: "2026-06-11T01:00:00.000Z",
  },
];

const TABLES: Record<string, Record<string, unknown>[]> = {
  users: USERS,
  receipts: RECEIPTS,
  entries: ENTRIES,
  pcf_ledger: PCF_LEDGER,
  category_defs: [],
};

/**
 * Minimal thenable query builder covering exactly the chains the store
 * uses: select/order/eq/gte/lte/in/maybeSingle for reads; insert/update/
 * delete resolve with no error (demo writes vanish on refresh by design).
 */
function demoBuilder(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  let single = false;
  let isWrite = false;
  const b = {
    select() { return b; },
    order() { return b; },
    insert() { isWrite = true; return b; },
    update() { isWrite = true; return b; },
    delete() { isWrite = true; return b; },
    eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return b; },
    gte(col: string, val: unknown) { filters.push((r) => String(r[col]) >= String(val)); return b; },
    lte(col: string, val: unknown) { filters.push((r) => String(r[col]) <= String(val)); return b; },
    in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return b; },
    maybeSingle() { single = true; return b; },
    then(
      resolve: (v: { data: unknown; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      const rows = isWrite ? [] : (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const data = single ? rows[0] ?? null : rows;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return b;
}

export function createDemoClient() {
  return { from: (table: string) => demoBuilder(table) };
}
