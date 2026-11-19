/** PostgREST returns at most this many rows per request, whatever `.limit()` says. */
export const PAGE_SIZE = 1000;

/**
 * Reads every row of a query, a page at a time. A bulk read that does not do this is silently truncated at 1000 rows,
 * which turns period totals, budget spending and exports into confident but wrong numbers once a person has enough
 * transactions. `page(from, to)` must apply the same filters and a STABLE order (end with the primary key) each time,
 * or rows can repeat or go missing between pages. An error stops the read instead of returning a partial result.
 * `max` bounds the total for reads that only need the most recent rows.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; out.length < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("A bulk read failed part-way, so no partial result is returned.");
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out.length > max ? out.slice(0, max) : out;
}
