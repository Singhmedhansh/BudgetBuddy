"use client";

import { Sparkles } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { askAssistantAction, type AssistantState } from "@/app/app/assistant-actions";

const EXAMPLES = ["How much did I spend this month?", "Which budget is closest to its limit?", "What is my net worth right now?", "What were my biggest spending categories?"];

function Send() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60">
      {pending ? "Thinking" : "Ask"}
    </button>
  );
}

export function AssistantChat({ available, unavailableMessage }: { available: boolean; unavailableMessage: string }) {
  const [state, action] = useActionState<AssistantState | undefined, FormData>(askAssistantAction, undefined);
  const turns = state?.turns ?? [];
  return (
    <div className="space-y-6">
      {!available ? (
        <p role="status" className="rounded-xl border border-line bg-sunken px-4 py-3 text-sm leading-relaxed">
          {unavailableMessage}
        </p>
      ) : null}

      <ol className="space-y-4" aria-live="polite" aria-label="Conversation">
        {turns.map((t, i) => (
          <li key={i} className={t.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-fg" : "max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed"}>
            {t.content}
            {t.role === "assistant" ? (
              <span className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Sparkles size={12} aria-hidden />
                {t.source === "figures" ? "Verified figures from your records" : "Every figure checked against your records"}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {state?.error ? (
        <p role="alert" className="text-sm text-neg-text">
          {state.error}
        </p>
      ) : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="history" value={JSON.stringify(turns)} />
        <label htmlFor="q" className="sr-only">
          Your question
        </label>
        <textarea
          id="q"
          name="question"
          rows={2}
          maxLength={600}
          defaultValue={state?.question ?? ""}
          key={turns.length}
          disabled={!available}
          placeholder="Ask about your own money"
          className="w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm placeholder:text-muted/70 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Answers use only figures from your recorded transactions. It cannot see individual transactions.</p>
          {available ? <Send /> : null}
        </div>
      </form>

      {turns.length === 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium">Things you could ask</p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <li key={e} className="rounded-full border border-line px-3 py-1.5 text-sm text-muted">
                {e}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
