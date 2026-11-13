import { describe, expect, it } from "vitest";
import { ARTICLES, DESTINATIONS, bySlug } from "./articles";
import { searchHelp } from "./search";

describe("help search", () => {
  it("answers a task question with an article and a destination (spec 8.2 example)", () => {
    const r = searchHelp("Where can I see grocery spending?");
    expect(r.direct?.href).toBe("/app/transactions?cat=grocery");
    expect(r.articles.map((a) => a.slug)).toContain("find-spending");
    expect(r.destinations.map((d) => d.href)).toContain("/app/transactions");
  });

  it("finds the right article for common tasks", () => {
    expect(searchHelp("forgot my password").articles[0].slug).toBe("reset-your-password");
    expect(searchHelp("how do I delete a transaction").articles[0].slug).toBe("reverse-a-transaction");
    expect(searchHelp("pay my credit card").articles[0].slug).toBe("transfers-and-card-repayments");
    expect(searchHelp("dark mode").articles[0].slug).toBe("light-and-dark-theme");
    expect(searchHelp("rollover").articles[0].slug).toBe("budget-rollover");
  });

  it("never returns an empty page: no results still gives suggestions", () => {
    const r = searchHelp("zzzzqqq nonsense");
    expect(r.articles).toHaveLength(0);
    expect(r.suggestions.length).toBeGreaterThan(0);
    const empty = searchHelp("   ");
    expect(empty.suggestions.length).toBeGreaterThan(0);
  });

  it("caps the query length and tolerates punctuation", () => {
    expect(() => searchHelp("a".repeat(5000))).not.toThrow();
    expect(searchHelp("budget!!!").articles.length).toBeGreaterThan(0);
  });
});

describe("help content integrity", () => {
  it("slugs are unique and related links point at real articles", () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of ARTICLES) for (const r of a.related ?? []) expect(bySlug(r), `${a.slug} -> ${r}`).toBeTruthy();
  });

  it("every internal link in article text and every destination is an existing route", () => {
    const known = new Set([
      "/app", "/app/transactions", "/app/transactions/new", "/app/accounts", "/app/accounts/new", "/app/budgets", "/app/budgets/new",
      "/app/goals", "/app/goals/new", "/app/bills", "/app/bills/new", "/app/subscriptions", "/app/subscriptions/new", "/app/income", "/app/income/new", "/app/calendar", "/app/debt",
      "/contact", "/security", "/forgot-password", "/help",
    ]);
    const check = (href: string, where: string) => expect(known.has(href.split("?")[0]), `${where}: ${href}`).toBe(true);
    for (const d of DESTINATIONS) check(d.href, `destination ${d.label}`);
    for (const a of ARTICLES) {
      if (a.destination) check(a.destination.href, `${a.slug} destination`);
      for (const b of a.body) {
        const texts = "text" in b ? [b.text] : b.items;
        for (const t of texts) for (const m of t.matchAll(/\]\((\/[^)\s]*)\)/g)) check(m[1], `${a.slug} link`);
      }
    }
  });
});

describe("help search covers the planning modules", () => {
  it("routes common planning questions to the right article", () => {
    expect(searchHelp("how do I pay off my loan faster").articles[0].slug).toBe("debt-payoff");
    expect(searchHelp("netflix renewal").articles[0].slug).toBe("bills-and-subscriptions");
    expect(searchHelp("emergency fund").articles[0].slug).toBe("savings-goals");
    expect(searchHelp("salary not received yet").articles.map((a) => a.slug)).toContain("expected-income");
  });
});
