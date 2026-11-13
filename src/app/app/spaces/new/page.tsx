import type { Metadata } from "next";
import { SpaceForm } from "@/components/app/space-ui";
import { PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "New shared space" };

export default async function NewSpacePage() {
  const { space } = await requireSpace();
  return (
    <div className="max-w-lg">
      <PageHeader back={{ href: "/app" }} title="New shared space" description="A separate set of accounts, budgets and history that you can share with other people." />
      <SpaceForm defaultCurrency={space.currency} />
    </div>
  );
}
