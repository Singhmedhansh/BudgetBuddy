import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { markReviewedAction } from "@/app/app/finn-review-actions";
import { PageHeader } from "@/components/app/ui";
import { BRAND } from "@/config/brand";
import { referenceReviewStatus } from "@/config/reference-data";
import { createAdminClient } from "@/server/admin";
import { isReviewer } from "@/server/ai/reviewers";
import { requireSpace } from "@/server/context";

export const metadata: Metadata = { title: "Finn review queue" };

interface Row {
  id: number;
  conversation_id: string;
  content: string;
  source: string | null;
  created_at: string;
}

/**
 * Answers people marked thumbs-down, with the question that led to each, so the prompt and the checks can be improved.
 * Open only to the addresses in FINN_REVIEWERS. A conversation appears here only because the person marked one of its
 * answers down; the thumbs control says so, and nothing else from anyone's chats is shown.
 */
export default async function FinnReviewPage() {
  const ctx = await requireSpace();
  if (!isReviewer(ctx.user.email)) notFound();
  const admin = createAdminClient();
  const ref = referenceReviewStatus();

  let rows: (Row & { question: string | null })[] = [];
  let problem: string | null = null;
  if (!admin)
    problem =
      "The review queue needs SUPABASE_SERVICE_ROLE_KEY to be set on the server.";
  else {
    const { data, error } = await admin
      .from("finn_messages")
      .select("id,conversation_id,content,source,created_at")
      .eq("feedback", "down")
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error)
      problem =
        "The review queue needs the latest database update (migration 16).";
    else {
      const answers = (data ?? []) as Row[];
      const convoIds = [...new Set(answers.map((a) => a.conversation_id))];
      const { data: asked } = convoIds.length
        ? await admin
            .from("finn_messages")
            .select("id,conversation_id,content")
            .in("conversation_id", convoIds)
            .eq("role", "user")
            .order("id", { ascending: false })
            .limit(500)
        : { data: [] };
      const users = (asked ?? []) as {
        id: number;
        conversation_id: string;
        content: string;
      }[];
      rows = answers.map((a) => ({
        ...a,
        question:
          users.find(
            (u) => u.conversation_id === a.conversation_id && u.id < a.id,
          )?.content ?? null,
      }));
    }
  }

  return (
    <>
      <PageHeader
        title={`${BRAND.assistantName} review queue`}
        description="Answers marked thumbs-down, newest first. Look for a pattern, fix the prompt or the checks, then mark them reviewed."
        back={{ href: "/app/assistant", label: "Back to Finn" }}
      />
      {ref.due ? (
        <section
          aria-label="Reference figures to re-check"
          className="mb-6 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm"
        >
          <h2 className="font-semibold">Reference figures are due a check</h2>
          <p className="mt-1 text-muted">
            Last checked {ref.reviewedOn} ({ref.ageDays} days ago). Re-check
            each against its source, update src/config/reference-data.ts and
            move the review date forward.
          </p>
          <ul className="mt-2 space-y-1">
            {ref.items.map((i) => (
              <li key={i.label}>
                <span className="font-medium">{i.label}</span>: {i.value}{" "}
                <span className="text-muted">({i.source})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {problem ? (
        <p
          role="status"
          className="rounded-xl border border-line bg-sunken px-4 py-3 text-sm"
        >
          {problem}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          Nothing waiting. Answers marked thumbs-down will appear here.
        </p>
      ) : (
        <ol className="space-y-4">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-line bg-surface p-4 shadow-sm"
            >
              <p className="text-xs text-muted">
                {new Date(r.created_at).toLocaleString("en-IN", {
                  timeZone: ctx.profile.timezone,
                })}{" "}
                · {r.source ?? "unknown source"}
              </p>
              <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Question
              </h2>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">
                {r.question ?? "(not found)"}
              </p>
              <h2 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Answer
              </h2>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{r.content}</p>
              <form action={markReviewedAction} className="mt-3">
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  className="rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-medium hover:border-primary"
                >
                  Mark reviewed
                </button>
              </form>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
