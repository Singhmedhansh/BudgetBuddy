"use client";

import {
  ArrowUp,
  BookOpen,
  CalendarClock,
  Check,
  Gauge,
  Landmark,
  Paperclip,
  PiggyBank,
  Plus,
  Repeat,
  Tags,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/app/app/assistant-actions";
import { RichText } from "@/components/app/RichText";
import type { PlanId } from "@/config/plans";
import { AssistantMark } from "@/components/app/AssistantMark";
import { FinnVisuals } from "@/components/app/FinnVisuals";
import {
  CopyButton,
  MicButton,
  Thumbs,
  TypedText,
} from "@/components/app/FinnExtras";
import type { Insight } from "@/server/ai/insights";
import { UsageMeter, LimitCard } from "@/components/app/FinnUsage";
import type { Quota } from "@/server/ai/chats";
import { BRAND } from "@/config/brand";
import {
  followUps,
  type Starter,
  type StarterKind,
} from "@/server/ai/suggestions";

const MAX = 600;
const ICONS: Record<StarterKind, typeof Wallet> = {
  learn: BookOpen,
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

function Chat({
  compact = false,
  available,
  unavailableMessage,
  onNew,
  name,
  starters,
  snapshot,
  initialTurns,
  initialChatId,
  quota,
  onSaved,
  insights,
}: {
  compact?: boolean;
  insights: Insight[];
  initialTurns: Turn[];
  initialChatId: string | null;
  quota: Quota | null;
  onSaved: (chatId: string, firstQuestion: string) => void;
  available: boolean;
  unavailableMessage: string;
  onNew: () => void;
  name: string | null;
  starters: Starter[];
  snapshot: Snapshot[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [error, setError] = useState<string | undefined>();
  const [limit, setLimit] = useState<
    { kind: "day" | "month"; plan: PlanId } | undefined
  >();
  // While an answer is on its way: the person's question, what Finn is doing, and the sentences released so far.
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState("");
  // The answer that should reveal itself word by word (only when it was not already streamed in).
  const [typedIndex, setTypedIndex] = useState<number | null>(null);
  // Confirm cards cost nothing, so they are not counted against the day's allowance.
  const [freeAnswers, setFreeAnswers] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const shown: Turn[] =
    pendingQ !== null
      ? [...turns, { role: "user" as const, content: pendingQ }]
      : turns;
  const pending = pendingQ !== null;

  // How much of the plan's allowance is left (counted here as answers arrive).
  const answered =
    turns.filter((t) => t.role === "assistant").length -
    initialTurns.filter((t) => t.role === "assistant").length;
  const used = quota
    ? quota.questionsToday + Math.max(0, answered - freeAnswers)
    : 0;
  const exhausted =
    Boolean(quota) &&
    (used >= quota!.questionsPerDay ||
      quota!.tokensMonth >= quota!.tokensPerMonth ||
      limit !== undefined);
  const limitKind: "day" | "month" =
    limit?.kind ??
    (quota && quota.tokensMonth >= quota.tokensPerMonth ? "month" : "day");
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!chatId) return;
    const key = chatId + ":" + turns.length;
    if (key === lastSaved.current || turns.length === initialTurns.length)
      return;
    lastSaved.current = key;
    if (!initialChatId && !compact)
      window.history.replaceState(null, "", "/app/assistant?c=" + chatId);
    onSaved(chatId, turns.find((t) => t.role === "user")?.content ?? "");
  }, [chatId, turns, initialChatId, initialTurns.length, onSaved, compact]);

  const [text, setText] = useState("");
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
        // Follow a streaming answer without animation (a smooth scroll on every sentence lags); animate otherwise.
        behavior:
          live || window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
      });
  }, [shown.length, error, live]);

  async function send(raw: string) {
    const q = raw.trim();
    if (!q || pending || !available || exhausted) return;
    const attached = file;
    setText("");
    setFile(null);
    setFileError("");
    setError(undefined);
    setLimit(undefined);
    setLive("");
    setStatus("");
    setTypedIndex(null);
    const shownQuestion = attached ? `Attached: ${attached.name}\n${q}` : q;
    setPendingQ(shownQuestion);
    const fd = new FormData();
    fd.set("question", q);
    fd.set("history", JSON.stringify(turns));
    if (chatId) fd.set("chat", chatId);
    if (attached) fd.set("file", attached);
    if (compact) fd.set("brief", "1");
    const fail = (message: string, lim?: typeof limit) => {
      setError(message);
      setLimit(lim);
      setText(q);
      setPendingQ(null);
      setLive("");
    };
    let streamed = false;
    const sentAt = performance.now();
    let firstDeltaMs = 0;
    try {
      const res = await fetch("/api/finn/ask", { method: "POST", body: fd });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok || !res.body)
        return fail(
          "Finn could not answer right now. Please try again in a moment.",
        );
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: {
            t: string;
            v?: string;
            message?: string;
            limit?: { kind: "day" | "month"; plan: PlanId };
            answer?: string;
            source?: Turn["source"];
            visuals?: Turn["visuals"];
            id?: number | null;
            proposal?: boolean;
            timing?: Record<string, number>;
            chatId?: string | null;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "status") setStatus(ev.v ?? "");
          else if (ev.t === "delta") {
            if (!streamed)
              firstDeltaMs = Math.round(performance.now() - sentAt);
            streamed = true;
            setLive((l) => l + (ev.v ?? ""));
          } else if (ev.t === "error") {
            finished = true;
            fail(ev.message ?? "Finn could not answer right now.", ev.limit);
          } else if (ev.t === "done") {
            finished = true;
            const next: Turn[] = [
              ...turns,
              { role: "user" as const, content: shownQuestion },
              {
                role: "assistant" as const,
                content: ev.answer ?? "",
                source: ev.source,
                visuals: ev.visuals,
                id: ev.id ?? undefined,
              },
            ].slice(-40);
            setTurns(next);
            if (!streamed) setTypedIndex(next.length - 1);
            if (ev.proposal) setFreeAnswers((n) => n + 1);
            // Stage timings from the server, kept for support and for measuring speed in the browser console.
            (window as unknown as { __finnTiming?: unknown }).__finnTiming = {
              ...ev.timing,
              firstDeltaClientMs: firstDeltaMs,
              doneClientMs: Math.round(performance.now() - sentAt),
            };
            if (ev.chatId) setChatId(ev.chatId);
            setPendingQ(null);
            setLive("");
          }
        }
      }
      if (!finished)
        fail("Finn could not answer right now. Please try again in a moment.");
    } catch {
      fail("Finn could not answer right now. Please try again in a moment.");
    }
  }

  function pickFile(f: File | null) {
    setFileError("");
    if (!f) return setFile(null);
    if (f.size > 3 * 1024 * 1024) {
      setFileError("That file is over 3 MB.");
      return setFile(null);
    }
    if (!/\.(pdf|csv|tsv|txt|md)$/i.test(f.name)) {
      setFileError("Attach a PDF, CSV or text file.");
      return setFile(null);
    }
    setFile(f);
  }

  const empty = shown.length === 0;
  const canSend = available && !exhausted && !pending && text.trim().length > 0;

  return (
    <div
      className={
        compact
          ? "flex h-full min-h-0 flex-col"
          : "flex min-h-[calc(100dvh-17rem)] flex-col"
      }
    >
      <div
        className={
          compact ? "min-h-0 flex-1 overflow-y-auto px-3 py-3" : "contents"
        }
      >
        {!available ? (
          <p
            role="status"
            className="mb-4 rounded-xl border border-line bg-sunken px-4 py-3 text-sm leading-relaxed"
          >
            {unavailableMessage}
          </p>
        ) : null}

        {empty ? (
          <div
            className={`flex flex-1 flex-col items-center justify-center text-center ${compact ? "py-2" : "py-8"}`}
          >
            <AssistantMark size={compact ? 40 : 56} />
            <h2
              className={`mt-3 font-display leading-tight ${compact ? "text-xl" : "mt-4 text-2xl sm:text-3xl"}`}
            >
              {name
                ? `Hi ${name}, I'm ${BRAND.assistantName}.`
                : `Hi, I'm ${BRAND.assistantName}.`}
            </h2>
            <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-muted">
              Ask me anything about your money: what you spent, where it went,
              whether you can afford something, what is coming up. I work from
              your own records and check every number before I say it.
            </p>
            {!compact && snapshot.length > 0 ? (
              <dl className="mt-6 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-3">
                {snapshot.map((t) => (
                  <div
                    key={t.label}
                    className="rounded-xl border border-line bg-surface px-4 py-3 text-left"
                  >
                    <dt className="text-xs text-muted">{t.label}</dt>
                    <dd className="num mt-0.5 font-display text-lg">
                      {t.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {insights.length > 0 ? (
              <section
                aria-label="What Finn noticed"
                className="mt-6 w-full max-w-xl text-left"
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {BRAND.assistantName} noticed
                </h3>
                <ul className="space-y-2">
                  {insights.map((i) => (
                    <li key={i.text}>
                      <button
                        type="button"
                        disabled={exhausted}
                        onClick={() => send(i.ask)}
                        className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm transition-all hover:border-line-strong hover:shadow-sm disabled:opacity-60"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background:
                              i.tone === "warn"
                                ? "var(--warn)"
                                : i.tone === "good"
                                  ? "var(--pos)"
                                  : "var(--info)",
                          }}
                        />
                        <span>{i.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {available ? (
              <ul
                className={
                  compact
                    ? "mt-4 grid w-full gap-2"
                    : "mt-6 grid w-full max-w-xl gap-2.5 sm:grid-cols-2"
                }
              >
                {starters.map(({ text: e, kind }) => {
                  const Icon = ICONS[kind];
                  return (
                    <li key={e}>
                      <button
                        type="button"
                        disabled={exhausted}
                        onClick={() => send(e)}
                        className="group flex h-full w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
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
                      <TypedText text={t.content} animate={i === typedIndex} />
                      {t.visuals?.length ? (
                        <FinnVisuals visuals={t.visuals} />
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Check size={12} aria-hidden className="text-pos" />
                          {t.source === "general"
                            ? "General guidance, not from your records"
                            : t.source === "figures"
                              ? "Verified figures from your records"
                              : "Figures checked against your records"}
                        </span>
                        <CopyButton text={t.content} />
                        {t.id ? (
                          <Thumbs id={t.id} initial={t.feedback} />
                        ) : null}
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
            !error ? (
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
                aria-label={`${BRAND.assistantName} is answering`}
                className="mt-6 flex gap-3"
              >
                <Avatar />
                {live ? (
                  <div className="min-w-0 max-w-[92%] flex-1">
                    <RichText text={live} />
                    <span
                      aria-hidden
                      className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 rounded-sm bg-primary motion-safe:animate-pulse"
                    />
                  </div>
                ) : (
                  <>
                    <span
                      className="flex items-center gap-1 pt-2.5"
                      aria-hidden
                    >
                      {[0, 150, 300].map((d) => (
                        <span
                          key={d}
                          style={{ animationDelay: `${d}ms` }}
                          className="h-1.5 w-1.5 rounded-full bg-muted motion-safe:animate-pulse"
                        />
                      ))}
                    </span>
                    <span className="pt-1.5 text-sm text-muted">
                      {status ? status + "\u2026" : "Thinking"}
                    </span>
                  </>
                )}
              </div>
            ) : null}
            {error && !pending ? (
              <p
                role="alert"
                className="mt-6 rounded-xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg-text"
              >
                {error}
              </p>
            ) : null}
            <div ref={end} className="h-2" />
          </div>
        )}

        {empty && error && !pending ? (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-neg/30 bg-neg/10 px-4 py-3 text-sm text-neg-text"
          >
            {error}
          </p>
        ) : null}

        {quota ? <UsageMeter quota={quota} used={used} /> : null}
        {exhausted && quota ? (
          <LimitCard
            plan={quota.plan}
            kind={limitKind}
            perDay={quota.questionsPerDay}
          />
        ) : null}
      </div>

      <div
        className={
          compact
            ? "shrink-0 border-t border-line bg-bg px-3 pb-3 pt-2"
            : "sticky bottom-[5.5rem] z-10 -mx-1 mt-4 bg-bg/85 px-1 pb-1 pt-2 backdrop-blur md:bottom-0"
        }
      >
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
            disabled={!available || exhausted}
            placeholder={`Ask ${BRAND.assistantName} about your money`}
            className="block max-h-[200px] w-full resize-none bg-transparent shadow-none focus-visible:shadow-none px-4 pb-1 pt-3.5 text-[15px] leading-relaxed !outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {file || fileError ? (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-1">
              {file ? (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-sunken px-2.5 py-1 text-xs">
                  <Paperclip size={12} aria-hidden />
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={() => pickFile(null)}
                    className="text-muted hover:text-fg"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ) : null}
              {fileError ? (
                <span role="alert" className="text-xs text-neg-text">
                  {fileError}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-1">
            <p className={compact ? "hidden" : "text-xs text-muted"}>
              <kbd className="font-sans">Enter</kbd> to send ·{" "}
              <kbd className="font-sans">Shift + Enter</kbd> for a new line
              {text.length > MAX - 100 ? (
                <span className="ml-2 tabular-nums">
                  {text.length}/{MAX}
                </span>
              ) : null}
            </p>
            {available ? (
              <span className="ml-auto flex items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".pdf,.csv,.tsv,.txt,.md,application/pdf,text/*"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach a statement, slip or loan sheet"
                  title="Attach a PDF, CSV or text file"
                  disabled={exhausted || pending}
                  onClick={() => fileInput.current?.click()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Paperclip size={16} aria-hidden />
                </button>
                <MicButton
                  disabled={exhausted || pending}
                  onText={(v) => setText((cur) => (cur ? cur + " " : "") + v)}
                />
                <button
                  type="submit"
                  aria-label="Ask"
                  title="Ask"
                  disabled={!canSend}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-all hover:bg-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp size={18} aria-hidden />
                </button>
              </span>
            ) : null}
          </div>
        </form>
        <p
          className={
            compact ? "hidden" : "mt-2 px-1 text-center text-xs text-muted"
          }
        >
          {BRAND.assistantName} uses only figures from your recorded
          transactions and checks every number before showing it. It cannot see
          your account numbers.
        </p>
      </div>
    </div>
  );
}

export interface AssistantChatProps {
  /** The small chat inside the floating panel: no page-sized spacing, scrolls on its own, never touches the address bar. */
  compact?: boolean;
  available: boolean;
  unavailableMessage: string;
  name: string | null;
  starters: Starter[];
  snapshot: Snapshot[];
  initialTurns: Turn[];
  initialChatId: string | null;
  quota: Quota | null;
  insights: Insight[];
  onSaved: (chatId: string, firstQuestion: string) => void;
  /** Starts a fresh chat (the history rail and the button in the chat both use it). */
  onNew: () => void;
}

export function AssistantChat(props: AssistantChatProps) {
  return <Chat {...props} />;
}
