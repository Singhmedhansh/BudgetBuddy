/** Phone sign-in: the number is validated before anything is sent, every failure is a fixed sentence, and a good code ends like any other sign-in. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const rpc = vi.fn(async () => ({ data: null }));
const supabase = {
  rpc,
  auth: {
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (store.has(n) ? { name: n, value: store.get(n)! } : undefined), set: (n: string, v: string) => void store.set(n, v) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));

const { requestPhoneCode, verifyPhoneCode } = await import("./actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
  supabase.auth.verifyOtp.mockResolvedValue({ error: null });
});

describe("requestPhoneCode", () => {
  it("refuses a number that cannot be real, and sends nothing", async () => {
    const r = await requestPhoneCode(undefined, form({ phone: "12345" }));
    expect(r.step).toBe("number");
    expect(r.error).toMatch(/country code/);
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("normalises the number and shows only a masked version back", async () => {
    const r = await requestPhoneCode(undefined, form({ phone: "98765 43210", mode: "login" }));
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+919876543210", options: { shouldCreateUser: false } });
    expect(r).toMatchObject({ step: "code", phone: "+919876543210" });
    expect(r.notice).not.toContain("98765");
    expect(r.notice).toContain("+91•••••••210");
  });

  it("creates an account for an unknown number on sign-up only", async () => {
    await requestPhoneCode(undefined, form({ phone: "+919876543210", mode: "signup" }));
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+919876543210", options: { shouldCreateUser: true } });
  });

  it("answers the same whether or not the number has an account", async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { code: "otp_disabled", message: "Signups not allowed for otp", status: 422 } });
    const unknown = await requestPhoneCode(undefined, form({ phone: "+919876543210", mode: "login" }));
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
    const known = await requestPhoneCode(undefined, form({ phone: "+919876543210", mode: "login" }));
    expect(unknown).toEqual(known);
  });

  it("gives plain sentences for rate limits and for a project with no SMS provider", async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { code: "over_sms_send_rate_limit", message: "x", status: 429 } });
    expect((await requestPhoneCode(undefined, form({ phone: "+919876543210" }))).error).toMatch(/Too many attempts/);
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { code: "sms_send_failed", message: "Twilio said no: secret detail", status: 500 } });
    const r = await requestPhoneCode(undefined, form({ phone: "+919876543210" }));
    expect(r.error).toBe("Phone sign-in is not available right now. Use another way to sign in.");
    expect(r.error).not.toContain("Twilio");
  });
});

describe("verifyPhoneCode", () => {
  const ok = { phone: "+919876543210", token: "123456" };

  it("refuses a code that is not six digits, without asking Supabase", async () => {
    for (const token of ["", "12345", "1234567", "abcdef"]) {
      const r = await verifyPhoneCode(undefined, form({ ...ok, token }));
      expect(r).toMatchObject({ step: "code" });
      expect(r.error).toMatch(/6-digit/);
    }
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("a wrong or expired code gets one fixed sentence", async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid", status: 403 } });
    const r = await verifyPhoneCode(undefined, form(ok));
    expect(r).toMatchObject({ step: "code", phone: "+919876543210", error: "That code is wrong or has expired. Check it, or ask for a new one." });
  });

  it("a good code creates the profile, remembers phone as the last method, and goes to the app", async () => {
    await expect(verifyPhoneCode(undefined, form({ ...ok, token: "123 456" }))).rejects.toThrow("REDIRECT:/app");
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ phone: "+919876543210", token: "123456", type: "sms" });
    expect(rpc).toHaveBeenCalledWith("ensure_profile");
    expect(store.get("bb-last-provider")).toBe("phone");
  });

  it("sends a new person to onboarding on sign-up, and never to an off-site address", async () => {
    await expect(verifyPhoneCode(undefined, form({ ...ok, mode: "signup" }))).rejects.toThrow("REDIRECT:/app/onboarding");
    await expect(verifyPhoneCode(undefined, form({ ...ok, next: "https://evil.example/" }))).rejects.toThrow("REDIRECT:/app");
    await expect(verifyPhoneCode(undefined, form({ ...ok, next: "/app/budgets" }))).rejects.toThrow("REDIRECT:/app/budgets");
  });
});
