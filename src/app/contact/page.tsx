import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ContactForm } from "@/components/help/ContactForm";
import { PublicPage } from "@/components/landing/PublicPage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Send Budget Buddy support a message and get a reference number.",
  alternates: { canonical: "/contact" },
};

type SP = Promise<{ topic?: string; subject?: string }>;

export default function ContactPage({ searchParams }: { searchParams: SP }) {
  return (
    <PublicPage width="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="mt-2 max-w-[56ch] text-muted">
        Check the{" "}
        <Link href="/help" className="font-medium text-primary hover:underline">
          Help Centre
        </Link>{" "}
        first, because many questions are answered there. If not, send us a message.
      </p>
      <Suspense fallback={<div className="mt-8 space-y-4" aria-hidden>{[0, 1, 2].map((i) => (<div key={i} className="h-11 animate-pulse rounded-md bg-line" />))}</div>}>
        <FormLoader searchParams={searchParams} />
      </Suspense>
      <SupportEmail />
    </PublicPage>
  );
}

async function FormLoader({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection(); // the session read below must happen at request time, never during prerender
  const supabase = await createClient();
  const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  return (
    <div className="mt-8">
      <ContactForm defaults={{ email: data.user?.email ?? "", topic: sp.topic ?? "", subject: (sp.subject ?? "").slice(0, 150) }} signedIn={Boolean(data.user)} />
    </div>
  );
}

/** Shown only when a verified address is configured. A made-up address is never displayed. */
function SupportEmail() {
  const email = process.env.SUPPORT_EMAIL;
  if (!email) return null;
  return (
    <p className="mt-10 border-t border-line pt-6 text-sm text-muted">
      You can also write to <a className="font-medium text-primary hover:underline" href={`mailto:${email}`}>{email}</a>.
    </p>
  );
}
