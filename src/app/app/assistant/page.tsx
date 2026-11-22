import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { PageHeader } from "@/components/app/ui";
import { AssistantChat } from "@/components/app/AssistantChat";
import { MESSAGES } from "@/server/ai/assistant";
import { aiStatus } from "@/server/ai/config";
import { requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  await requireSpace();
  const status = aiStatus();
  return (
    <>
      <PageHeader title={`Ask ${BRAND.assistantName}`} description={`${BRAND.assistantName} answers questions about your own recorded money and works out savings goals. Every figure is checked against your records.`} />
      <div className="mx-auto max-w-3xl">
        <AssistantChat available={status.available} unavailableMessage={MESSAGES.disabled} />
      </div>
    </>
  );
}
