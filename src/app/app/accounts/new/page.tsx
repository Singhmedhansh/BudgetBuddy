import type { Metadata } from "next";
import { AccountForm } from "@/components/app/forms";
import { PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "Add account" };

export default async function NewAccountPage() {
  const { space } = await requireSpace();
  return (
    <div className="max-w-lg">
      <PageHeader title="Add account" description="Enter the balance as it is today. Later changes come from the transactions you record." />
      <AccountForm mode="page" currency={space.currency} cancelHref="/app/accounts" />
    </div>
  );
}
