import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "./paging";

/** A stand-in for PostgREST: never returns more than 1000 rows per request, whatever the caller asks for. */
function server(total: number, failAtPage = -1) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  return {
    calls,
    page: async (from: number, to: number) => {
      calls.push([from, to]);
      if (calls.length - 1 === failAtPage) return { data: null, error: { message: "boom" } };
      return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
    },
  };
}

describe("fetchAll", () => {
  it("returns every row when there are more than the server's per-request cap", async () => {
    const s = server(2342);
    const all = await fetchAll<{ id: number }>(s.page);
    expect(all).toHaveLength(2342);
    expect(new Set(all.map((r) => r.id)).size).toBe(2342); // no repeats, no gaps
    expect(s.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("without paging the same server silently loses rows (the bug this guards against)", async () => {
    const s = server(2342);
    expect((await s.page(0, 199999)).data).toHaveLength(1000);
  });
  it("handles exact multiples of the page size, small results and empty results", async () => {
    expect(await fetchAll(server(2000).page)).toHaveLength(2000);
    expect(await fetchAll(server(PAGE_SIZE - 1).page)).toHaveLength(999);
    expect(await fetchAll(server(0).page)).toEqual([]);
  });
  it("an error part-way throws instead of returning a partial result", async () => {
    await expect(fetchAll(server(3000, 1).page)).rejects.toThrow(/part-way/);
  });
  it("max bounds the total and stops asking for more", async () => {
    const s = server(5000);
    expect(await fetchAll(s.page, 1500)).toHaveLength(1500);
    expect(s.calls).toHaveLength(2);
  });
});
