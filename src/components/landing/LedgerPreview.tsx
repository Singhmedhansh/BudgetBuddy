import {
  accountBalance,
  expensePosting,
  incomePosting,
  netWorth,
  periodTotals,
  refundPosting,
  transferPosting,
  type LedgerAccount,
  type Posting,
} from "@/domain/ledger";
import { formatMoney } from "@/domain/money";
import { monthRange } from "@/domain/period";

/**
 * A worked example rendered from the real ledger code. The numbers are sample
 * data, labelled as such on the page, and every figure shown is computed by the
 * same functions the product uses, not typed in.
 */
const accounts: LedgerAccount[] = [
  { id: "bank", kind: "asset", currency: "INR" },
  { id: "savings", kind: "asset", currency: "INR" },
  { id: "card", kind: "liability", currency: "INR" },
  { id: "groceries", kind: "expense", currency: "INR" },
  { id: "transport", kind: "expense", currency: "INR" },
  { id: "salary", kind: "income", currency: "INR" },
];

interface Row {
  label: string;
  detail: string;
  posting: Posting;
  note?: string;
}

function buildRows(): Row[] {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day, 6, 30));
  const salary = incomePosting({ id: "1", occurredAt: at(1), amount: 6_500_000, accountId: "bank", sourceId: "salary" });
  const groceries = expensePosting({ id: "2", occurredAt: at(3), amount: 184_250, accountId: "bank", categoryId: "groceries" });
  const toSavings = transferPosting({ id: "3", occurredAt: at(4), amount: 1_000_000, fromAccountId: "bank", toAccountId: "savings" });
  const cab = expensePosting({ id: "4", occurredAt: at(6), amount: 38_000, accountId: "card", categoryId: "transport" });
  const refund = refundPosting({ id: "5", occurredAt: at(8), amount: 38_000, accountId: "card" }, cab, [cab]);
  return [
    { label: "Salary", detail: "Income to Bank", posting: salary },
    { label: "Fresh Basket", detail: "Groceries from Bank", posting: groceries },
    { label: "Move to Savings", detail: "Transfer", posting: toSavings, note: "Not counted as spending" },
    { label: "City Cabs", detail: "Transport on Card", posting: cab },
    { label: "City Cabs refund", detail: "Refund of the 6 Nov ride", posting: refund, note: "Nets out Transport" },
  ];
}

const money = (n: number) => formatMoney(n, "INR");

export function LedgerPreview() {
  const rows = buildRows();
  const all = rows.map((r) => r.posting);
  const { from, to } = monthRange(2026, 11, "Asia/Kolkata");
  const totals = periodTotals(accounts, all, from, to);
  const bank = accounts[0];

  return (
    <figure className="w-full max-w-[34rem]" aria-labelledby="ledger-caption">
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Bank account</p>
          <p className="text-xs text-muted">November, running balance</p>
        </div>
        <ol>
          {rows.map((r, i) => {
            const upTo = all.slice(0, i + 1);
            const amount = r.posting.entries.find((e) => e.accountId === "bank" || e.accountId === "card")?.amount ?? 0;
            const touchesBank = r.posting.entries.some((e) => e.accountId === "bank");
            return (
              <li key={r.posting.id} className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.label}</p>
                  <p className="truncate text-xs text-muted">
                    {r.detail}
                    {r.note ? <span className="text-info-text"> · {r.note}</span> : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`num text-sm font-medium ${amount >= 0 ? "text-pos-text" : "text-fg"}`}>
                    {amount > 0 ? "+" : ""}
                    {money(amount)}
                  </p>
                  <p className="num text-xs text-muted">
                    {touchesBank ? `Bank ${money(accountBalance(bank, upTo))}` : `Card owed ${money(accountBalance(accounts[2], upTo))}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <dl className="grid grid-cols-3 border-t border-line-strong bg-sunken text-sm">
          <Stat label="Income" value={money(totals.income)} />
          <Stat label="Spending" value={money(totals.expenses)} />
          <Stat label="Net worth" value={money(netWorth(accounts, all))} />
        </dl>
      </div>
      <figcaption id="ledger-caption" className="mt-3 max-w-prose text-xs leading-relaxed text-muted">
        Example data, calculated by FinTrack&apos;s own ledger. The savings transfer is not spending, and the refund
        reduces Transport instead of counting as income.
      </figcaption>
    </figure>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-line px-4 py-3 last:border-r-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
