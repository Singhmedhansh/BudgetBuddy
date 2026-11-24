import { createHash } from "node:crypto";
import { REFERENCE_REVIEWED_ON } from "@/config/reference-data";
import { createAdminClient } from "@/server/admin";
import { normalizeQuestion } from "./scope";

/**
 * Answers to general questions, shared between people. "What is an emergency fund?" has the same good answer for
 * everyone, so it is worked out once and reused for a week: no model call, no free-quota spend, and an instant reply.
 *
 * Only answers that cannot contain anything about a person are stored: the question was general (no private records
 * were in the prompt at all), the answer is tagged general, none of it was removed by the figure check, and it was a
 * first message with no conversation before it. The key is a hash, so no question text is kept. Each entry expires
 * after a week, and changes whenever the instructions or the dated reference figures change.
 */
export interface AnswerCache {
  get(key: string): Promise<string | null>;
  set(key: string, answer: string): Promise<void>;
}

/** Bump when the general instructions change in a way that should retire stored answers. */
export const ANSWER_CACHE_VERSION = "1";
export const ANSWER_CACHE_DAYS = 7;

export function cacheKey(
  question: string,
  region: { country: string | null; currency: string },
  brief: boolean,
): string {
  return createHash("sha256")
    .update(
      [
        ANSWER_CACHE_VERSION,
        REFERENCE_REVIEWED_ON,
        region.country ?? "",
        region.currency,
        brief ? "b" : "f",
        normalizeQuestion(question),
      ].join("\u0000"),
    )
    .digest("hex");
}

/** The shared cache, kept in the database and read with the server's service role. Without it, nothing is cached. */
export function databaseAnswerCache(): AnswerCache | null {
  const admin = createAdminClient();
  if (!admin) return null;
  return {
    async get(key) {
      try {
        const since = new Date(
          Date.now() - ANSWER_CACHE_DAYS * 86_400_000,
        ).toISOString();
        const { data } = await admin
          .from("finn_answer_cache")
          .select("answer")
          .eq("key", key)
          .gt("created_at", since)
          .maybeSingle();
        return (data as { answer: string } | null)?.answer ?? null;
      } catch {
        return null;
      }
    },
    async set(key, answer) {
      try {
        await admin
          .from("finn_answer_cache")
          .upsert(
            { key, answer, created_at: new Date().toISOString() },
            { onConflict: "key" },
          );
      } catch {
        /* a cache that cannot be written simply does not help */
      }
    },
  };
}
