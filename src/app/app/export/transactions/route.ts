import { toCsv, type Cell } from "@/domain/csv";
import { displayAmount } from "@/domain/display";
import { toDecimalString } from "@/domain/money";
import { startOfLocalDay } from "@/domain/period";
import { parseDate } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { listTransactions } from "@/server/queries";

/** All transactions as CSV, optionally limited to ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, in your timezone). */
export async function GET(request: Request) {
  const ctx = await requireSpace();
  const url = new URL(request.url);
  const tz = ctx.profile.timezone;
  const day = (s: string | null, add = 0) => {
    if (!s) return undefined;
    try {
      const { y, m, d } = parseDate(s);
      return new Date(startOfLocalDay(y, m, d + add, tz));
    } catch {
      return undefined;
    }
  };
  const from = day(url.searchParams.get("from"));
  const to = day(url.searchParams.get("to"), 1); // inclusive end date
  if ((url.searchParams.get("from") && !from) || (url.searchParams.get("to") && !to)) return new Response("Dates must look like 2026-04-30.", { status: 400 });

  const rows = await listTransactions(ctx, { limit: 100000, from, to });
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const out: Cell[][] = [["Date", "Type", "Status", "Account", "Category", "Merchant", "Description", "Amount", "Currency", "Source", "Reversal of", "Reference"]];
  for (const t of rows) {
    out.push([
      fmt.format(new Date(t.occurred_at)),
      t.type,
      t.reversed ? "reversed" : t.status,
      t.accountNames.join(" -> "),
      t.categoryName ?? "",
      t.merchant ?? "",
      t.description ?? "",
      { raw: toDecimalString(displayAmount({ type: t.type, amount: t.amount, isReversal: Boolean(t.reversal_of) }), t.currency) },
      t.currency,
      t.source,
      t.reversal_of ?? "",
      t.id,
    ]);
  }
  return new Response(toCsv(out), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fintrack-transactions.csv"',
      "Cache-Control": "no-store",
    },
  });
}
