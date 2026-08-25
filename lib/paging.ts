/**
 * Paging past PostgREST's 1000-row cap.
 *
 * Lives in its own module (rather than inside store.ts) so it can be tested
 * directly: a bug here loses rows *silently*, which is how all-time totals like
 * the PCF balance once read wrong after `entries` crossed 1000 — the oldest
 * rows dropped and their drawdowns were never subtracted.
 */

/** How many pages to request concurrently. See the SCALE note below. */
export const PAGE_BATCH = 4;

export type PageResult = { data: Record<string, unknown>[] | null; error: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PageFetcher = (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>;

/**
 * Fetch EVERY row from a query.
 *
 * `pageSize` matters for the photo queries: rows carrying base64 images are
 * megabytes each, and asking for 1000 of them at once takes long enough that
 * Postgres cancels the statement (see the STATEMENT TIMEOUT note on
 * loadAllMedia). Any page that IS cancelled is retried at half the size rather
 * than failing the whole load, so a month that grows past the limit degrades
 * into more, smaller requests instead of erroring.
 *
 * SCALE: pages are fetched in small PARALLEL batches, not one after another.
 * The 1000-row cap is enforced server-side (asking for 5000 still returns
 * 1000), so the only way to shorten a large load is concurrency. Sequentially
 * this cost one round-trip per 1000 rows — measured ~1.8 s each, i.e. ~18 s of
 * "Loading…" at 10k entries and ~45 s at 25k, on a table growing ~200 rows a
 * month. Batching cuts that by roughly the batch factor. Over-fetch is bounded:
 * a batch stops the moment one of its pages comes back short.
 */
export async function selectAllRows(build: PageFetcher, pageSize = 1000): Promise<PageResult> {
  const all: Record<string, unknown>[] = [];
  let size = pageSize;
  let from = 0;

  type Page = { rows: Record<string, unknown>[] | null; error: unknown; timedOut: boolean };

  // Exactly one attempt at one page. Never mutates `size` — a shrink decided
  // inside a parallel sibling would leave a hole between that page's shortened
  // range and the next sibling's already-fixed offset, silently dropping rows.
  async function attempt(start: number, sz: number): Promise<Page> {
    const { data, error } = await build(start, start + sz - 1);
    if (!error) return { rows: data ?? [], error: null, timedOut: false };
    // 57014 = statement timeout. The page was too heavy; ask for less.
    if ((error as { code?: string })?.code === "57014" && sz > 1) {
      return { rows: null, error: null, timedOut: true };
    }
    return { rows: null, error, timedOut: false };
  }

  for (;;) {
    // Lead page runs alone, so any shrink settles before offsets are handed out.
    const lead = await attempt(from, size);
    if (lead.error) return { data: null, error: lead.error };
    if (lead.timedOut) {
      size = Math.max(1, Math.floor(size / 2));
      continue;
    }
    const leadRows = lead.rows!;
    all.push(...leadRows);
    if (leadRows.length < size) break;
    from += size;

    // Siblings all use this exact size; if any of them times out we throw the
    // whole batch away and retry the range at a smaller size, rather than
    // stitching together pages of differing widths.
    const settled = size;
    const batch = await Promise.all(
      Array.from({ length: PAGE_BATCH - 1 }, (_, i) => attempt(from + i * settled, settled)),
    );

    const fatal = batch.find((p) => p.error);
    if (fatal) return { data: null, error: fatal.error };

    if (batch.some((p) => p.timedOut)) {
      size = Math.max(1, Math.floor(settled / 2));
      continue; // re-fetch this range sequentially at the smaller size
    }

    let short = false;
    for (const page of batch) {
      const rows = page.rows!;
      // Offset order matters: once a page comes back short there is nothing
      // beyond it, so later pages in this batch are over-fetch and discarded.
      if (!short) all.push(...rows);
      if (rows.length < settled) short = true;
    }
    if (short) break;
    from += (PAGE_BATCH - 1) * settled;
  }

  return { data: all, error: null };
}
