import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RenameAccountForm } from "@/components/app/forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { atLeast, requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "Rename account" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireSpace();
  const { data: a } = await ctx.supabase.from("accounts").select("id,name").eq("space_id", ctx.space.id).eq("id", id).maybeSingle();
  if (!a) notFound();
  const back = { href: "/app/accounts" };
  if (!atLeast(ctx.role, "editor")) {
    return (
      <>
        <PageHeader back={back} title="Rename account" />
        <EmptyState title="View-only access" body="Ask an admin for editor access to change accounts." />
      </>
    );
  }
  return (
    <div className="max-w-lg">
      <PageHeader back={back} title="Rename account" description="The balance is not edited here. It comes from the transactions you record." />
      <RenameAccountForm id={id} name={a.name as string} />
    </div>
  );
}
