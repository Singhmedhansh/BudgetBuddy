import type { Metadata } from "next";
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
      <PageHeader title="Assistant" description="Ask questions about your own recorded money. It never invents figures." />
      <div className="mx-auto max-w-3xl">
        <AssistantChat available={status.available} unavailableMessage={MESSAGES.disabled} />
      </div>
    </>
  );
}
