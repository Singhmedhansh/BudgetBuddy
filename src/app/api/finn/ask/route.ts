import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Turn } from "@/app/app/assistant-actions";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { readAttachment } from "@/server/ai/attachment";
import { saveExchange } from "@/server/ai/chats";
import { databaseAnswerCache } from "@/server/ai/answer-cache";
import { loadFacts } from "@/server/ai/facts";
import { earlierText, isGeneralQuestion } from "@/server/ai/scope";
import { proposeAction } from "@/server/ai/finn-actions";
import { autoSaveLogsOn } from "@/server/ai/finn-settings";
import { planLimitsFor } from "@/server/ai/session";
import { usageStoreFor } from "@/server/ai/usage-store";
import { requireSpace } from "@/server/context";

/**
 * One question to Finn, answered as a stream of newline-separated JSON events:
 *   {t:"status", v}   what Finn is doing ("Reading your records")
 *   {t:"delta", v}    a sentence that has already passed the figure check
 *   {t:"done", ...}   the final, fully checked answer (replaces what was streamed), with charts and the saved ids
 *   {t:"error", message, limit?}
 * The same rules as the form action apply: sign-in, plan allowance, figure checks and saving.
 */
export const maxDuration = 60;

const history = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2000),
    }),
  )
  .max(40);

export async function POST(request: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireSpace>>;
  try {
    ctx = await requireSpace();
  } catch {
    return NextResponse.json({ error: "signin" }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const question = String(form.get("question") ?? "");
  const chatField = String(form.get("chat") ?? "");
  const chatId = /^[0-9a-f-]{36}$/i.test(chatField) ? chatField : null;
  let past: z.infer<typeof history> = [];
  try {
    const p = history.safeParse(
      JSON.parse(String(form.get("history") ?? "[]")),
    );
    if (p.success) past = p.data;
  } catch {
    /* a malformed history field is an empty conversation */
  }
  const file = form.get("file");
  const brief = form.get("brief") === "1";

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* the person closed the tab */
        }
      };
      // Say something at once: the person should see Finn react before any database work starts.
      send({ t: "status", v: "Thinking" });
      const t0 = performance.now();
      const marks: Record<string, number> = {};
      const mark = (k: string) => {
        marks[k] = Math.round(performance.now() - t0);
      };
      try {
        let doc: { name: string; text: string } | undefined;
        let saveAs = question.trim();
        if (file instanceof File && file.size > 0) {
          const a = await readAttachment(file);
          if (!a.ok) {
            send({ t: "error", message: a.message });
            return;
          }
          doc = { name: a.name, text: a.text };
          saveAs = `[Attached: ${a.name}] ${saveAs}`;
        }

        // A request to change something becomes a card to confirm: no model, no allowance used.
        if (!doc) {
          try {
            const proposal = await proposeAction(question, ctx);
            if (proposal) {
              // Saved at once, with an Undo, only when the person opted in. The stored copy keeps the confirm card.
              const auto = proposal.quick && (await autoSaveLogsOn(ctx));
              const reply: Turn = {
                role: "assistant",
                content: proposal.text,
                source: "figures",
                visuals: proposal.visuals,
              };
              const saved = await saveExchange(ctx.supabase, {
                userId: ctx.user.id,
                spaceId: ctx.space.id,
                chatId,
                question: saveAs,
                answer: reply,
              });
              send({
                t: "done",
                answer: reply.content,
                source: reply.source,
                visuals: auto
                  ? (reply.visuals ?? []).map((v) =>
                      v.type === "action" && v.action.kind === "add_transaction"
                        ? { ...v, action: { ...v.action, auto: true } }
                        : v,
                    )
                  : (reply.visuals ?? []),
                id: saved?.answerId ?? null,
                chatId: saved?.chatId ?? chatId,
                proposal: true,
              });
              return;
            }
          } catch {
            /* a proposal that cannot be built falls through to a normal question */
          }
        }

        const usage: UsageStore = usageStoreFor(ctx.supabase);
        // Start reading their records now: the plan lookup below and the records load run side by side.
        // A general question needs none of their records, so nothing is loaded for it.
        const general = !doc && isGeneralQuestion(question, earlierText(past));
        const factsNow = general ? null : loadFacts(ctx);
        factsNow?.catch(() => undefined);
        const { plan, limits } = await planLimitsFor(ctx);
        mark("plan");
        const out = await ask(
          question,
          {
            usage,
            plan: limits,
            loadFacts: () => factsNow ?? loadFacts(ctx),
            region: {
              country: ctx.profile.country ?? null,
              currency: ctx.space.currency,
            },
            answerCache: databaseAnswerCache(),
            brief,
            trace: mark,
            document: doc,
            stream: {
              status: (v) => send({ t: "status", v }),
              delta: (v) => send({ t: "delta", v }),
            },
          },
          past.map(({ role, content }) => ({ role, content })),
        );
        if (!out.ok) {
          send({
            t: "error",
            message: out.message ?? MESSAGES.unavailable,
            limit:
              out.reason === "plan_window"
                ? { kind: "window", plan, retryAt: out.retryAt ?? null }
                : out.reason === "plan_day"
                  ? { kind: "day", plan }
                  : out.reason === "plan_month"
                    ? { kind: "month", plan }
                    : undefined,
          });
          return;
        }
        const answer: Turn = {
          role: "assistant",
          content: out.answer,
          source: out.source,
          visuals: out.visuals,
        };
        const saved = await saveExchange(ctx.supabase, {
          userId: ctx.user.id,
          spaceId: ctx.space.id,
          chatId,
          question: saveAs,
          answer,
        });
        send({
          t: "done",
          answer: out.answer,
          source: out.source,
          visuals: out.visuals ?? [],
          id: saved?.answerId ?? null,
          chatId: saved?.chatId ?? chatId,
          // Stage timings in milliseconds from the start of the request. Names and numbers only.
          timing: { ...marks, total: Math.round(performance.now() - t0) },
        });
      } catch {
        send({ t: "error", message: MESSAGES.unavailable });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** A no-op that wakes this route's server instance, so the first real question does not pay for a cold start. */
export async function GET() {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
