"use client";

import { useActionState, useTransition } from "react";
import { loadSampleDataAction, removeSampleDataAction, type SampleState } from "@/app/app/sample-actions";

export function LoadSampleButton({ label = "Explore with sample data" }: { label?: string }) {
  const [pending, start] = useTransition();
  const [state, run] = useActionState<SampleState | undefined, void>(async () => loadSampleDataAction(), undefined);
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending} onClick={() => start(() => run())} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60">
        {pending ? "Creating sample data. This takes a few seconds" : label}
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-neg-text">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

export function RemoveSampleForm({ spaceId }: { spaceId: string }) {
  const [state, action] = useActionState<SampleState | undefined, FormData>(removeSampleDataAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="spaceId" value={spaceId} />
      <button type="submit" className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-neg">
        Remove sample data
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-neg-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
