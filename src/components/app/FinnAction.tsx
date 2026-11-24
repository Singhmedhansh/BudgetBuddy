"use client";

import { Check, CircleAlert, Loader2, Pencil, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  confirmFinnAction,
  finnEditOptionsAction,
  undoFinnAction,
} from "@/app/app/assistant-actions";
import type { FinnAction } from "@/server/ai/visuals";

type Options = Awaited<ReturnType<typeof finnEditOptionsAction>>;
type State =
  | { kind: "idle" }
  | { kind: "editing" }
  | { kind: "done"; message: string; transactionId?: string }
  | { kind: "undone"; message: string }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * What Finn proposes to do. Nothing is saved until Confirm is tapped, unless the person chose to have quick records saved
 * at once; then it is saved straight away and Undo is offered. Before saving, the amount, category, account and date can
 * be changed; the server checks every field again either way.
 */
export function ActionCard({ action: initial }: { action: FinnAction }) {
  const [action, setAction] = useState<FinnAction>(initial);
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [options, setOptions] = useState<Options | null>(null);
  const autoStarted = useRef(false);

  const save = (a: FinnAction) =>
    start(async () => {
      const r = await confirmFinnAction(a);
      setState(
        r.ok
          ? { kind: "done", message: r.message, transactionId: r.transactionId }
          : { kind: "error", message: r.message },
      );
    });

  // Opted in to saving quick records at once: save on arrival, once.
  useEffect(() => {
    if (
      initial.kind === "add_transaction" &&
      initial.auto &&
      !autoStarted.current
    ) {
      autoStarted.current = true;
      save(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: [string, string][] =
    action.kind === "add_transaction"
      ? [
          ["What", action.type === "expense" ? "Expense" : "Income"],
          ["Amount", action.amountDisplay],
          ["Category", action.categoryName],
          ["Account", action.accountName],
          ["Date", dateLabel(action.date)],
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

  const startEditing = () => {
    if (action.kind !== "add_transaction") return;
    setState({ kind: "editing" });
    if (!options)
      start(async () => setOptions(await finnEditOptionsAction(action.type)));
  };

  const applyEdits = (form: FormData) => {
    if (action.kind !== "add_transaction" || !options) return;
    const amount = Number(String(form.get("amount") ?? "").replace(/,/g, ""));
    const date = String(form.get("date") ?? action.date);
    const acct = options.accounts.find((a) => a.id === form.get("account"));
    const cat = options.categories.find((c) => c.id === form.get("category"));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setAction({
      ...action,
      amount: Math.round(amount * 100) / 100,
      amountDisplay: new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: options.currency,
        maximumFractionDigits: 2,
      }).format(amount),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : action.date,
      accountId: acct?.id ?? action.accountId,
      accountName: acct?.name ?? action.accountName,
      categoryId: cat?.id ?? action.categoryId,
      categoryName: cat?.name ?? action.categoryName,
    });
    setState({ kind: "idle" });
  };

  const field =
    "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm focus-visible:border-primary";

  return (
    <div className="finn-rise rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold">
        {action.kind === "add_transaction"
          ? state.kind === "done" || (action.auto && state.kind === "idle")
            ? "Recorded"
            : "Add this transaction?"
          : "Change this budget?"}
      </p>

      {state.kind === "editing" && action.kind === "add_transaction" ? (
        options ? (
          <form
            action={applyEdits}
            className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm"
          >
            <label htmlFor="finn-amount" className="text-muted">
              Amount
            </label>
            <input
              id="finn-amount"
              name="amount"
              inputMode="decimal"
              defaultValue={String(action.amount)}
              className={`num ${field}`}
              required
            />
            <label htmlFor="finn-category" className="text-muted">
              Category
            </label>
            <select
              id="finn-category"
              name="category"
              defaultValue={action.categoryId}
              className={field}
            >
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label htmlFor="finn-account" className="text-muted">
              Account
            </label>
            <select
              id="finn-account"
              name="account"
              defaultValue={action.accountId}
              className={field}
            >
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <label htmlFor="finn-date" className="text-muted">
              Date
            </label>
            <input
              id="finn-date"
              name="date"
              type="date"
              max={todayIso()}
              defaultValue={action.date}
              className={field}
            />
            <div className="col-span-2 mt-2 flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => setState({ kind: "idle" })}
                className="rounded-full border border-line-strong px-5 py-2 text-sm font-medium hover:border-primary"
              >
                Back
              </button>
            </div>
          </form>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Loading your accounts and categories…
          </p>
        )
      ) : (
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="num font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {state.kind === "idle" &&
      !(action.kind === "add_transaction" && action.auto) ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(action)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            {pending ? "Saving…" : "Confirm"}
          </button>
          {action.kind === "add_transaction" ? (
            <button
              type="button"
              disabled={pending}
              onClick={startEditing}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:border-primary disabled:opacity-60"
            >
              <Pencil size={13} aria-hidden /> Edit
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => setState({ kind: "cancelled" })}
            className="rounded-full border border-line-strong px-5 py-2 text-sm font-medium hover:border-primary disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : state.kind === "idle" ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Saving…
        </p>
      ) : state.kind === "done" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p
            role="status"
            className="inline-flex items-center gap-2 text-sm font-medium text-pos-text"
          >
            <Check size={15} aria-hidden />
            {state.message}
          </p>
          {state.transactionId ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await undoFinnAction(state.transactionId!);
                  setState(
                    r.ok
                      ? { kind: "undone", message: r.message }
                      : { kind: "error", message: r.message },
                  );
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-medium hover:border-primary disabled:opacity-60"
            >
              {pending ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Undo2 size={12} aria-hidden />
              )}
              Undo
            </button>
          ) : null}
        </div>
      ) : state.kind === "undone" ? (
        <p role="status" className="mt-4 text-sm text-muted">
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
      ) : state.kind === "cancelled" ? (
        <p className="mt-4 text-sm text-muted">Cancelled. Nothing was saved.</p>
      ) : null}
    </div>
  );
}
