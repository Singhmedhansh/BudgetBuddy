import type { Metadata } from "next";
import { Select } from "@/components/ui/Select";
import Link from "next/link";
import { notFound } from "next/navigation";
import { commitImportAction, matchStatementBalanceAction, type JobRow } from "@/app/app/import/actions";
import { balanceAsOf, BANK_LIKE } from "@/server/statement-match";
import { Money, Notice, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listCategories } from "@/server/queries";

export const metadata: Metadata = { title: "Review import" };

const FLAG = {
  new: { label: "New", tone: "text-muted" },
  already_imported: { label: "Already imported", tone: "text-info-text" },
  possible_duplicate: { label: "Possible duplicate of a recorded transaction", tone: "text-warn-text" },
} as const;

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ job: string }>; searchParams: Promise<{ error?: string; matched?: string }> }) {
  const { job: id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireSpace();
  const { data: job } = await ctx.supabase.from("import_jobs").select("*").eq("id", id).maybeSingle();
  if (!job) notFound();
  const rows = job.rows as JobRow[];
  const problems = (job.problems ?? []) as { line: number; reason: string }[];
  const c = ctx.space.currency;
  const closing = job.statement_closing_minor == null ? null : Number(job.statement_closing_minor);
  const closingDate = (job.statement_closing_date as string | null) ?? null;
  const { data: acct } = closing !== null ? await ctx.supabase.from("accounts").select("name, type").eq("id", job.account_id).maybeSingle() : { data: null };
  const matchable = closing !== null && closingDate !== null && acct && BANK_LIKE.has(acct.type as string);
  const asOf = matchable ? await balanceAsOf(ctx, job.account_id as string, closingDate!) : null;

  if (job.status === "committed") {
    const s = (job.summary ?? {}) as { imported?: number; skipped_already_imported?: number; excluded?: number };
    return (
      <>
        <PageHeader back={{ href: "/app/import" }} title="Import finished" description={job.filename as string} />
        <Notice kind="success">
          Imported {s.imported ?? 0} transaction{s.imported === 1 ? "" : "s"}. {s.skipped_already_imported ? `${s.skipped_already_imported} were already imported and skipped. ` : ""}
          {s.excluded ? `${s.excluded} were left out by you or flagged for review.` : ""}
        </Notice>
        {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
        {sp.matched ? <Notice kind="success">{acct?.name ?? "The account"} now matches the balance on your statement.</Notice> : null}
        {matchable && asOf !== null && asOf !== closing ? (
          <section aria-labelledby="match" className="mb-6 rounded-xl border border-warn/50 bg-warn/10 p-5 text-sm">
            <h2 id="match" className="font-semibold">Your bank says <Money minor={closing!} currency={c} />, FinTrack says <Money minor={asOf} currency={c} /></h2>
            <p className="mt-2 max-w-[62ch] leading-relaxed text-muted">On {closingDate}, the statement&rsquo;s closing balance and {acct!.name} in FinTrack differ by <Money minor={Math.abs(closing! - asOf)} currency={c} />. This usually means the opening balance was never entered, or some transactions from before this statement are missing. Matching adds one adjustment, labelled &ldquo;Balance matched to bank statement&rdquo;, that you can reverse at any time.</p>
            <form action={matchStatementBalanceAction} className="mt-4">
              <input type="hidden" name="job" value={id} />
              <button type="submit" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Match FinTrack to the statement</button>
            </form>
          </section>
        ) : matchable && asOf === closing && !sp.matched ? (
          <p className="mb-6 text-sm text-pos-text">{acct!.name} matches the closing balance on your statement (<Money minor={closing!} currency={c} /> on {closingDate}).</p>
        ) : null}
        {problems.length > 0 ? (
          <p className="mb-6 text-sm">
            {problems.length} row{problems.length === 1 ? "" : "s"} in the file could not be read. <a href={`/app/import/${id}/errors`} className="font-medium text-primary hover:underline">Download the error report (CSV)</a>.
          </p>
        ) : null}
        <div className="flex gap-4 text-sm">
          <Link href="/app/transactions" className="font-medium text-primary hover:underline">View transactions</Link>
          <Link href="/app/import" className="text-muted hover:text-fg">Import another file</Link>
        </div>
      </>
    );
  }

  const [expense, income] = await Promise.all([listCategories(ctx, "expense"), listCategories(ctx, "income")]);
  const counts = { new: 0, already_imported: 0, possible_duplicate: 0 };
  rows.forEach((r) => counts[r.flag]++);

  return (
    <>
      <PageHeader back={{ href: "/app/import" }} title="Review import" description={`${job.filename as string}. Nothing is saved until you confirm. Untick any row to leave it out and change a category if the suggestion is wrong.`} />
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}
      <p className="mb-6 text-sm text-muted">
        {rows.length} readable row{rows.length === 1 ? "" : "s"}: {counts.new} new, {counts.already_imported} already imported (left out), {counts.possible_duplicate} possible duplicate{counts.possible_duplicate === 1 ? "" : "s"} (left out until you tick them).
        {problems.length > 0 ? (
          <> {problems.length} row{problems.length === 1 ? "" : "s"} could not be read, see below.</>
        ) : null}
      </p>

      {matchable && asOf !== null ? (
        <p className="mb-6 rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed">
          Your statement ends on {closingDate} with a balance of <Money minor={closing!} currency={c} className="font-semibold" />. With the ticked new rows, FinTrack would show about{" "}
          <Money minor={asOf + rows.filter((r) => r.include && r.date <= closingDate!).reduce((t, r) => t + r.amount, 0)} currency={c} className="font-semibold" /> for {acct!.name} on that date. If they differ after the import, you can match them in one step.
        </p>
      ) : null}

      <form action={commitImportAction}>
        <input type="hidden" name="job" value={id} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Rows to import</caption>
            <thead>
              <tr className="border-b border-line-strong text-left text-xs text-muted">
                <th scope="col" className="w-10 py-2 pr-2 font-medium">Import</th>
                <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                <th scope="col" className="py-2 pr-3 font-medium">Description</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
                <th scope="col" className="py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const cats = r.amount > 0 ? income : expense;
                const f = FLAG[r.flag];
                return (
                  <tr key={i} className="align-top">
                    <td className="py-3 pr-2">
                      <input type="checkbox" name={`include_${i}`} defaultChecked={r.include} aria-label={`Import row ${r.line}: ${r.description}`} className="accent-[var(--primary)]" />
                    </td>
                    <td className="num whitespace-nowrap py-3 pr-3">{r.date}</td>
                    <td className="py-3 pr-3">
                      {r.description}
                      {r.flag !== "new" ? <span className={`block text-xs ${f.tone}`}>{f.label}</span> : null}
                    </td>
                    <td className="py-3 pr-3 text-right"><Money minor={r.amount} currency={c} signed className={r.amount > 0 ? "text-pos-text" : ""} /></td>
                    <td className="py-3">
                      <Select name={`cat_${i}`} defaultValue={r.category_id} label={`Category for row ${r.line}`} size="sm" className="min-w-40 max-w-[14rem]" options={cats.map((cat) => ({ value: cat.id, label: cat.name }))} />
                      {r.suggested ? <span className="block text-xs text-muted">{r.ai ? "Suggested by AI, please check" : "Suggested from earlier transactions"}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {problems.length > 0 ? (
          <details className="mt-8 rounded-md border border-line-strong p-4 text-sm">
            <summary className="cursor-pointer font-medium">{problems.length} row{problems.length === 1 ? "" : "s"} could not be read</summary>
            <ul className="mt-3 space-y-1 text-muted">
              {problems.slice(0, 50).map((p) => (<li key={p.line}>Line {p.line}: {p.reason}</li>))}
            </ul>
            <a href={`/app/import/${id}/errors`} className="mt-3 inline-block font-medium text-primary hover:underline">Download the full error report (CSV)</a>
          </details>
        ) : null}

        <div className="mt-8 flex items-center gap-4">
          <button type="submit" className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Confirm and import</button>
          <Link href="/app/import" className="text-sm text-muted hover:text-fg">Cancel</Link>
        </div>
      </form>
    </>
  );
}
