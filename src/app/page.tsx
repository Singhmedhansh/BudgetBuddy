import Link from "next/link";
import { LedgerPreview } from "@/components/landing/LedgerPreview";
import { SiteFooter, SiteHeader } from "@/components/landing/SiteChrome";
import { PLANS, priceFor, type Plan } from "@/config/plans";
import { formatMoney } from "@/domain/money";

const FEATURES = [
  {
    title: "A ledger underneath",
    body: "Every entry balances. Transfers between your own accounts and credit card repayments are never counted as spending, so totals match what actually happened.",
  },
  {
    title: "Budgets that say what is left",
    body: "Set limits by category and period. See what you have spent, what is still pending, and what remains, with alerts at the threshold you choose.",
  },
  {
    title: "Bills and subscriptions",
    body: "Keep recurring payments in one calendar with due dates, renewals and reminders, so nothing renews unnoticed.",
  },
  {
    title: "Imports you can check",
    body: "Upload a CSV or spreadsheet, review every row, and confirm. Importing the same file twice does not create duplicates.",
  },
  {
    title: "Shared spaces",
    body: "Run a household budget together with roles for each member, while keeping your personal accounts private.",
  },
  {
    title: "Honest forecasts",
    body: "Estimates are labelled as estimates, with the assumptions shown. Recorded, scheduled and forecast amounts are never mixed up.",
  },
];

const STEPS = [
  { title: "Add where your money is", body: "Create accounts for bank balances, cash, wallets and cards. Balances you enter are yours; they are not a live bank feed." },
  { title: "Record or import transactions", body: "Add them in a few taps, or import a statement and review it before anything is saved." },
  { title: "Plan with budgets and goals", body: "Give each category a limit and put money towards what matters." },
  { title: "Review what happened", body: "Read the dashboard and reports, then adjust the plan for next month." },
];

const AUDIENCES = [
  { who: "Students", body: "Stretch an allowance or stipend across food, transport and college costs, and save towards something specific." },
  { who: "Working professionals", body: "Follow salary, rent, EMIs, cards and subscriptions through the month, and build an emergency fund." },
  { who: "Couples and families", body: "Share household bills and goals, see who contributed, and keep personal spending personal." },
];

const FAQ = [
  { q: "Does Budget Buddy connect to my bank?", a: "Not today. You add transactions yourself or import a statement file. Any bank connection in future will use a regulated provider and ask for your consent first." },
  { q: "Can Budget Buddy move money or pay bills?", a: "No. It records and explains your finances. It never makes payments or transfers for you." },
  { q: "Is the free plan enough to start?", a: "Yes. Transactions, accounts, budgets, goals, CSV import and the core dashboard are free. You can always export or delete your data." },
  { q: "Who can see my data?", a: "You, and the people you add to a shared space with the role you choose. Personal accounts stay private even inside a shared space." },
  { q: "Is the AI assistant making up numbers?", a: "Amounts it quotes come from calculations on your recorded data, not from the model. It asks before it changes anything." },
];

const rupees = (minor: number) => formatMoney(minor, "INR", "en-IN").replace(/\.00$/, "");

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1fr_34rem] lg:py-24">
          <div>
            <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Your money deserves better management.
            </h1>
            <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-muted">
              Track expenses, plan budgets, manage subscriptions and understand your finances, all in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover">
                Get started for free
              </Link>
              <Link href="/#features" className="rounded-md border border-line-strong bg-surface px-5 py-3 text-sm font-semibold transition-colors hover:border-primary">
                Explore Budget Buddy
              </Link>
            </div>
          </div>
          <LedgerPreview />
        </section>

        {/* Problem / solution */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Money gets scattered</h2>
              <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
                Balances live in several apps, subscriptions renew quietly, and a month-end total rarely matches memory. When
                the numbers disagree, it is hard to trust any of them.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">One record you can trace</h2>
              <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
                Budget Buddy keeps a single ledger. Every figure on the dashboard can be followed back to the transactions
                behind it.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight">What you can do with it</h2>
          <dl className="mt-10 grid gap-x-12 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="border-t border-line-strong pt-4">
                <dt className="font-semibold">{f.title}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works: a real sequence, so it is numbered */}
        <section id="how-it-works" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="num grid h-8 w-8 place-items-center rounded-full bg-sage text-sm font-semibold">{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Audiences */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Built for how you live</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div key={a.who}>
                <h3 className="font-semibold">{a.who}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section className="border-y border-line bg-sage/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-[1fr_1.4fr]">
            <h2 className="text-3xl font-semibold tracking-tight">Your data stays yours</h2>
            <ul className="space-y-3 text-sm leading-relaxed text-muted">
              <li>Each person&apos;s data is protected by database-level access rules, not just by the interface.</li>
              <li>Card details never reach Budget Buddy. Payments go through the payment provider&apos;s own checkout.</li>
              <li>Export your data or delete your account whenever you like, on any plan.</li>
              <li>The AI assistant only works from your own recorded data and asks before it changes anything.</li>
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
          <p className="mt-3 max-w-[56ch] text-muted">Start free. Upgrade when you want forecasting and deeper reports.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {PLANS.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-3xl px-5 py-20">
            <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
            <div className="mt-8 divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span aria-hidden className="text-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-[22ch] text-3xl font-semibold tracking-tight">Start with one account and one budget.</h2>
          <Link href="/signup" className="mt-6 inline-block rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover">
            Get started for free
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const monthly = priceFor(plan, "month");
  const yearly = priceFor(plan, "year");
  return (
    <div className="rounded-md border border-line-strong bg-surface p-6">
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted">{plan.summary}</p>
      <p className="num mt-5 text-3xl font-semibold">
        {rupees(monthly?.amountMinor ?? 0)}
        <span className="text-sm font-normal text-muted"> / month</span>
      </p>
      {yearly ? <p className="num mt-1 text-sm text-muted">or {rupees(yearly.amountMinor)} billed yearly</p> : <p className="mt-1 text-sm text-muted">No card needed</p>}
      <ul className="mt-6 space-y-2 border-t border-line pt-5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
