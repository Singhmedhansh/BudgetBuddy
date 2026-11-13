/**
 * Session isolation between Budget Buddy and any other app on the same Supabase
 * project (and the same host in development). Regression for the incident where
 * Budget Buddy accepted another app's session cookie.
 */
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_NAME } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/session";

const REF = "abcdefghijklmnopqrst";
const URL_ = `https://${REF}.supabase.co`;
const OTHER_APP_COOKIE = `sb-${REF}-auth-token`; // Supabase's default name, used by other apps
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function fakeSession(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: userId, aud: "authenticated", exp: now + 3600, role: "authenticated" }), "sig"].join(".");
  return {
    access_token: jwt,
    refresh_token: "refresh",
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: "bearer",
    user: { id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}
const cookieValue = (userId: string) => "base64-" + Buffer.from(JSON.stringify(fakeSession(userId))).toString("base64url");

type Jar = { name: string; value: string }[];
function clientWith(jar: Jar, onSet?: (c: { name: string; value: string }[]) => void) {
  return createServerClient(URL_, "anon-key", {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: { getAll: () => jar, setAll: (c) => onSet?.(c.map(({ name, value }) => ({ name, value }))) },
  });
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("session isolation", () => {
  it("uses a cookie name different from Supabase's default for this project", () => {
    expect(AUTH_COOKIE_NAME).not.toBe(OTHER_APP_COOKIE);
    expect(AUTH_COOKIE_NAME.startsWith("sb-budgetbuddy")).toBe(true);
  });

  it("does NOT read a session from another app's cookie", async () => {
    const jar: Jar = [{ name: OTHER_APP_COOKIE, value: cookieValue("other-app-user") }];
    const { data } = await clientWith(jar).auth.getSession();
    expect(data.session).toBeNull();
  });

  it("reads its own cookie", async () => {
    const jar: Jar = [{ name: AUTH_COOKIE_NAME, value: cookieValue("bb-user") }];
    const { data } = await clientWith(jar).auth.getSession();
    expect(data.session?.user.id).toBe("bb-user");
  });

  it("with both cookies present, only Budget Buddy's identity is used", async () => {
    const jar: Jar = [
      { name: OTHER_APP_COOKIE, value: cookieValue("other-app-user") },
      { name: AUTH_COOKIE_NAME, value: cookieValue("bb-user") },
    ];
    const { data } = await clientWith(jar).auth.getSession();
    expect(data.session?.user.id).toBe("bb-user");
  });

  it("the proxy treats a visitor holding only another app's session as signed out", async () => {
    const req = new NextRequest("http://localhost:3100/app", { headers: { cookie: `${OTHER_APP_COOKIE}=${cookieValue("other-app-user")}` } });
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("independent logout", () => {
  it("signing out of Budget Buddy only ever clears Budget Buddy's cookies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const jar: Jar = [
      { name: OTHER_APP_COOKIE, value: cookieValue("other-app-user") },
      { name: AUTH_COOKIE_NAME, value: cookieValue("bb-user") },
    ];
    const touched: string[] = [];
    const supabase = clientWith(jar, (c) => touched.push(...c.map((x) => x.name)));
    await supabase.auth.signOut({ scope: "local" });
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((n) => n.startsWith(AUTH_COOKIE_NAME))).toBe(true);
    expect(touched).not.toContain(OTHER_APP_COOKIE);
  });

  it("every Supabase client in the app is created with the Budget Buddy cookie name", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["server.ts", "client.ts", "session.ts"]) {
      expect(readFileSync(`src/lib/supabase/${f}`, "utf8")).toContain("name: AUTH_COOKIE_NAME");
    }
  });
});
