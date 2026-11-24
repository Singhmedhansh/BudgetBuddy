import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { formatPrice, PLANS, planName, priceFor } from "./plans";

describe("brand and pricing", () => {
  it("has the approved identity", () => {
    expect(BRAND.name).toBe("FinTrack");
    expect(BRAND.tagline).toBe("Meet Finn. Your money, handled.");
  });

  it("names and prices the plans from one config", () => {
    expect(planName("free")).toBe("FinTrack Free");
    expect(planName("pro")).toBe("FinTrack One");
    const free = PLANS.find((p) => p.id === "free")!;
    const one = PLANS.find((p) => p.id === "pro")!;
    expect(priceFor(free, "month")!.amountMinor).toBe(0);
    expect(priceFor(one, "month")!.amountMinor).toBe(14900);
    expect(priceFor(one, "year")!.amountMinor).toBe(119900);
    expect(formatPrice(priceFor(one, "month")!)).toBe("₹149");
    expect(formatPrice(priceFor(one, "year")!)).toBe("₹1,199");
    expect(formatPrice(priceFor(free, "month")!)).toBe("₹0");
  });

  it("keeps the stored plan id stable", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro"]);
  });

  it("shows no old product name anywhere customers can see it", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css|svg|md)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")) {
          if (/budget[\s-]buddy/i.test(readFileSync(p, "utf8"))) hits.push(p);
        }
      }
    };
    walk("src");
    walk("public");
    expect(hits).toEqual([]);
  });
});
