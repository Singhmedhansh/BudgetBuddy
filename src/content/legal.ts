import { PLANS, formatPrice, planName, priceFor } from "@/config/plans";
import type { Block } from "./help/articles";

const ONE = PLANS.find((x) => x.id === "pro")!;
const oneMonthly = formatPrice(priceFor(ONE, "month")!);
const oneYearly = formatPrice(priceFor(ONE, "year")!);

/**
 * Policy text for the product as built today. These are drafts for qualified
 * legal review before public launch: they make no compliance claims, and they
 * describe capabilities that are not live yet (paid plans, AI assistant, bank
 * connections) only as not live. Update this file in the same change as any
 * feature that alters what data is collected or shared.
 */
export const LEGAL_UPDATED = "13 November 2026";

export interface LegalDoc {
  slug: string;
  title: string;
  summary: string;
  sections: { heading: string; blocks: Block[] }[];
}

const p = (text: string): Block => ({ t: "p", text });
const list = (...items: string[]): Block => ({ t: "list", items });

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What FinTrack collects, why, who handles it, and the choices you have.",
    sections: [
      {
        heading: "What we collect",
        blocks: [
          list(
            "Account details: your name, email address and a password. Passwords are handled by our authentication provider and are not stored in readable form.",
            "Financial records you enter: accounts, balances, transactions, categories, budgets and notes. You choose what to enter; FinTrack does not connect to your bank.",
            "Messages you send to support, including any file you attach.",
            "Technical data needed to run the service, such as the cookies described in the Cookie Policy and standard server logs.",
          ),
          p("We do not run advertising or behavioural analytics on the product today. If that changes, this policy and the Cookie Policy will be updated first."),
        ],
      },
      {
        heading: "Why we use it",
        blocks: [list("To provide the service: sign you in, calculate balances, budgets and totals, and show them back to you.", "To keep the service secure and prevent abuse.", "To answer your support requests.", "To meet legal obligations.")],
      },
      {
        heading: "Who handles your data",
        blocks: [
          p("We use service providers to run FinTrack. Today these are a database, authentication and file-storage provider (Supabase) and a web hosting provider. They process data on our behalf and only to provide those services."),
          p("Paid plans, when they launch, will use Razorpay for customers in India and PayPal for international customers. Card numbers go to the payment provider and never reach FinTrack. Payments are not live today."),
          p("An AI assistant is planned but is not available. Before it launches we will describe here what data it uses and give you a way to opt out."),
          p("We do not sell your personal data."),
        ],
      },
      {
        heading: "Where data is stored",
        blocks: [p("Your data is stored with our database provider in the region it is configured for. Our providers may process data in other countries. We will describe transfers more precisely, with the legal basis for them, after legal review.")],
      },
      {
        heading: "Keeping data and deleting it",
        blocks: [
          p("We keep your records while your account is open. Your financial history is kept intact on purpose: transactions are reversed, not deleted, so reports stay accurate."),
          p("To export or delete your data, or to close your account, use [Contact us](/contact) and choose Account. A self-service export and deletion tool is planned and this section will be updated when it ships."),
        ],
      },
      {
        heading: "Your rights",
        blocks: [p("Depending on where you live you may have rights to access, correct, export or delete your personal data, and to object to or restrict some processing. Contact us to use them. The specific rights and how we handle them will be confirmed after legal review of the laws that apply to our users, including India's data protection law.")],
      },
      {
        heading: "Security",
        blocks: [p("Access to your data is controlled in the database itself, so another user cannot read your records. See [Security and privacy](/security). No system is perfectly secure, and we cannot guarantee absolute security.")],
      },
      { heading: "Contact", blocks: [p("Questions about this policy: [Contact us](/contact).")] },
    ],
  },
  {
    slug: "terms",
    title: "Terms and Conditions",
    summary: "The terms that apply when you create a FinTrack account and use its tracking, budgeting and planning tools.",
    sections: [
      {
        heading: "Using FinTrack",
        blocks: [
          p("By creating an account you agree to these terms. You must be old enough to form a binding contract where you live, and you must give accurate information."),
          p("You are responsible for your account and for keeping your password private. Tell us promptly if you think someone else has access."),
        ],
      },
      {
        heading: "Acceptable use",
        blocks: [list("Do not break the law or help others to.", "Do not try to access other people's data, probe or disrupt the service, or bypass its limits.", "Do not upload malicious files or send abusive messages to support.")],
      },
      {
        heading: "Your data and our service",
        blocks: [
          p("You own the financial records you enter. You give us permission to store and process them to run the service for you."),
          p("FinTrack is a tool for recording and understanding your finances. It is not financial advice. See the [Financial disclaimer](/legal/disclaimer)."),
        ],
      },
      {
        heading: "Plans and payment",
        blocks: [p("The free plan has no charge. Paid plans are not available yet. When they are, prices, billing periods and cancellation will be shown before you pay and are described in [Pricing and billing](/legal/billing). Refunds are covered by the [Refund policy](/legal/refunds).")],
      },
      {
        heading: "Availability and changes",
        blocks: [p("We aim to keep the service available but cannot promise it will always be uninterrupted or error-free. We may change features, with reasonable notice for changes that materially affect you.")],
      },
      {
        heading: "Ending your account",
        blocks: [p("You can stop using FinTrack at any time and ask us to close your account through [Contact us](/contact). We may suspend or end accounts that break these terms.")],
      },
      {
        heading: "Liability and disputes",
        blocks: [p("Nothing in these terms limits rights you have by law that cannot be limited. The extent to which we limit our liability, the governing law and how disputes are resolved will be set out here once confirmed by legal review.")],
      },
    ],
  },
  {
    slug: "refunds",
    title: "Refund Policy",
    summary: "How refunds work for paid plans, once they are available.",
    sections: [
      {
        heading: "The free plan",
        blocks: [p("The free plan costs nothing, so there is nothing to refund.")],
      },
      {
        heading: "Paid plans",
        blocks: [
          p("Paid plans are not available yet. When they launch, this is how refunds will work:"),
          list(
            "Refund requests are reviewed under these terms and the law that applies to you. Where consumer law gives you a right, that right comes first.",
            "A duplicate charge, where you were billed twice for the same period, is investigated and refunded once verified.",
            "If you see a charge you did not authorise, tell us through [Contact us](/contact) and we will investigate.",
            "Cancelling stops future renewals. It does not automatically refund a billing period that has already been charged.",
          ),
          p("How long a refund takes to reach you depends on your bank and the payment provider. We will state expected timelines here once they are confirmed with our payment providers."),
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The cookies and browser storage FinTrack uses, and why.",
    sections: [
      {
        heading: "What we set",
        blocks: [
          p("FinTrack uses only what it needs to work. There are no advertising or analytics cookies today."),
          {
            t: "list",
            items: [
              "sb-budgetbuddy-auth-token (cookie, essential): keeps you signed in. It lasts until you log out or the session ends.",
              "bb-recovery (cookie, essential, 15 minutes): set only after you open a valid password-reset link, so only that session can set a new password.",
              "bb-last-provider (cookie, convenience, 180 days): remembers whether you last signed in with email or Google on this device, to show a hint on the login page. It stores no email address.",
              "bb-theme (browser storage, convenience): remembers your light, dark or device theme choice.",
            ],
          },
        ],
      },
      {
        heading: "Your choices",
        blocks: [p("The essential items are needed for the service to work, so they are not optional while you are signed in. You can clear cookies and browser storage in your browser settings; you will be signed out and your theme resets to light. If we add optional cookies later, we will ask for your consent first.")],
      },
    ],
  },
  {
    slug: "billing",
    title: "Pricing and Billing",
    summary: "The FinTrack Free and FinTrack One plans, their prices, and how billing will work once paid plans are available.",
    sections: [
      {
        heading: "Plans",
        blocks: [
          p(`${planName("free")} costs nothing. ${planName("pro")} is ${oneMonthly} a month, or ${oneYearly} a year. Prices are shown on the [home page](/#pricing) in the currency they are charged in, and you will see the final amount before you pay. Paid plans are not available yet.`),
        ],
      },
      {
        heading: "How billing will work",
        blocks: [
          list(
            "Customers in India are billed in INR through Razorpay. International customers are billed through PayPal in a supported currency.",
            "Which provider applies is decided by us from your billing details, not guessed from your browser.",
            "We never silently change the currency you are charged in.",
            `Whether you have ${planName("pro")} is decided by our servers after the payment provider confirms payment, never by your browser.`,
            "You can cancel at any time. Cancelling stops future renewals; see the [Refund policy](/legal/refunds).",
          ),
        ],
      },
      {
        heading: "Always free",
        blocks: [p("Exporting your data, deleting your account and the security controls are never behind a paywall.")],
      },
    ],
  },
  {
    slug: "disclaimer",
    title: "Financial Disclaimer",
    summary: "What FinTrack is and is not: a tool for tracking and planning, not financial, tax or investment advice.",
    sections: [
      {
        heading: "Not financial advice",
        blocks: [p("FinTrack helps you record, organise and understand your own finances. It does not provide investment, tax, legal or other professional advice, and nothing in it is a recommendation to buy or sell anything. Speak to a qualified professional for advice about your situation.")],
      },
      {
        heading: "Your numbers come from you",
        blocks: [
          p("Balances and totals are calculated from the records you enter. They are not connected to your bank and may differ from your bank or card statements until everything is recorded. Do not rely on them to confirm what a lender or bank says you owe or hold."),
          p("Estimates and forecasts, where we provide them, are labelled as estimates. They are based on stated assumptions and are not guarantees of what will happen."),
        ],
      },
      {
        heading: "Your responsibility",
        blocks: [p("You are responsible for decisions you make using FinTrack. We take care to calculate correctly, and we want to know if you find a mistake: [Contact us](/contact).")],
      },
    ],
  },
];

export const legalBySlug = (slug: string) => LEGAL_DOCS.find((d) => d.slug === slug);
