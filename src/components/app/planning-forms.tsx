"use client";

import { DateField } from "@/components/ui/DateField";
import Link from "next/link";
import { useActionState } from "react";
import { createGoalAction, createRecurringAction, updateGoalAction, type PlanState } from "@/app/app/planning-actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { SelectField } from "./controls";

type Act = (prev: PlanState | undefined, form: FormData) => Promise<PlanState>;
const useAct = (a: Act) => useActionState<PlanState | undefined, FormData>(a, undefined);

export function GoalForm({ currency, minDate, initial }: { currency: string; minDate: string; initial?: { id: string; name: string; target: string; deadline: string; priority: string } }) {
  const [s, action] = useAct(initial ? updateGoalAction : createGoalAction);
  const fe = s?.fieldErrors ?? {};
  const v = s?.values ?? initial ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormMessage error={s?.error} />
      <Field label="Goal name" name="name" defaultValue={v.name} error={fe.name} hint="For example, Emergency fund or Trip to Goa." />
      <Field label={`Target amount (${currency})`} name="target" defaultValue={v.target} error={fe.target} autoComplete="off" />
      <div>
        <label htmlFor="goal-deadline" className="mb-1.5 block text-sm font-medium">Deadline (optional)</label>
        <DateField id="goal-deadline" name="deadline" label="Target date" min={minDate} defaultValue={v.deadline} invalid={Boolean(fe.deadline)} clearable />
        {fe.deadline ? <p className="mt-1.5 text-sm text-neg-text">{fe.deadline}</p> : <p className="mt-1.5 text-xs text-muted">With a deadline, we show how much to set aside each month.</p>}
      </div>
      <SelectField label="Priority" name="priority" defaultValue={v.priority ?? "2"} options={[{ value: "1", label: "High" }, { value: "2", label: "Medium" }, { value: "3", label: "Low" }]} />
      <p className="text-xs text-muted">Amounts you add to a goal are tracked here. They do not move money or change any account balance.</p>
      <div className="flex items-center gap-3">
        <div className="flex-1"><SubmitButton pendingLabel="Saving">{initial ? "Save changes" : "Create goal"}</SubmitButton></div>
        <Link href="/app/goals" className="text-sm text-muted hover:text-fg">Cancel</Link>
      </div>
    </form>
  );
}

const WORDS = {
  bill: { noun: "bill", payee: "Bill name", account: "Pay from", category: "Category", hint: "For example, Rent or Electricity.", back: "/app/bills" },
  subscription: { noun: "subscription", payee: "Subscription name", account: "Pay from", category: "Category", hint: "For example, Netflix or cloud storage.", back: "/app/subscriptions" },
  income: { noun: "income", payee: "Income name", account: "Received into", category: "Income source", hint: "For example, Salary or Freelance retainer.", back: "/app/income" },
} as const;

export function RecurringForm({
  kind,
  currency,
  accounts,
  categories,
  today,
}: {
  kind: "bill" | "subscription" | "income";
  currency: string;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  today: string;
}) {
  const [s, action] = useAct(createRecurringAction);
  const fe = s?.fieldErrors ?? {};
  const v = s?.values ?? {};
  const w = WORDS[kind];
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <FormMessage error={s?.error} />
      <Field label={w.payee} name="name" defaultValue={v.name} error={fe.name} hint={w.hint} />
      <Field label={`Amount (${currency})`} name="amount" defaultValue={v.amount} error={fe.amount} autoComplete="off" />
      <SelectField label="How often" name="frequency" defaultValue={v.frequency ?? "monthly"} error={fe.frequency} options={[{ value: "monthly", label: "Every month" }, { value: "weekly", label: "Every week" }, { value: "quarterly", label: "Every 3 months" }, { value: "yearly", label: "Every year" }, { value: "once", label: "Once" }]} />
      <div>
        <label htmlFor="rec-first" className="mb-1.5 block text-sm font-medium">{kind === "income" ? "First expected date" : "First due date"}</label>
        <DateField id="rec-first" name="firstDue" label="First due date" defaultValue={v.firstDue ?? today} invalid={Boolean(fe.firstDue)} />
        {fe.firstDue ? <p className="mt-1.5 text-sm text-neg-text">{fe.firstDue}</p> : <p className="mt-1.5 text-xs text-muted">Later dates repeat from this one. A monthly item on the 31st falls on the last day of shorter months.</p>}
      </div>
      <div>
        <label htmlFor="rec-end" className="mb-1.5 block text-sm font-medium">Last date (optional)</label>
        <DateField id="rec-end" name="endsOn" label="Ends on" defaultValue={v.endsOn} invalid={Boolean(fe.endsOn)} clearable />
        {fe.endsOn ? <p className="mt-1.5 text-sm text-neg-text">{fe.endsOn}</p> : null}
      </div>
      <SelectField label={w.account} name="accountId" defaultValue={v.accountId} placeholder="Choose an account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fe.accountId} />
      <SelectField label={w.category} name="categoryId" defaultValue={v.categoryId} placeholder="Choose one" options={categories.map((c) => ({ value: c.id, label: c.name }))} error={fe.categoryId} />
      {kind !== "income" ? <Field label="Remind me (days before)" name="remindDays" defaultValue={v.remindDays ?? "3"} error={fe.remindDays} /> : <input type="hidden" name="remindDays" value="3" />}
      {kind === "subscription" ? (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="autoRenews" defaultChecked={v.autoRenews ? v.autoRenews === "on" : true} className="mt-1 accent-[var(--primary)]" />
          <span>Renews automatically<span className="block text-xs text-muted">Only a note for you. FinTrack cannot cancel a subscription with the provider.</span></span>
        </label>
      ) : null}
      <Field label={kind === "subscription" ? "Cancellation notes (optional)" : "Notes (optional)"} name="notes" defaultValue={v.notes} error={fe.notes} />
      {kind === "income" ? <p className="text-xs text-muted">Expected income is a plan. It does not change any balance until you mark it received.</p> : null}
      <div className="flex items-center gap-3">
        <div className="flex-1"><SubmitButton pendingLabel="Saving">Add {w.noun}</SubmitButton></div>
        <Link href={w.back} className="text-sm text-muted hover:text-fg">Cancel</Link>
      </div>
    </form>
  );
}
