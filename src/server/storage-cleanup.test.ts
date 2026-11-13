import { describe, expect, it } from "vitest";
import { listObjects, removeUnder, type StorageLike } from "./storage-cleanup";

/** In-memory bucket: a folder entry has `id: null`, a file has an id, as in Supabase Storage. */
function fakeStorage(files: string[], opts: { failRemove?: boolean; failList?: boolean } = {}) {
  const removed: string[] = [];
  const bucket = {
    async list(path: string, o: { limit?: number; offset?: number } = {}) {
      if (opts.failList) return { data: null, error: { message: "list failed" } };
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, boolean>();
      for (const f of files) {
        if (!f.startsWith(prefix) || removed.includes(f)) continue;
        const rest = f.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length > 0);
      }
      const all = [...names].map(([name, isFolder]) => ({ name, id: isFolder ? null : "id-" + name }));
      return { data: all.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100)), error: null };
    },
    async remove(paths: string[]) {
      if (opts.failRemove) return { data: null, error: { message: "remove failed" } };
      removed.push(...paths);
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
  };
  const storage: StorageLike = { from: () => bucket };
  return { storage, removed, bucket };
}

describe("listObjects", () => {
  it("finds files in nested folders", async () => {
    const { bucket } = fakeStorage(["s1/a.pdf", "s1/2026/b.pdf", "s1/2026/11/c.png", "s2/other.pdf"]);
    expect((await listObjects(bucket, "s1")).sort()).toEqual(["s1/2026/11/c.png", "s1/2026/b.pdf", "s1/a.pdf"]);
  });
  it("pages through large folders", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `s1/f${i}.txt`);
    expect(await listObjects(fakeStorage(many).bucket, "s1")).toHaveLength(250);
  });
  it("throws instead of returning a partial list", async () => {
    await expect(listObjects(fakeStorage(["s1/a"], { failList: true }).bucket, "s1")).rejects.toThrow("list failed");
  });
});

describe("removeUnder", () => {
  it("removes only what is under the given prefixes", async () => {
    const { storage, removed } = fakeStorage(["s1/a.pdf", "s1/x/b.pdf", "s2/keep.pdf", "u1/avatar.png"]);
    expect(await removeUnder(storage, "bucket", ["s1", "u1"])).toBe(3);
    expect(removed.sort()).toEqual(["s1/a.pdf", "s1/x/b.pdf", "u1/avatar.png"]);
    expect(removed).not.toContain("s2/keep.pdf");
  });
  it("does nothing, and succeeds, when there is nothing stored", async () => {
    expect(await removeUnder(fakeStorage([]).storage, "bucket", ["s1"])).toBe(0);
  });
  it("throws on a failed removal so the caller can stop before deleting rows", async () => {
    await expect(removeUnder(fakeStorage(["s1/a"], { failRemove: true }).storage, "bucket", ["s1"])).rejects.toThrow("remove failed");
  });
});
