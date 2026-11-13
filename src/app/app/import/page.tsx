import type { Metadata } from "next";
import Link from "next/link";
import { ImportForm } from "@/components/app/ImportForm";
import { EmptyState, formatDate, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listAccounts } from "@/server/queries";

export const metadata: Metadata = { title: "Import and export" };

export default async function ImportPage() {
  const ctx = await requireSpace();
  const [accounts, { data: jobs }] = await Promise.all([
    listAccounts(ctx),
    ctx.supabase.from("import_jobs").select("id,filename,status,created_at,summary").eq("space_id", ctx.space.id).order("created_at", { ascending: false }).limit(8),
  ]);

  return (
    <>
      <PageHeader title="Import and export" description="Bring in a bank statement, review every row, and confirm. Importing the same file twice never creates duplicates. Your data is always yours to take out." help={{ slug: "import-a-statement", label: "importing a statement" }} />

      <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr]">
        <section aria-labelledby="imp">
          <h2 id="imp" className="mb-4 font-semibold">Import a statement</h2>
          {accounts.length === 0 ? (
            <EmptyState title="Add an account first" body="A statement is imported into one of your accounts." action={{ href: "/app/accounts/new", label: "Add an account" }} />
          ) : (
            <ImportForm accounts={accounts} />
          )}
        </section>

        <section aria-labelledby="exp">
          <h2 id="exp" className="mb-4 font-semibold">Export your data</h2>
          <ul className="space-y-4 text-sm">
            <li>
              <a href="/app/export/transactions" className="font-medium text-primary underline-offset-2 hover:underline">Download all transactions (CSV)</a>
              <p className="mt-0.5 text-xs text-muted">Opens in Excel or Google Sheets. Add ?from=2026-04-01&amp;to=2026-04-30 to the address for a date range.</p>
            </li>
            <li>
              <a href="/app/export/all" className="font-medium text-primary underline-offset-2 hover:underline">Download everything (JSON)</a>
              <p className="mt-0.5 text-xs text-muted">Accounts, categories, transactions with their ledger entries, budgets, goals, bills and debt terms.</p>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted">Exports are free on every plan.</p>

          {jobs && jobs.length > 0 ? (
            <div className="mt-10">
              <h2 className="mb-2 font-semibold">Recent imports</h2>
              <ul className="divide-y divide-line border-y border-line text-sm">
                {jobs.map((j) => (
                  <li key={j.id as string} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/app/import/${j.id}`} className="truncate text-primary hover:underline">{j.filename as string}</Link>
                    <span className="shrink-0 text-xs text-muted">
                      {j.status === "committed" ? `Imported ${(j.summary as { imported?: number } | null)?.imported ?? 0}` : j.status === "preview" ? "Waiting for review" : "Cancelled"} · {formatDate(j.created_at as string, ctx.profile.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
