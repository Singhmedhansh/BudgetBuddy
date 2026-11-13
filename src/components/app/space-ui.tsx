"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createInviteAction, createSpaceAction, type SpaceState } from "@/app/app/space-actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { CURRENCIES } from "@/config/categories";
import { SelectField } from "./controls";

export function SpaceForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [s, action] = useActionState<SpaceState | undefined, FormData>(createSpaceAction, undefined);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={s?.error} />
      <Field label="Space name" name="name" defaultValue={s?.values?.name} error={fe.name} hint="For example, Home budget or Flat 4B." />
      <SelectField
        label="What is it for?"
        name="kind"
        defaultValue={s?.values?.kind ?? "household"}
        error={fe.kind}
        options={[
          { value: "household", label: "A household" },
          { value: "couple", label: "A couple" },
          { value: "family", label: "A family" },
          { value: "roommates", label: "Roommates" },
          { value: "personal", label: "Just me, separately" },
        ]}
      />
      <SelectField label="Currency" name="currency" defaultValue={s?.values?.currency ?? defaultCurrency} error={fe.currency} options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} />
      <p className="text-xs text-muted">Each space has its own accounts, budgets and history. You will be its owner, and can invite others afterwards.</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Creating">Create space</SubmitButton>
        </div>
        <Link href="/app" className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function InviteForm({ canInviteAdmin, origin }: { canInviteAdmin: boolean; origin: string }) {
  const [s, action] = useActionState<(SpaceState & { code?: string }) | undefined, FormData>(createInviteAction, undefined);
  const [copied, setCopied] = useState(false);
  const link = s?.code ? `${origin}/app/join?code=${s.code}` : "";
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={s?.error} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <SelectField
            label="Invite as"
            name="role"
            defaultValue="viewer"
            error={s?.fieldErrors?.role}
            options={[
              { value: "viewer", label: "Viewer: can see everything, change nothing" },
              { value: "editor", label: "Editor: can add and correct transactions" },
              ...(canInviteAdmin ? [{ value: "admin", label: "Admin: can also manage members" }] : []),
            ]}
          />
        </div>
        <SubmitButton pendingLabel="Creating">Create invite link</SubmitButton>
      </div>
      {s?.code ? (
        <div role="status" className="rounded-xl border border-line-strong bg-sage/40 p-4 text-sm">
          <p className="font-medium">Share this link. It works once and expires in 7 days.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-2 text-xs" data-testid="invite-link">
              {link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-2 text-xs hover:border-primary"
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
