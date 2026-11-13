"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createAccountAction,
  createBudgetAction,
  createFirstAccountAction,
  createTransactionAction,
  saveProfileStep,
  type ActionState,
} from "@/app/app/actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { CURRENCIES, COMMON_TIMEZONES } from "@/config/categories";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/server/types";
import { ChoiceGroup, SelectField } from "./controls";

type Act = (prev: ActionState | undefined, form: FormData) => Promise<ActionState>;
const useAct = (a: Act) => useActionState<ActionState | undefined, FormData>(a, undefined);

export function ProfileStepForm({ defaults }: { defaults: { currency: string; timezone: string } }) {
  const [s, action] = useAct(saveProfileStep);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage error={s?.error} />
      <ChoiceGroup
        legend="Which describes you best?"
        name="persona"
        defaultValue={s?.values?.persona}
        error={fe.persona}
        options={[
          { value: "student", label: "Student", description: "An allowance or stipend, food, transport and college costs." },
          { value: "professional", label: "Working professional", description: "Salary, rent, EMIs, cards and subscriptions." },
          { value: "household", label: "Couple or family", description: "Shared bills and goals for a household." },
          { value: "other", label: "Something else", description: "Start with general categories." },
        ]}
      />
      <p className="-mt-3 text-xs text-muted">This only picks your starting categories. You can change them any time and nothing is locked.</p>
      <SelectField label="Currency" name="currency" defaultValue={s?.values?.currency ?? defaults.currency} options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} error={fe.currency} />
      <SelectField label="Timezone" name="timezone" defaultValue={s?.values?.timezone ?? defaults.timezone} options={COMMON_TIMEZONES.map((z) => ({ value: z, label: z.replace("_", " ") }))} error={fe.timezone} />
      <SubmitButton pendingLabel="Saving">Continue</SubmitButton>
    </form>
  );
}

const ASSET_TYPES: AccountType[] = ["savings", "current", "cash", "wallet", "investment", "other_asset"];
const LIABILITY_TYPES_UI: AccountType[] = ["credit_card", "other_liability"];

export function AccountForm({ mode, currency, cancelHref }: { mode: "onboarding" | "page"; currency: string; cancelHref?: string }) {
  const [s, action] = useAct(mode === "onboarding" ? createFirstAccountAction : createAccountAction);
  const [type, setType] = useState<string>("");
  const fe = s?.fieldErrors ?? {};
  const owed = LIABILITY_TYPES_UI.includes(type as AccountType);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={s?.error} />
      <Field label="Account name" name="name" defaultValue={s?.values?.name} error={fe.name} hint="For example, HDFC Savings or Wallet cash." />
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="acct-type">
          Account type
        </label>
        <select
          id="acct-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-invalid={fe.type ? true : undefined}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm aria-[invalid=true]:border-neg"
        >
          <option value="" disabled>
            Choose a type
          </option>
          <optgroup label="Money you hold">
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Money you owe">
            {LIABILITY_TYPES_UI.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </optgroup>
        </select>
        {fe.type ? <p className="mt-1.5 text-sm text-neg-text">{fe.type}</p> : null}
      </div>
      <Field
        label={owed ? `Amount you owe now (${currency})` : `Current balance (${currency})`}
        name="opening"
        defaultValue={s?.values?.opening}
        error={fe.opening}
        hint="You enter this yourself. Budget Buddy does not read your bank, so it will not update on its own."
      />
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Saving">Add account</SubmitButton>
        </div>
        {cancelHref ? (
          <Link href={cancelHref} className="text-sm text-muted hover:text-fg">
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export function TransactionForm({
  accounts,
  expenseCategories,
  incomeCategories,
  today,
}: {
  accounts: { id: string; name: string }[];
  expenseCategories: { id: string; name: string }[];
  incomeCategories: { id: string; name: string }[];
  today: string;
}) {
  const [s, action] = useAct(createTransactionAction);
  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");
  const fe = s?.fieldErrors ?? {};
  const cats = type === "income" ? incomeCategories : expenseCategories;
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={s?.error} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
          {(["expense", "income", "transfer"] as const).map((t) => (
            <label key={t} className={`cursor-pointer rounded-[5px] px-4 py-1.5 text-sm capitalize has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] ${type === t ? "bg-sage font-semibold" : "text-muted"}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
              {t}
            </label>
          ))}
        </div>
        {fe.type ? <p className="mt-1.5 text-sm text-neg-text">{fe.type}</p> : null}
      </fieldset>
      <Field label="Amount" name="amount" defaultValue={s?.values?.amount} error={fe.amount} autoComplete="off" />
      <SelectField label={type === "transfer" ? "From account" : "Account"} name="accountId" defaultValue={s?.values?.accountId} placeholder="Choose an account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fe.accountId} />
      {type === "transfer" ? (
        <SelectField label="To account" name="toAccountId" defaultValue={s?.values?.toAccountId} placeholder="Choose an account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fe.toAccountId} />
      ) : (
        <SelectField key={type} label={type === "income" ? "Income source" : "Category"} name="categoryId" defaultValue={s?.values?.categoryId} placeholder="Choose one" options={cats.map((c) => ({ value: c.id, label: c.name }))} error={fe.categoryId} />
      )}
      {type !== "transfer" ? <Field label="Merchant or payer (optional)" name="merchant" defaultValue={s?.values?.merchant} error={fe.merchant} /> : null}
      <div>
        <label htmlFor="txn-date" className="mb-1.5 block text-sm font-medium">
          Date
        </label>
        <input id="txn-date" name="date" type="date" defaultValue={s?.values?.date ?? today} max={today} aria-invalid={fe.date ? true : undefined} className="w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm aria-[invalid=true]:border-neg" />
        {fe.date ? <p className="mt-1.5 text-sm text-neg-text">{fe.date}</p> : null}
      </div>
      <Field label="Note (optional)" name="description" defaultValue={s?.values?.description} error={fe.description} />
      {type === "transfer" ? <p className="text-xs text-muted">A transfer between your own accounts is not income or spending.</p> : null}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Saving">Save transaction</SubmitButton>
        </div>
        <Link href="/app/transactions" className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function BudgetForm({ categories, currency }: { categories: { id: string; name: string }[]; currency: string }) {
  const [s, action] = useAct(createBudgetAction);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage error={s?.error} />
      <Field label="Budget name" name="name" error={fe.name} defaultValue={s?.values?.name ?? "Monthly budget"} />
      <fieldset>
        <legend className="text-sm font-medium">Monthly limit per category ({currency})</legend>
        <p className="mb-3 mt-1 text-xs text-muted">Leave a category blank to not budget it.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((c) => (
            <Field key={c.id} label={c.name} name={`alloc_${c.id}`} defaultValue={s?.values?.[`alloc_${c.id}`]} error={fe[`alloc_${c.id}`]} autoComplete="off" />
          ))}
        </div>
      </fieldset>
      <Field label="Warn me when spending reaches (% of a limit)" name="warnAt" defaultValue={s?.values?.warnAt ?? "80"} error={fe.warnAt} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="rollover" defaultChecked={s?.values?.rollover === "on"} className="mt-1 accent-[var(--primary)]" />
        <span>
          Carry unspent amounts into next month
          <span className="block text-xs text-muted">Only what you did not spend carries over. Overspending does not reduce next month.</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SubmitButton pendingLabel="Saving">Create budget</SubmitButton>
        </div>
        <Link href="/app/budgets" className="text-sm text-muted hover:text-fg">
          Cancel
        </Link>
      </div>
    </form>
  );
}
