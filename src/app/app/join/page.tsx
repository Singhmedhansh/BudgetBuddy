import type { Metadata } from "next";
import { acceptInviteAction } from "@/app/app/space-actions";
import { SubmitButton } from "@/components/auth/fields";
import { Notice, PageHeader } from "@/components/app/ui";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Join a space" };

/** Joining needs the person to confirm: following a link never adds anyone to a space by itself. */
export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await getContext();
  const code = (sp.code ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  return (
    <div className="max-w-lg">
      <PageHeader back={{ href: "/app" }} title="Join a space" description="Someone shared a space with you. Confirm to join it with the role they chose. You can leave at any time." />
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "Enter the invitation code you were sent." : sp.error}</Notice> : null}
      <form action={acceptInviteAction} className="space-y-5">
        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
            Invitation code
          </label>
          <input id="code" name="code" defaultValue={code} autoComplete="off" spellCheck={false} className="w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 font-mono text-sm" />
        </div>
        <SubmitButton pendingLabel="Joining">Join space</SubmitButton>
      </form>
    </div>
  );
}
