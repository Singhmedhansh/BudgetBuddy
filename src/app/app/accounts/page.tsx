import type { Metadata } from "next";
import Link from "next/link";
import { setAccountArchivedAction } from "@/app/app/manage-actions";
import { EmptyState, Money, Notice, PageHeader } from "@/components/app/ui";
import { atLeast, requireSpace } from "@/server/context";
import { listAccounts } from "@/server/queries";
import { ACCOUNT_TYPE_LABEL, isLiability } from "@/server/types";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const all = await listAccounts(ctx, true);
  const accounts = all.filter((a) => !a.archived_at);
  const archived = all.filter((a) => a.archived_at);
  const canEdit = atLeast(ctx.role, "editor");
  const holds = accounts.filter((a) => !isLiability(a.type));
  const owes = accounts.filter((a) => isLiability(a.type));

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from the transactions you record, starting from the balance you entered. They are not live bank balances."
        action={canEdit ? { href: "/app/accounts/new", label: "Add account" } : undefined}
        help={{ slug: "balances-explained", label: "what an account balance means" }}
      />
      {sp.renamed ? <Notice kind="success">Account renamed.</Notice> : null}
      {sp.archived ? <Notice kind="success">Account archived. It is hidden from new transactions and totals, and its history is kept.</Notice> : null}
      {sp.restored ? <Notice kind="success">Account restored.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That account could not be found." : sp.error}</Notice> : null}
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet" body="Add the places your money is kept: bank accounts, cash, wallets and cards." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <div className="space-y-10">
          <AccountGroup title="Money you hold" rows={holds} currency={ctx.space.currency} canEdit={canEdit} />
          {owes.length ? <AccountGroup title="Money you owe" rows={owes} currency={ctx.space.currency} owed canEdit={canEdit} /> : null}
        </div>
      )}
      {archived.length ? (
        <section aria-label="Archived accounts" className="mt-12">
          <h2 className="mb-2 font-semibold text-muted">Archived</h2>
          <ul className="divide-y divide-line border-y border-line">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-3 text-sm text-muted">
                <span>{a.name}</span>
                {canEdit ? (
                  <form action={setAccountArchivedAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="archive" value="no" />
                    <button type="submit" className="text-primary underline hover:no-underline" aria-label={`Restore ${a.name}`}>Restore</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function AccountGroup({ title, rows, currency, owed, canEdit }: { title: string; rows: Awaited<ReturnType<typeof listAccounts>>; currency: string; owed?: boolean; canEdit: boolean }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, a) => s + a.balance, 0);
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        <Money minor={total} currency={currency} className="text-sm text-muted" />
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted">{ACCOUNT_TYPE_LABEL[a.type]} · entered by you</p>
            </div>
            <div className="flex items-center gap-5">
            {canEdit ? (
              <div className="flex items-center gap-3 text-xs">
                <Link href={`/app/accounts/${a.id}/edit`} className="text-muted underline hover:text-fg" aria-label={`Rename ${a.name}`}>Rename</Link>
                <form action={setAccountArchivedAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="archive" value="yes" />
                  <button type="submit" className="text-muted underline hover:text-fg" aria-label={`Archive ${a.name}`}>Archive</button>
                </form>
              </div>
            ) : null}
            <div className="text-right">
              <Money minor={a.balance} currency={a.currency} className={`text-sm font-medium ${owed && a.balance > 0 ? "text-neg-text" : ""}`} />
              {owed ? <p className="text-xs text-muted">owed</p> : null}
            </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
