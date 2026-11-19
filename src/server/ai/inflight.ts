import { createHash } from "node:crypto";

/**
 * Collapses identical concurrent requests from the same person into one. A double-click, a retried submit or two tabs
 * sending the same question share a single reservation and a single provider call instead of spending the person's
 * allowance and the free quota twice. Entries live only while the call is in flight; nothing is cached afterwards.
 * Per server instance: it removes the common duplicate, it is not a distributed lock.
 */
const flights = new Map<string, Promise<unknown>>();

export const flightKey = (userId: string, ...parts: string[]) => createHash("sha256").update([userId, ...parts].join("\u0000")).digest("hex");

export function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;
  const p = run().finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}
