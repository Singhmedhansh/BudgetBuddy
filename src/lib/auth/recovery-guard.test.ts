import { describe, expect, it } from "vitest";
import { isRecoveryTokenValid, makeRecoveryToken } from "./recovery-guard";

const USER = "11111111-1111-1111-1111-111111111111";
const T0 = 1_700_000_000_000;

describe("recovery guard (regression: reset form changed a password for a plain signed-in session)", () => {
  it("accepts a fresh token for the same user", () => {
    expect(isRecoveryTokenValid(makeRecoveryToken(USER, T0), USER, T0 + 60_000)).toBe(true);
  });
  it("rejects a missing token, so an ordinary session cannot reset a password", () => {
    expect(isRecoveryTokenValid(undefined, USER, T0)).toBe(false);
    expect(isRecoveryTokenValid("", USER, T0)).toBe(false);
  });
  it("rejects a token for a different user", () => {
    expect(isRecoveryTokenValid(makeRecoveryToken("someone-else", T0), USER, T0)).toBe(false);
  });
  it("rejects expired, future-dated and malformed tokens", () => {
    expect(isRecoveryTokenValid(makeRecoveryToken(USER, T0), USER, T0 + 16 * 60_000)).toBe(false);
    expect(isRecoveryTokenValid(makeRecoveryToken(USER, T0 + 5_000), USER, T0)).toBe(false);
    expect(isRecoveryTokenValid("garbage", USER, T0)).toBe(false);
    expect(isRecoveryTokenValid(`${USER}.abc`, USER, T0)).toBe(false);
  });

  it("rejects a token that was not signed with the server secret (forged cookie)", () => {
    const forged = `${USER}.${T0}`; // the old unsigned format
    expect(isRecoveryTokenValid(forged, USER, T0 + 1000)).toBe(false);
    expect(isRecoveryTokenValid(`${forged}.deadbeef`, USER, T0 + 1000)).toBe(false);
    expect(isRecoveryTokenValid(makeRecoveryToken(USER, T0, "an-attackers-guess-of-the-key"), USER, T0 + 1000)).toBe(false);
  });
  it("rejects a valid signature replayed with a different user or time", () => {
    const t = makeRecoveryToken(USER, T0);
    const [, , mac] = t.split(".");
    expect(isRecoveryTokenValid(`${USER}.${T0 + 1}.${mac}`, USER, T0 + 1000)).toBe(false);
    expect(isRecoveryTokenValid(`other.${T0}.${mac}`, "other", T0 + 1000)).toBe(false);
  });
});
