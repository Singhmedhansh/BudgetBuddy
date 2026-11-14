"use client";

import { DateField } from "@/components/ui/DateField";
import Link from "next/link";
import { useActionState, useState } from "react";
import { refundTransactionAction, updateTransactionDetailsAction, type TxnActionState } from "@/app/app/transaction-actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { SelectField } from "./controls";

type Act = (prev: TxnActionState | undefined, form: FormData) => Promise<TxnActionState>;
const useAct = (a: Act) => useActionState<TxnActionState | undefined, FormData>(a, undefined);

export function RefundForm({ id, remainingText, remainingPlain, today, accounts, defaultAccountId }: { id: string; remainingText: string; remainingPlain: string; today: string; accounts: { id: string; name: string }[]; defaultAccountId: string | null }) {
  const [s, action] = useAct(refundTransactionAction);
  const [clientKey] = useState(() => crypto.randomUUID());
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="clientKey" value={clientKey} suppressHydrationWarning readOnly />
      <FormMessage error={s?.error} />
      <Field label="Refund amount" name="amount" defaultValue={s?.values?.amount ?? remainingPlain} error={fe.amount} autoComplete="off" hint={`Up to ${remainingText}, the part of this expense not yet refunded.`} />
      <SelectField label="Money comes back to" name="accountId" defaultValue={s?.values?.accountId ?? defaultAccountId ?? ""} placeholder="Choose an account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fe.accountId} />
      <div>
        <label htmlFor="refund-date" className="mb-1.5 block text-sm font-medium">
          Date
        </label>
        <DateField id="refund-date" name="date" label="Date" defaultValue={s?.values?.date ?? today} max={today} invalid={Boolean(fe.date)} />
        {fe.date ? <p className="mt-1.5 text-sm text-neg-text">{fe.date}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Saving">Record refund</SubmitButton>
        </div>
        <Link href="/app/transactions" className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function EditDetailsForm({ id, merchant, description, notes }: { id: string; merchant: string; description: string; notes: string }) {
  const [s, action] = useAct(updateTransactionDetailsAction);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <FormMessage error={s?.error} />
      <Field label="Merchant or payer" name="merchant" defaultValue={s?.values?.merchant ?? merchant} error={fe.merchant} />
      <Field label="Description" name="description" defaultValue={s?.values?.description ?? description} error={fe.description} />
      <div>
        <label htmlFor="notes" className="mb-1.5 block text-sm font-medium">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={s?.values?.notes ?? notes} aria-invalid={fe.notes ? true : undefined} className="w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm aria-[invalid=true]:border-neg" />
        {fe.notes ? <p className="mt-1.5 text-sm text-neg-text">{fe.notes}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Saving">Save details</SubmitButton>
        </div>
        <Link href="/app/transactions" className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}
