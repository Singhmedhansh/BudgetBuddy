import type { Metadata } from "next";
import Link from "next/link";
import { ArticleBody } from "@/components/help/RichText";
import { PublicPage } from "@/components/landing/PublicPage";
import type { Block } from "@/content/help/articles";

export const metadata: Metadata = {
  title: "Security and privacy",
  description: "How Budget Buddy protects your data and what it cannot do.",
  alternates: { canonical: "/security" },
};

const SECTIONS: { heading: string; blocks: Block[] }[] = [
  {
    heading: "How your data is protected",
    blocks: [
      {
        t: "list",
        items: [
          "Access rules live in the database. Every table that holds your records has row-level security, so a request can only read rows your account is allowed to see, whatever the screen asks for.",
          "In a shared space, you only see what your role allows, and a private account stays private to you.",
          "Recorded transactions are never edited or deleted. Corrections are added as reversals, so there is always an audit trail.",
          "Files you upload live in private storage, and are readable only by people with access to that space.",
          "Passwords are handled by our authentication provider. Password-reset links work once and expire after an hour, and a reset signs your other devices out.",
          "Your session cookie is kept separate from any other application, so being signed in elsewhere never signs you in here.",
        ],
      },
    ],
  },
  {
    heading: "What Budget Buddy does not do",
    blocks: [
      {
        t: "list",
        items: [
          "It never asks for your bank password and does not scrape bank sites.",
          "It does not see your card number. Payments, when they launch, use the payment provider's own checkout.",
          "It cannot move money or pay bills.",
          "It does not sell your data.",
        ],
      },
    ],
  },
  {
    heading: "What we cannot promise",
    blocks: [
      { t: "p", text: "No online service is perfectly secure. We cannot promise it, and we have not claimed any security certification or regulatory approval. If you find a vulnerability, tell us through [Contact us](/contact) and choose Something is broken, without sharing it publicly first." },
    ],
  },
  {
    heading: "Your part",
    blocks: [{ t: "list", items: ["Use a unique password and log out on shared devices.", "Never share a reset link.", "Tell us straight away if you suspect someone else has used your account."] }],
  },
];

export default function SecurityPage() {
  return (
    <PublicPage>
      <h1 className="text-3xl font-semibold tracking-tight">Security and privacy</h1>
      <p className="mt-2 max-w-[60ch] text-muted">Plain answers about how your financial records are protected. For how we handle personal data, read the <Link href="/legal/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>.</p>
      <div className="mt-10 space-y-10">
        {SECTIONS.map((s) => (
          <section key={s.heading} aria-labelledby={`s-${s.heading}`}>
            <h2 id={`s-${s.heading}`} className="mb-3 text-lg font-semibold">
              {s.heading}
            </h2>
            <ArticleBody blocks={s.blocks} />
          </section>
        ))}
      </div>
    </PublicPage>
  );
}
