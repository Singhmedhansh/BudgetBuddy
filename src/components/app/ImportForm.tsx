"use client";

import { useActionState } from "react";
import { uploadStatementAction, type ImportState } from "@/app/app/import/actions";
import { SelectField } from "@/components/app/controls";
import { FormMessage, SubmitButton } from "@/components/auth/fields";

export function ImportForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [s, action] = useActionState<ImportState | undefined, FormData>(uploadStatementAction, undefined);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
      <FormMessage error={s?.error} />
      <SelectField label="Which account is this statement for?" name="accountId" placeholder="Choose an account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fe.accountId} />
      <div>
        <label htmlFor="stmt-file" className="mb-1.5 block text-sm font-medium">
          Statement file (.csv or .pdf)
        </label>
        <input id="stmt-file" name="file" type="file" accept=".csv,text/csv,.pdf,application/pdf" aria-describedby="stmt-help" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm" />
        <p id="stmt-help" className={`mt-1.5 text-sm ${fe.file ? "text-neg-text" : "text-xs text-muted"}`}>
          {fe.file ?? "Up to 4 MB. A CSV needs a header row with Date, Description and Amount (or separate Debit and Credit). A PDF must be a text statement from your bank, not a scan."}
        </p>
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="useAi" defaultChecked aria-describedby="ai-help" className="mt-1" />
          <span>Use AI to read PDFs and suggest categories</span>
        </label>
        <p id="ai-help" className={`mt-1.5 text-sm ${fe.useAi ? "text-neg-text" : "text-xs text-muted"}`}>
          {fe.useAi ?? "Needed for PDF statements. The text of a PDF, or only the descriptions of a CSV (never the amounts), is sent to an AI provider. Untick it to keep a CSV fully on our servers. Every row is checked against your file and you review everything before it is saved."}
        </p>
      </div>
      <SelectField label="Dates in the file are written as" name="dateOrder" defaultValue="dmy" options={[{ value: "dmy", label: "Day first (31/12/2026)" }, { value: "mdy", label: "Month first (12/31/2026)" }]} />
      <SelectField label="In a single Amount column, a positive number means" name="positiveIs" defaultValue="in" options={[{ value: "in", label: "Money in (a deposit)" }, { value: "out", label: "Money out (a charge, as many card statements show)" }]} />
      <SubmitButton pendingLabel="Reading file">Review the import</SubmitButton>
      <p className="text-xs text-muted">Nothing is saved to your records until you review and confirm on the next screen.</p>
    </form>
  );
}
