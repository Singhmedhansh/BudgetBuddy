"use client";

import { Check, Undo2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AssistantMark } from "@/components/app/AssistantMark";
import { BRAND } from "@/config/brand";
import { Bar, Window } from "./parts";

type Reply =
  | { kind: "saved"; rows: [string, string, string][] }
  | { kind: "text"; text: string; bar?: { label: string; pct: number } };

/** A scripted conversation on sample data. Nothing here is sent anywhere or belongs to a real person. */
const SCENES: { ask: string; reply: Reply }[] = [
  {
    ask: "400 spent on food",
    reply: { kind: "saved", rows: [["₹400", "Food", "Today"]] },
  },
  {
    ask: "200 auto, 150 chai yesterday",
    reply: {
      kind: "saved",
      rows: [
        ["₹200", "Transport", "Yesterday"],
        ["₹150", "Food", "Yesterday"],
      ],
    },
  },
  {
    ask: "Can I afford a ₹7,000 monitor this month?",
    reply: {
      kind: "text",
      text: "Yes. After your bills you have ₹18,400 left to spend this month, so the monitor still leaves ₹11,400.",
      bar: { label: "Spendable money used", pct: 38 },
    },
  },
  {
    ask: "What is a SIP?",
    reply: {
      kind: "text",
      text: "A SIP puts a fixed amount into a mutual fund every month, so you invest steadily without timing the market.",
    },
  },
];

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
          <Check size={13} aria-hidden /> Recorded
        </p>
        <ul className="mt-2 space-y-1.5 text-xs">
          {reply.rows.map(([amount, category, day]) => (
            <li
              key={amount + category}
              className="flex items-center justify-between gap-3"
            >
              <span className="num font-semibold">{amount}</span>
              <span className="text-muted">{category}</span>
              <span className="text-muted">{day}</span>
            </li>
          ))}
        </ul>
        <span className="mt-2.5 inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-[11px] font-medium text-muted">
          <Undo2 size={11} aria-hidden /> Undo
        </span>
      </div>
    );
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

/**
 * The hero of the landing page: Finn recording money from plain words and answering questions, on sample data. It plays
 * through the scenes on a loop; with reduced motion it shows the first two exchanges and stays still.
 */
export function FinnDemo() {
  const reduced = useReducedMotion();
  // step counts half-scenes: even = question shown and Finn thinking, odd = answer shown.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(
      () => setStep((s) => (s + 1) % (SCENES.length * 2)),
      step % 2 === 0 ? 900 : 2600,
    );
    return () => clearTimeout(t);
  }, [step, reduced]);

  const scene = reduced ? 1 : Math.floor(step / 2);
  const answered = reduced || step % 2 === 1;
  // The exchange before the current one stays above it, like a real chat.
  const shown = SCENES.slice(Math.max(0, scene - 1), scene + 1);

  return (
    <div className="relative mx-auto w-full max-w-[34rem] pb-6 pt-6 lg:mx-0">
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-info/10 blur-2xl"
      />
      <div className="anim-rise" style={{ animationDelay: "120ms" }}>
        <Window title={`${BRAND.assistantName} · your money assistant`}>
          <div
            className="flex min-h-[23rem] flex-col justify-end gap-4 p-5"
            aria-label={`Example conversation with ${BRAND.assistantName}`}
          >
            {shown.map((s, i) => {
              const current = i === shown.length - 1;
              return (
                <div key={s.ask} className="space-y-3">
                  <p className="finn-rise ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-fg">
                    {s.ask}
                  </p>
                  <div className="flex items-start gap-2.5">
                    <AssistantMark size={26} className="mt-0.5 shrink-0" />
                    {!current || answered ? (
                      <div className="finn-rise min-w-0 flex-1">
                        <FinnReply reply={s.reply} />
                      </div>
                    ) : (
                      <span
                        className="mt-2 inline-flex gap-1"
                        aria-label={`${BRAND.assistantName} is thinking`}
                      >
                        {[0, 1, 2].map((d) => (
                          <i
                            key={d}
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted"
                            style={{ animationDelay: `${d * 150}ms` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-line px-5 py-3">
            <p className="rounded-full border border-line bg-bg px-4 py-2 text-sm text-muted">
              Tell {BRAND.assistantName} what you spent, or ask anything
            </p>
          </div>
        </Window>
      </div>
    </div>
  );
}
