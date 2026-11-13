import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/ui";
import { NAV_GROUPS } from "@/components/app/nav-items";

export const metadata: Metadata = { title: "All sections" };

/** Every destination, so secondary sections are one tap away on a phone. */
export default function MorePage() {
  return (
    <>
      <PageHeader title="All sections" />
      <div className="space-y-8">
        {NAV_GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h2 id={`g-${g.title}`} className="mb-2 text-sm font-semibold text-muted">
              {g.title}
            </h2>
            <ul className="divide-y divide-line border-y border-line">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="flex items-center gap-3 py-3.5 text-sm font-medium hover:text-primary">
                    <i.Icon size={18} aria-hidden className="text-muted" />
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <ul className="divide-y divide-line border-y border-line text-sm">
          <li><Link href="/help" className="block py-3.5 font-medium hover:text-primary">Help Centre</Link></li>
          <li><Link href="/contact" className="block py-3.5 font-medium hover:text-primary">Contact support</Link></li>
        </ul>
      </div>
    </>
  );
}
