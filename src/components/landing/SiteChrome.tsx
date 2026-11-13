import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BRAND } from "@/config/brand";
import { HeaderClient, type Menu } from "./HeaderClient";

/** Header navigation. Kept here as plain data so the link-integrity test covers every href. */
const MENUS: Menu[] = [
  {
    id: "product",
    label: "Product",
    intro: "One ledger behind every screen.",
    items: [
      { href: "/#showcase", label: "See it working", description: "Interactive previews of the dashboard, budgets and goals." },
      { href: "/help/how-totals-work", label: "How totals work", description: "Why transfers and repayments are never spending." },
      { href: "/help/import-a-statement", label: "Imports", description: "Review every row before anything is saved." },
    ],
  },
  {
    id: "features",
    label: "Features",
    intro: "Everything you need to run your money.",
    items: [
      { href: "/#features", label: "All features", description: "Ledger, budgets, bills, imports, shared spaces." },
      { href: "/help/create-a-budget", label: "Budgets", description: "Limits by category with clear alerts." },
      { href: "/help/savings-goals", label: "Savings goals", description: "Track progress towards a target." },
      { href: "/help/forecast-explained", label: "Forecasting", description: "Estimates, labelled as estimates." },
    ],
  },
  {
    id: "solutions",
    label: "Solutions",
    intro: "Made for how you live.",
    items: [
      { href: "/#use-cases", label: "Students", description: "Stretch an allowance across the term." },
      { href: "/#use-cases", label: "Professionals", description: "Salary, rent, EMIs and subscriptions." },
      { href: "/#use-cases", label: "Couples and families", description: "Share household bills and goals." },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    intro: "Help when you want it.",
    items: [
      { href: "/help", label: "Help Centre", description: "Guides for every part of the product." },
      { href: "/security", label: "Security and privacy", description: "How your data is protected." },
      { href: "/contact", label: "Contact support", description: "Ask a question and get a reference number." },
    ],
  },
];

export function SiteHeader() {
  return <HeaderClient menus={MENUS} />;
}

const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/#showcase", label: "See it working" },
      { href: "/#features", label: "Features" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "Questions" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/help", label: "Help Centre" },
      { href: "/help/getting-started", label: "Getting started" },
      { href: "/help/how-budgets-work", label: "How budgets work" },
      { href: "/security", label: "Security and privacy" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact us" },
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Create an account" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/terms", label: "Terms and conditions" },
      { href: "/legal/refunds", label: "Refund policy" },
      { href: "/legal/cookies", label: "Cookie policy" },
      { href: "/legal/billing", label: "Pricing and billing" },
      { href: "/legal/disclaimer", label: "Financial disclaimer" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-ink text-white">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-10 pt-16 md:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div>
          <Link href="/" aria-label="FinTrack home" className="inline-flex items-center gap-2.5 [&_span]:!text-white">
            <Logo />
          </Link>
          <p className="font-display mt-5 max-w-[22ch] text-2xl leading-snug text-white/90">{BRAND.tagline}</p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/60">A personal finance ledger for tracking, planning and understanding what you spend.</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold text-white">{col.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-white/60 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-white/50 sm:flex-row sm:justify-between">
          <p>© FinTrack. All rights reserved.</p>
          <p className="max-w-xl sm:text-right">FinTrack helps you record and understand your finances. It does not give financial advice or move money.</p>
        </div>
      </div>
    </footer>
  );
}
