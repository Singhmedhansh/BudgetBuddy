import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { EditDetailsForm } from "@/components/app/txn-forms";
import { atLeast, requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "Edit transaction details" };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireSpace();
  const back = { href: "/app/transactions" };
  const { data: t } = await ctx.supabase.from("transactions").select("id,merchant,description,notes,type").eq("space_id", ctx.space.id).eq("id", id).maybeSingle();
  if (!t) notFound();
  if (!atLeast(ctx.role, "editor")) {
    return (
      <>
        <PageHeader back={back} title="Edit details" />
        <EmptyState title="View-only access" body="Ask an admin for editor access to change transaction details." />
      </>
    );
  }
  return (
    <div className="max-w-lg">
      <PageHeader back={back} title="Edit details" description="You can correct the merchant, description and notes. The amount, date, account and category are part of the ledger and are never edited: reverse the transaction and enter it again instead." />
      <EditDetailsForm id={id} merchant={(t.merchant as string | null) ?? ""} description={(t.description as string | null) ?? ""} notes={(t.notes as string | null) ?? ""} />
    </div>
  );
}
