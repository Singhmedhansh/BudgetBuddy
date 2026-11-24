"use client";

import { ArrowUp, Check, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AssistantMark } from "@/components/app/AssistantMark";
import { BRAND } from "@/config/brand";
import { Bar, Window } from "./parts";

const FINN = BRAND.assistantName;
const TRIES = 2;

type Row = { amount: string; category: string; day: string };
type Reply =
  | { kind: "saved"; rows: Row[]; preview?: boolean }
  | { kind: "text"; text: string; bar?: { label: string; pct: number } }
  | { kind: "limit" }
  | { kind: "signedIn" }
  | { kind: "error"; text: string };

/** A scripted conversation on sample data. Nothing here is sent anywhere or belongs to a real person. */
const SCENES: { ask: string; reply: Reply }[] = [
  { ask: "400 spent on food", reply: { kind: "saved", rows: [{ amount: "₹400", category: "Food", day: "Today" }] } },
  {
    ask: "200 auto, 150 chai yesterday",
    reply: {
      kind: "saved",
      rows: [
        { amount: "₹200", category: "Transport", day: "Yesterday" },
        { amount: "₹150", category: "Food", day: "Yesterday" },
      ],
    },
  },
  {
    ask: "Can I afford a ₹7,000 monitor this month?",
    reply: { kind: "text", text: "Yes. After your bills you have ₹18,400 left to spend this month, so the monitor still leaves ₹11,400.", bar: { label: "Spendable money used", pct: 38 } },
  },
  { ask: "What is a SIP?", reply: { kind: "text", text: "A SIP puts a fixed amount into a mutual fund every month, so you invest steadily without timing the market." } },
];

const SUGGESTIONS = ["450 on groceries", "What is a good emergency fund?", "Old or new tax regime?"];

const reduceQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(reduceQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(reduceQuery).matches,
    () => false,
  );
}

function FinnReply({ reply }: { reply: Reply }) {
  if (reply.kind === "saved")
    return (
      <div className="w-full rounded-xl border border-line bg-surface p-3 shadow-sm">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-pos-text">
          <Check size={13} aria-hidden /> {reply.preview ? "This is what would be recorded" : "Recorded"}
        </p>
        <ul className="mt-2 space-y-1.5 text-xs">
          {reply.rows.map((r) => (
            <li key={r.amount + r.category} className="flex items-center justify-between gap-3">
              <span className="num font-semibold">{r.amount}</span>
              <span className="text-muted">{r.category}</span>
              <span className="text-muted">{r.day}</span>
            </li>
          ))}
        </ul>
        {reply.preview ? (
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted">Nothing is saved on this page. With an account, {FINN} records it in the right account and category, and you can undo it.</p>
        ) : (
          <span className="mt-2.5 inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-[11px] font-medium text-muted">
            <Undo2 size={11} aria-hidden /> Undo
          </span>
        )}
      </div>
    );
  if (reply.kind === "limit")
    return (
      <div className="w-full rounded-xl border border-primary/30 bg-sage p-4 text-sm">
        <p className="font-semibold">That was your {TRIES} free tries</p>
        <p className="mt-1.5 leading-relaxed text-muted">
          Create a free account to keep going. {FINN} then records what you spend for real and answers from your own numbers. The {TRIES} messages you just used count towards your new account&rsquo;s allowance.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/signup" className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-fg hover:bg-primary-hover">
            Create a free account
          </Link>
          <Link href="/login" className="rounded-full border border-line-strong bg-surface px-4 py-2 text-xs font-semibold hover:border-primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  if (reply.kind === "signedIn")
    return (
      <div className="w-full rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="leading-relaxed">You are signed in, so {FINN} can use your own records. Ask there instead.</p>
        <Link href="/app/assistant" className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-fg hover:bg-primary-hover">
          Open {FINN}
        </Link>
      </div>
    );
  if (reply.kind === "error") return <p className="text-sm leading-relaxed text-muted">{reply.text}</p>;
  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      <p>{reply.text}</p>
      {reply.bar ? (
        <div>
          <Bar pct={reply.bar.pct} />
          <p className="mt-1 text-[11px] text-muted">{reply.bar.label}</p>
        </div>
      ) : null}
    </div>
  );
}

function Thinking() {
  return (
    <span className="mt-2 inline-flex gap-1" role="status" aria-label={`${FINN} is thinking`}>
      {[0, 1, 2].map((d) => (
        <i key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${d * 150}ms` }} />
      ))}
    </span>
  );
}

function Exchange({ ask, reply }: { ask: string; reply: Reply | null }) {
  return (
    <div className="space-y-3">
      <p className="finn-rise ml-auto w-fit max-w-[85%] break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-fg">{ask}</p>
      <div className="flex items-start gap-2.5">
        <AssistantMark size={26} className="mt-0.5 shrink-0" />
        {reply ? (
          <div className="finn-rise min-w-0 flex-1">
            <FinnReply reply={reply} />
          </div>
        ) : (
          <Thinking />
        )}
      </div>
    </div>
  );
}

/**
 * The hero of the home page. It plays a scripted conversation on sample data until the visitor types; then it is a real
 * conversation with Finn: TRIES messages without an account, then an invitation to sign up. Spending messages are shown
 * as what would be recorded (nothing is saved); questions get a short, general answer.
 */
export function FinnDemo() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [live, setLive] = useState<{ ask: string; reply: Reply | null }[] | null>(null);
  const [text, setText] = useState("");
  const [left, setLeft] = useState(TRIES);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const done = left <= 0 || live?.some((m) => m.reply?.kind === "limit" || m.reply?.kind === "signedIn");

  useEffect(() => {
    if (reduced || live) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % (SCENES.length * 2)), step % 2 === 0 ? 900 : 2600);
    return () => clearTimeout(t);
  }, [step, reduced, live]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [live, reduced]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy || done) return;
    setText("");
    setBusy(true);
    setLive((l) => [...(l ?? []), { ask: m, reply: null }]);
    let reply: Reply;
    let after = left;
    try {
      const res = await fetch("/api/finn/try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m }) });
      const j = (await res.json().catch(() => ({}))) as {
        reply?: { kind: "record"; rows: Row[] } | { kind: "text"; text: string };
        left?: number;
        limit?: boolean;
        signedIn?: boolean;
        unavailable?: boolean;
        message?: string;
      };
      if (typeof j.left === "number") {
        after = j.left;
        setLeft(j.left);
      }
      if (j.signedIn) reply = { kind: "signedIn" };
      else if (j.limit) reply = { kind: "limit" };
      else if (j.reply?.kind === "record") reply = { kind: "saved", rows: j.reply.rows, preview: true };
      else if (j.reply?.kind === "text") reply = { kind: "text", text: j.reply.text };
      else if (j.unavailable) reply = { kind: "error", text: `${FINN} is busy right now. Try again in a minute; this one did not count.` };
      else reply = { kind: "error", text: j.message ?? "Something went wrong. Try again." };
    } catch {
      reply = { kind: "error", text: "Could not reach Finn. Check your connection; this one did not count." };
    }
    setLive((l) => {
      const next = [...(l ?? [])];
      next[next.length - 1] = { ask: m, reply };
      // After the last free try, the invitation to sign up follows the answer.
      if (reply.kind !== "limit" && reply.kind !== "signedIn" && reply.kind !== "error" && after <= 0) next.push({ ask: "", reply: { kind: "limit" } });
      return next;
    });
    setBusy(false);
  }

  const scene = reduced ? 1 : Math.floor(step / 2);
  const answered = reduced || step % 2 === 1;
  const shown = SCENES.slice(Math.max(0, scene - 1), scene + 1);

  return (
    <div className="relative mx-auto w-full max-w-[34rem] pb-6 pt-6 lg:mx-0">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-info/10 blur-2xl" />
      <div className="anim-rise" style={{ animationDelay: "120ms" }}>
        <Window title={`${FINN} · your money assistant`} badge={live ? "Try it" : undefined}>
          <div ref={scroller} className="flex h-[23rem] flex-col gap-4 overflow-y-auto p-5" aria-live={live ? "polite" : "off"} aria-label={live ? `Your conversation with ${FINN}` : `Example conversation with ${FINN}`}>
            <div className="mt-auto" />
            {live
              ? live.map((m, i) =>
                  m.ask ? (
                    <Exchange key={i} ask={m.ask} reply={m.reply} />
                  ) : (
                    <div key={i} className="finn-rise flex items-start gap-2.5">
                      <AssistantMark size={26} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">{m.reply ? <FinnReply reply={m.reply} /> : null}</div>
                    </div>
                  ),
                )
              : shown.map((s, i) => <Exchange key={s.ask} ask={s.ask} reply={i < shown.length - 1 || answered ? s.reply : null} />)}
          </div>
          <div className="border-t border-line px-5 py-3">
            {!live ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-primary hover:text-fg">
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
              className="flex items-center gap-2 rounded-full border border-line bg-bg py-1 pl-4 pr-1 focus-within:border-primary"
            >
              <label htmlFor="finn-try" className="sr-only">
                Message {FINN}
              </label>
              <input
                id="finn-try"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setLive((l) => l ?? [])}
                disabled={Boolean(done)}
                maxLength={300}
                autoComplete="off"
                placeholder={done ? "Create a free account to keep going" : `Tell ${FINN} what you spent, or ask anything`}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed"
              />
              <button type="submit" disabled={busy || !text.trim() || Boolean(done)} aria-label="Send" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg transition-opacity disabled:opacity-40">
                <ArrowUp size={15} aria-hidden />
              </button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted">
              {done ? "Free tries used. Your account keeps the conversation going." : `Try it: ${left} free message${left === 1 ? "" : "s"} without an account. Nothing you type here is saved.`}
            </p>
          </div>
        </Window>
      </div>
    </div>
  );
}
