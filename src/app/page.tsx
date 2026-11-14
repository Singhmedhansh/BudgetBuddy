import type { Metadata } from "next";
import { ArrowRight, CalendarClock, FileUp, LineChart, LockKeyhole, PiggyBank, ReceiptText, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { HeroVisual } from "@/components/demo/HeroVisual";
import { ProductShowcase } from "@/components/demo/ProductShowcase";
import { LedgerPreview } from "@/components/landing/LedgerPreview";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { BackToTop } from "@/components/motion/BackToTop";
import { Reveal } from "@/components/motion/Reveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { BRAND } from "@/config/brand";
import { staticPageMetadata } from "@/config/seo";
import { homeStructuredData } from "@/config/structured-data";
import { PLANS, priceFor, type Plan } from "@/config/plans";
import { formatMoney } from "@/domain/money";

const FEATURES = [
  { Icon: ReceiptText, title: "A ledger underneath", body: "Every entry balances. Transfers between your own accounts and credit card repayments are never counted as spending, so totals match what actually happened." },
  { Icon: PiggyBank, title: "Budgets that say what is left", body: "Set limits by category and period. See what you have spent and what remains, with alerts at the threshold you choose." },
  { Icon: CalendarClock, title: "Bills and subscriptions", body: "Keep recurring payments in one calendar with due dates and renewals, so nothing renews unnoticed." },
  { Icon: FileUp, title: "Imports you can check", body: "Upload a CSV, review every row, then confirm. Importing the same file twice does not create duplicates." },
  { Icon: Users, title: "Shared spaces", body: "Run a household budget together with a role for each member, while personal accounts stay private." },
  { Icon: LineChart, title: "Honest forecasts", body: "Estimates are labelled as estimates, with the assumptions shown. Recorded, scheduled and forecast amounts are never mixed up." },
];

const STEPS = [
  { title: "Add where your money is", body: "Create accounts for bank balances, cash, wallets and cards. Balances you enter are yours; this is not a live bank feed." },
  { title: "Record or import", body: "Add transactions in a few taps, or import a statement and review it before anything is saved." },
  { title: "Plan with budgets and goals", body: "Give each category a limit and put money towards what matters." },
  { title: "Review and adjust", body: "Read the dashboard and reports, then adjust the plan for next month." },
];

const AUDIENCES = [
  { who: "Students", body: "Stretch an allowance or stipend across food, transport and college costs, and save towards something specific.", example: "Allowance, rent share, a laptop fund" },
  { who: "Working professionals", body: "Follow salary, rent, EMIs, cards and subscriptions through the month, and build an emergency fund.", example: "Salary, EMIs, an emergency fund" },
  { who: "Couples and families", body: "Share household bills and goals, see who contributed, and keep personal spending personal.", example: "Groceries, school fees, a holiday pot" },
];

const FAQ = [
  { q: "Does FinTrack connect to my bank?", a: "Not today. You add transactions yourself or import a statement file. Any bank connection in future will use a regulated provider and ask for your consent first." },
  { q: "Can FinTrack move money or pay bills?", a: "No. It records and explains your finances. It never makes payments or transfers for you." },
  { q: "Is the free plan enough to start?", a: "Yes. Transactions, accounts, budgets, goals, CSV import and the core dashboard are free. You can always export or delete your data." },
  { q: "Who can see my data?", a: "You, and the people you add to a shared space with the role you choose. Personal accounts stay private even inside a shared space." },
  { q: "Is the AI assistant making up numbers?", a: "Amounts it quotes come from calculations on your recorded data, not from the model. It asks before it changes anything." },
];

const SECURITY = [
  "Each person's data is protected by database-level access rules, not just by the interface.",
  "Card details never reach FinTrack. Payments go through the payment provider's own checkout.",
  "Export your data or delete your account whenever you like, on any plan.",
  "The AI assistant only works from your own recorded data and asks before it changes anything.",
];

const rupees = (minor: number) => formatMoney(minor, "INR", "en-IN").replace(/\.00$/, "");
const h2 = "font-display text-3xl leading-[1.1] sm:text-4xl";

export const metadata: Metadata = staticPageMetadata("home");

export default function Home() {
  return (
    <>
      <JsonLd data={homeStructuredData()} />
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="relative -mt-16 overflow-hidden pt-16">
          <div aria-hidden className="ledger-grid absolute inset-0 -z-10" />
          <div aria-hidden className="absolute -right-40 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-3xl" />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
            <div>
              <h1 className="font-display anim-rise max-w-[14ch] text-[2.6rem] leading-[1.02] sm:text-6xl lg:text-[4.4rem]">{BRAND.tagline}</h1>
              <p className="anim-rise mt-6 max-w-[46ch] text-lg leading-relaxed text-muted" style={{ animationDelay: "90ms" }}>
                Track expenses, plan budgets, manage subscriptions and understand your finances, all in one place.
              </p>
              <div className="anim-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
                <Link href="/signup" className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-fg shadow-card transition-all hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-float">
                  Get started for free
                  <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link href="/#showcase" className="rounded-full border border-line-strong bg-surface/70 px-6 py-3.5 text-sm font-semibold backdrop-blur transition-colors hover:border-primary">
                  See it working
                </Link>
              </div>
              <p className="anim-rise mt-6 text-sm text-muted" style={{ animationDelay: "260ms" }}>
                Free to start. No bank login needed. Export your data any time.
              </p>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* Product showcase on a dark ink band so glass has depth to sit on */}
        <section id="showcase" className="relative overflow-hidden bg-ink py-20 text-white sm:py-28">
          <div aria-hidden className="absolute left-1/2 top-0 h-72 w-[52rem] -translate-x-1/2 rounded-full bg-primary/30 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-5">
            <Reveal>
              <h2 className={`${h2} max-w-[18ch] text-white`}>See FinTrack at work</h2>
              <p className="mt-4 max-w-[52ch] text-white/65">These previews run on example data right here on the page. Try the buttons: nothing is saved, and none of it belongs to a real person.</p>
            </Reveal>
            <Reveal className="mt-12" delay={80}>
              <ProductShowcase />
            </Reveal>
          </div>
        </section>

        {/* Traceability: rendered from the real ledger code */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <h2 className={`${h2} max-w-[16ch]`}>One record you can trace</h2>
              <p className="mt-5 max-w-[46ch] leading-relaxed text-muted">
                Money gets scattered: balances live in several apps, subscriptions renew quietly, and a month-end total rarely matches memory. FinTrack keeps a single ledger, so every figure on the dashboard can be followed back to the transactions behind it.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <LedgerPreview />
            </Reveal>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-y border-line bg-sunken py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <h2 className={`${h2} max-w-[18ch]`}>What you can do with it</h2>
            </Reveal>
            <dl className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={(i % 3) * 70}>
                  <div className="group h-full rounded-xl border border-line bg-surface p-6 transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-card">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-sage text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                      <f.Icon size={19} aria-hidden />
                    </span>
                    <dt className="mt-5 font-semibold">{f.title}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-muted">{f.body}</dd>
                  </div>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        {/* How it works: a real sequence, so it is numbered */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <Reveal>
            <h2 className={h2}>How it works</h2>
          </Reveal>
          <ol className="relative mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            <div aria-hidden className="absolute left-0 right-0 top-4 hidden h-px bg-line-strong lg:block" />
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 80} className="relative">
                <span className="num relative grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg ring-8 ring-bg">{i + 1}</span>
                <h3 className="mt-5 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Audiences */}
        <section id="use-cases" className="border-y border-line bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <h2 className={h2}>Built for how you live</h2>
            </Reveal>
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
              {AUDIENCES.map((a, i) => (
                <Reveal key={a.who} delay={i * 80} className="bg-surface">
                  <div className="h-full p-7">
                    <h3 className="font-display text-2xl">{a.who}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{a.body}</p>
                    <p className="mt-5 border-t border-line pt-4 text-xs text-muted">Typical setup: {a.example}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-sage text-primary">
                <ShieldCheck size={22} aria-hidden />
              </span>
              <h2 className={`${h2} mt-5 max-w-[14ch]`}>Your data stays yours</h2>
              <Link href="/security" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Read how it is protected <ArrowRight size={14} aria-hidden />
              </Link>
            </Reveal>
            <ul className="space-y-3">
              {SECURITY.map((t, i) => (
                <Reveal as="li" key={t} delay={i * 70}>
                  <div className="flex gap-4 rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed">
                    <LockKeyhole size={18} aria-hidden className="mt-0.5 shrink-0 text-primary" />
                    {t}
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-y border-line bg-sunken py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <h2 className={h2}>Pricing</h2>
              <p className="mt-4 max-w-[56ch] text-muted">Start with FinTrack Free. Move to FinTrack One when you want forecasting and deeper reports.</p>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {PLANS.map((p, i) => (
                <Reveal key={p.id} delay={i * 90}>
                  <PlanCard plan={p} featured={i === 1} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
          <Reveal>
            <h2 className={h2}>Questions</h2>
          </Reveal>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="anim-pop max-w-[60ch] pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-5 pb-20 sm:pb-28">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center text-white sm:px-12 sm:py-20">
              <div aria-hidden className="absolute left-1/2 top-0 h-64 w-[40rem] -translate-x-1/2 rounded-full bg-primary/35 blur-3xl" />
              <h2 className="font-display relative mx-auto max-w-[18ch] text-4xl leading-[1.05] sm:text-5xl">Start with one account and one budget.</h2>
              <p className="relative mx-auto mt-4 max-w-[44ch] text-white/65">It takes a few minutes, and you can change anything later.</p>
              <Link href="/signup" className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-ink transition-all hover:-translate-y-0.5 hover:shadow-float">
                Get started for free <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
      <BackToTop />
    </>
  );
}

function PlanCard({ plan, featured }: { plan: Plan; featured?: boolean }) {
  const monthly = priceFor(plan, "month");
  const yearly = priceFor(plan, "year");
  return (
    <div className={`relative h-full rounded-2xl border bg-surface p-7 transition-shadow hover:shadow-card ${featured ? "border-primary shadow-card ring-1 ring-primary" : "border-line-strong"}`}>
      {featured ? <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-fg">Most capable</span> : null}
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted">{plan.summary}</p>
      <p className="num mt-6 text-4xl font-semibold tracking-tight">
        {rupees(monthly?.amountMinor ?? 0)}
        <span className="text-sm font-normal text-muted"> / month</span>
      </p>
      {yearly ? <p className="num mt-1 text-sm text-muted">or {rupees(yearly.amountMinor)} billed yearly</p> : <p className="mt-1 text-sm text-muted">No card needed</p>}
      <ul className="mt-6 space-y-2.5 border-t border-line pt-6 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-3">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {f}
          </li>
        ))}
      </ul>
      <Link href="/signup" className={`mt-7 grid min-h-11 place-items-center rounded-full text-sm font-semibold transition-colors ${featured ? "bg-primary text-primary-fg hover:bg-primary-hover" : "border border-line-strong hover:border-primary"}`}>
        {featured ? "Get started" : "Start free"}
      </Link>
    </div>
  );
}
