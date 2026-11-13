import type { Metadata } from "next";
import { EmptyState, Money, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listAccounts } from "@/server/queries";
import { ACCOUNT_TYPE_LABEL, isLiability } from "@/server/types";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const ctx = await requireSpace();
  const accounts = await listAccounts(ctx);
  const holds = accounts.filter((a) => !isLiability(a.type));
  const owes = accounts.filter((a) => isLiability(a.type));

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from the transactions you record, starting from the balance you entered. They are not live bank balances."
        action={{ href: "/app/accounts/new", label: "Add account" }}
      />
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet" body="Add the places your money is kept: bank accounts, cash, wallets and cards." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <div className="space-y-10">
          <AccountGroup title="Money you hold" rows={holds} currency={ctx.space.currency} />
          {owes.length ? <AccountGroup title="Money you owe" rows={owes} currency={ctx.space.currency} owed /> : null}
        </div>
      )}
    </>
  );
}

function AccountGroup({ title, rows, currency, owed }: { title: string; rows: Awaited<ReturnType<typeof listAccounts>>; currency: string; owed?: boolean }) {
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
            <div className="text-right">
              <Money minor={a.balance} currency={a.currency} className={`text-sm font-medium ${owed && a.balance > 0 ? "text-neg-text" : ""}`} />
              {owed ? <p className="text-xs text-muted">owed</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
