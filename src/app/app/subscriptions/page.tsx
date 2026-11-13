import type { Metadata } from "next";
import { RecurringList } from "@/components/app/RecurringList";
import { requireSpace } from "@/server/context";
import { listRecurring } from "@/server/planning";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const items = await listRecurring(ctx, "subscription");
  return <RecurringList kind="subscription" items={items} currency={ctx.space.currency} flags={{ added: sp.added, settled: sp.settled, error: sp.error }} />;
}
