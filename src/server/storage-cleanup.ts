/** The slice of Supabase Storage this module needs, so it can be tested without a network. */
export interface StorageBucket {
  list(path: string, options?: { limit?: number; offset?: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}
export interface StorageLike {
  from(bucket: string): StorageBucket;
}

const PAGE = 100;
const MAX_DEPTH = 6;

/** Every object under `prefix`, following folders. A folder entry has no id. Throws if a listing fails, so callers never act on a partial view. */
export async function listObjects(bucket: StorageBucket, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) throw new Error("Storage folder nesting is deeper than expected");
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(error.message);
    const items = data ?? [];
    for (const item of items) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listObjects(bucket, path, depth + 1)));
      else out.push(path);
    }
    if (items.length < PAGE) break;
  }
  return out;
}

/** Removes everything under each prefix. Throws on the first failure so the caller can stop before deleting database rows. */
export async function removeUnder(storage: StorageLike, bucketId: string, prefixes: string[]): Promise<number> {
  const bucket = storage.from(bucketId);
  let removed = 0;
  for (const prefix of prefixes) {
    const paths = await listObjects(bucket, prefix);
    for (let i = 0; i < paths.length; i += PAGE) {
      const chunk = paths.slice(i, i + PAGE);
      const { error } = await bucket.remove(chunk);
      if (error) throw new Error(error.message);
      removed += chunk.length;
    }
  }
  return removed;
}
