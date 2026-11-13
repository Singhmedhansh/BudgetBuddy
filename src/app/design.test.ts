/**
 * Guards for the visual system: theme parity, motion safety, and that the
 * animation classes components rely on actually exist in the stylesheet.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}
const tokens = (b: string) => new Set([...b.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? files(f) : /\.tsx$/.test(n) ? [f] : [];
  });
}

describe("design tokens", () => {
  it("dark theme defines every colour token the light theme does", () => {
    const light = tokens(block(":root {"));
    const dark = tokens(block(':root[data-theme="dark"]'));
    const geometry = new Set(["radius-sm", "radius-md", "radius-lg"]);
    const missing = [...light].filter((t) => !dark.has(t) && !geometry.has(t));
    expect(missing).toEqual([]);
  });
});

describe("motion", () => {
  it("respects prefers-reduced-motion for animation, transition and scroll reveal", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation-duration");
    expect(reduced).toContain("transition-duration");
    expect(reduced).toContain(".reveal");
  });

  it("scroll-reveal content is only hidden when scripting is available", () => {
    expect(css).toMatch(/@media \(scripting: enabled\)\s*{[^}]*\.reveal\s*{[^}]*opacity: 0/);
  });

  it("every anim-* and glass utility used in components is defined", () => {
    const defined = new Set([...css.matchAll(/\.((?:anim|page)-[a-z-]+|glass|reveal|ledger-grid|font-display)\b/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const f of files(join(process.cwd(), "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b((?:anim|page)-[a-z]+|glass|ledger-grid)\b/g)) used.add(m[1]);
    }
    const missing = [...used].filter((u) => !defined.has(u));
    expect(missing).toEqual([]);
  });
});
