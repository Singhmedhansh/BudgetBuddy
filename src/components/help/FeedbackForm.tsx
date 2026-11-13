"use client";

import { useActionState, useState } from "react";
import { submitHelpFeedback, type FeedbackState } from "@/app/help/actions";

export function FeedbackForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<FeedbackState | undefined, FormData>(submitHelpFeedback, undefined);
  const [no, setNo] = useState(false);

  if (state?.done) {
    return (
      <p role="status" className="text-sm text-muted">
        Thanks. Your feedback helps us improve this article.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="mb-2 text-sm font-medium">Did this answer your question?</legend>
        <button type="submit" name="helpful" value="yes" disabled={pending} className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary disabled:opacity-60">
          Yes
        </button>
        {no ? (
          <button type="submit" name="helpful" value="no" disabled={pending} className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary disabled:opacity-60">
            Send feedback
          </button>
        ) : (
          <button type="button" onClick={() => setNo(true)} className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary">
            No
          </button>
        )}
      </fieldset>
      {no ? (
        <div>
          <label htmlFor="fb-comment" className="mb-1.5 block text-sm">
            What was missing? (optional)
          </label>
          <textarea id="fb-comment" name="comment" rows={3} maxLength={1000} className="w-full max-w-md rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-neg-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
