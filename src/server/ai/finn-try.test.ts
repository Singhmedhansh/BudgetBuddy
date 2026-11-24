import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowAddress, claimTries, demoReply, FINN_TRIES, readTryCookie, writeTryCookie } from "./finn-try";

const TODAY = { year: 2026, month: 11, day: 24 };

describe("Try Finn on the home page", () => {
  beforeEach(() => vi.stubEnv("FINN_TRY_SECRET", "a-long-test-secret-value"));

  it("signs the try count so it cannot be reset by editing the cookie", () => {
    const c = writeTryCookie({ used: 1, claimed: 0 })!;
    expect(readTryCookie(c.value)).toEqual({ used: 1, claimed: 0 });
    expect(c.options.httpOnly).toBe(true);
    // An edited count fails the signature and leaves no free tries.
    const forged = c.value.replace(/^1\./, "0.");
    expect(readTryCookie(forged)).toEqual({ used: FINN_TRIES, claimed: FINN_TRIES });
    expect(readTryCookie(undefined)).toEqual({ used: 0, claimed: 0 });
  });

  it("answers a spending message in code, without saving anything or calling a model", async () => {
    const r = await demoReply("200 auto, 150 chai yesterday", TODAY);
    expect(r).toMatchObject({ kind: "record", rows: [{ amount: "₹200", day: "Yesterday" }, { amount: "₹150", day: "Yesterday" }] });
  });

  it("caps tries per address per day", () => {
    const at = new Date("2030-01-01T10:00:00Z");
    for (let i = 0; i < 6; i++) expect(allowAddress("203.0.113.9", at)).toBe(true);
    expect(allowAddress("203.0.113.9", at)).toBe(false);
    expect(allowAddress("203.0.113.10", at)).toBe(true);
  });

  it("adds unclaimed tries to the account once, then marks them claimed", async () => {
    const calls: string[] = [];
    const rpc = async (fn: string) => {
      calls.push(fn);
      return { data: fn === "ai_reserve_window" ? { allowed: true, id: calls.length } : null, error: null };
    };
    const cookie = writeTryCookie({ used: 2, claimed: 0 })!.value;
    const next = await claimTries({ rpc }, cookie);
    expect(next).toEqual({ used: 2, claimed: 2 });
    expect(calls.filter((c) => c === "ai_reserve_window")).toHaveLength(2);
    expect(calls.filter((c) => c === "ai_settle")).toHaveLength(2);
    // Signing in again on the same browser adds nothing more.
    expect(await claimTries({ rpc }, writeTryCookie(next!)!.value)).toBeNull();
  });
});
