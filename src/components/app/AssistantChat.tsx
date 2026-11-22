"use client";

import {
  ArrowUp,
  CalendarClock,
  Check,
  Copy,
  Gauge,
  Landmark,
  PiggyBank,
  Plus,
  Repeat,
  Tags,
  Target,
  Wallet,
} from "lucide-react";
import {
  useActionState,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  askAssistantAction,
  type AssistantState,
  type Turn,
} from "@/app/app/assistant-actions";
import { AssistantMark } from "@/components/app/AssistantMark";
import { RichText } from "@/components/app/RichText";
import { BRAND } from "@/config/brand";
import {
  followUps,
  type Starter,
  type StarterKind,
} from "@/server/ai/suggestions";

const MAX = 600;
const ICONS: Record<StarterKind, typeof Wallet> = {
  spend: Wallet,
  budget: Gauge,
  worth: Landmark,
  category: Tags,
  save: PiggyBank,
  bills: CalendarClock,
  goals: Target,
  subs: Repeat,
  pace: Gauge,
};
export interface Snapshot {
  label: string;
  value: string;
}

function Avatar() {
  return <AssistantMark size={28} className="mt-0.5 shrink-0" />;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard can be blocked; the text stays selectable */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-sunken hover:text-fg"
    >
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Chat({
  available,
  unavailableMessage,
  onNew,
  name,
  starters,
  snapshot,
}: {
  available: boolean;
  unavailableMessage: string;
  onNew: () => void;
  name: string | null;
  starters: Starter[];
  snapshot: Snapshot[];
}) {
  const [state, dispatch] = useActionState<
    AssistantState | undefined,
    FormData
  >(askAssistantAction, undefined);
  const [, startTransition] = useTransition();
  const turns = state?.turns ?? [];
  // The person's message appears the moment they send it; it settles into the real list when the answer arrives.
  const [shown, addOptimistic] = useOptimistic(
    turns,
    (cur: Turn[], q: string) => [...cur, { role: "user" as const, content: q }],
  );
  const pending = shown.length > turns.length;

  const [text, setText] = useState("");
  // When an answer fails, hand the question back so nothing has to be retyped.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.error && state.question) setText(state.question);
  }

  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);
  useEffect(() => {
    if (available && window.matchMedia("(pointer: fine)").matches)
      box.current?.focus();
  }, [available]);
  useEffect(() => {
    if (shown.length > 0)
      end.current?.scrollIntoView({
        block: "end",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  }, [shown.length, state?.error]);

  function send(raw: string) {
    const q = raw.trim();
    if (!q || pending || !available) return;
    setText("");
    const fd = new FormData();
    fd.set("question", q);
    fd.set("history", JSON.stringify(turns));
    startTransition(() => {
      addOptimistic(q);
      dispatch(fd);
    });
  }

  const empty = shown.length === 0;
  const canSend = available && !pending && text.trim().length > 0;

  return (
    <div className="flex min-h-[calc(100dvh-17rem)] flex-col">
      {!available ? (
        <p
          role="status"
          className="mb-4 rounded-xl border border-line bg-sunken px-4 py-3 text-sm leading-relaxed"
        >
          {unavailableMessage}
        </p>
      ) : null}

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <AssistantMark size={56} />
          <h2 className="mt-4 font-display text-2xl leading-tight sm:text-3xl">
            {name
              ? `Hi ${name}, I'm ${BRAND.assistantName}.`
              : `Hi, I'm ${BRAND.assistantName}.`}
          </h2>
          <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted">
            Ask me anything about your money: what you spent, where it went,
            whether you can afford something, what is coming up. I work from
            your own records and check every number before I say it.
          </p>
          {snapshot.length > 0 ? (
            <dl className="mt-6 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-3">
              {snapshot.map((t) => (
                <div
                  key={t.label}
                  className="rounded-xl border border-line bg-surface px-4 py-3 text-left"
                >
                  <dt className="text-xs text-muted">{t.label}</dt>
                  <dd className="num mt-0.5 font-display text-lg">{t.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {available ? (
            <ul className="mt-6 grid w-full max-w-xl gap-2.5 sm:grid-cols-2">
              {starters.map(({ text: e, kind }) => {
                const Icon = ICONS[kind];
                return (
                  <li key={e}>
                    <button
                      type="button"
                      onClick={() => send(e)}
                      className="group flex h-full w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md"
                    >
                      <Icon
                        size={16}
                        aria-hidden
                        className="mt-0.5 shrink-0 text-primary"
                      />
                      <span>{e}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="flex-1">
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              <Plus size={12} aria-hidden />
              New chat
            </button>
          </div>
          <ol
            className="space-y-6"
            aria-live="polite"
            aria-label="Conversation"
          >
            {shown.map((t, i) =>
              t.role === "user" ? (
                <li
                  key={i}
                  className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-fg"
                >
                  {t.content}
                </li>
              ) : (
                <li key={i} className="flex gap-3">
                  <Avatar />
                  <div className="min-w-0 max-w-[92%] flex-1">
                    <RichText text={t.content} />
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Check size={12} aria-hidden className="text-pos" />
                        {t.source === "figures"
                          ? "Verified figures from your records"
                          : "Every figure checked against your records"}
                      </span>
                      <CopyButton text={t.content} />
                    </div>
                  </div>
                </li>
              ),
            )}
          </ol>
          {!pending &&
          available &&
          shown.length > 0 &&
          shown[shown.length - 1].role === "assistant" &&
          !state?.error ? (
            <ul
              aria-label="Suggested follow-up questions"
              className="mt-4 flex flex-wrap gap-2 pl-10"
            >
              {followUps(shown[shown.length - 2]?.content ?? "").map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => send(q)}
                    className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-primary hover:text-fg"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pending ? (
            <div
              role="status"
              aria-label={`${BRAND.assistantName} is thinking`}
              className="mt-6 flex gap-3"
            >
              <Avatar />
              <span className="flex items-center gap-1 pt-2.5" aria-hidden>
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    style={{ animationDelay: `${d}ms` }}
                    className="h-1.5 w-1.5 rounded-full bg-muted motion-safe:animate-pulse"
                  />
                ))}
              </span>
              <span className="sr-only">Thinking</span>
            </div>
          ) : null}
          {state?.error && !pending ? (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg-text"
            >
              {state.error}
            </p>
          ) : null}
          <div ref={end} className="h-2" />
        </div>
      )}

      {empty && state?.error && !pending ? (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg-text"
        >
          {state.error}
        </p>
      ) : null}

      <div className="sticky bottom-[5.5rem] z-10 -mx-1 mt-4 bg-bg/85 px-1 pb-1 pt-2 backdrop-blur md:bottom-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="rounded-2xl border border-line-strong bg-surface shadow-md transition-shadow focus-within:border-primary focus-within:shadow-lg"
        >
          <label htmlFor="q" className="sr-only">
            Your question
          </label>
          <textarea
            ref={box}
            id="q"
            name="question"
            rows={1}
            maxLength={MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send(text);
              }
            }}
            disabled={!available}
            placeholder={`Ask ${BRAND.assistantName} about your money`}
            className="block max-h-[200px] w-full resize-none bg-transparent shadow-none focus-visible:shadow-none px-4 pb-1 pt-3.5 text-[15px] leading-relaxed !outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-1">
            <p className="text-xs text-muted">
              <kbd className="font-sans">Enter</kbd> to send ·{" "}
              <kbd className="font-sans">Shift + Enter</kbd> for a new line
              {text.length > MAX - 100 ? (
                <span className="ml-2 tabular-nums">
                  {text.length}/{MAX}
                </span>
              ) : null}
            </p>
            {available ? (
              <button
                type="submit"
                aria-label="Ask"
                title="Ask"
                disabled={!canSend}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-all hover:bg-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={18} aria-hidden />
              </button>
            ) : null}
          </div>
        </form>
        <p className="mt-2 px-1 text-center text-xs text-muted">
          {BRAND.assistantName} uses only figures from your recorded
          transactions and checks every number before showing it. It cannot see
          individual transactions.
        </p>
      </div>
    </div>
  );
}

export function AssistantChat(props: {
  available: boolean;
  unavailableMessage: string;
  name: string | null;
  starters: Starter[];
  snapshot: Snapshot[];
}) {
  // A new chat is a fresh component: its conversation state starts empty.
  const [session, setSession] = useState(0);
  return (
    <Chat key={session} {...props} onNew={() => setSession((s) => s + 1)} />
  );
}
