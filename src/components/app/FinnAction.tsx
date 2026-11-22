"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmFinnAction } from "@/app/app/assistant-actions";
import type { FinnAction } from "@/server/ai/visuals";

/** What Finn proposes to do, with Confirm and Cancel. Nothing is saved until Confirm is tapped. */
export function ActionCard({ action }: { action: FinnAction }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "done"; message: string }
    | { kind: "error"; message: string }
    | { kind: "cancelled" }
  >({ kind: "idle" });

  const rows: [string, string][] =
    action.kind === "add_transaction"
      ? [
          ["What", action.type === "expense" ? "Expense" : "Income"],
          ["Amount", action.amountDisplay],
          ["Category", action.categoryName],
          ["Account", action.accountName],
          [
            "Date",
            new Date(`${action.date}T00:00:00`).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
          ],
          ...(action.merchant
            ? ([["Payee", action.merchant]] as [string, string][])
            : []),
        ]
      : [
          ["What", "Budget limit"],
          ["Budget", action.budgetName],
          ["Category", action.categoryName],
          ["New limit", action.amountDisplay],
          ...(action.previousDisplay
            ? ([["Was", action.previousDisplay]] as [string, string][])
            : []),
        ];

  return (
    <div className="finn-rise rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">
        {action.kind === "add_transaction"
          ? "Add this transaction?"
          : "Change this budget?"}
      </p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="num font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {state.kind === "idle" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await confirmFinnAction(action);
                setState(
                  r.ok
                    ? { kind: "done", message: r.message }
                    : { kind: "error", message: r.message },
                );
              })
            }
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            {pending ? "Saving…" : "Confirm"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setState({ kind: "cancelled" })}
            className="rounded-full border border-line-strong px-5 py-2 text-sm font-medium hover:border-primary disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : state.kind === "done" ? (
        <p
          role="status"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-pos-text"
        >
          <Check size={15} aria-hidden />
          {state.message}
        </p>
      ) : state.kind === "error" ? (
        <p
          role="alert"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-neg-text"
        >
          <CircleAlert size={15} aria-hidden />
          {state.message}
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted">Cancelled. Nothing was saved.</p>
      )}
    </div>
  );
}
