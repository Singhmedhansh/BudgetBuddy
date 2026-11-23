"use client";

import { ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  loadFinnWidgetAction,
  type FinnWidgetData,
} from "@/app/app/finn-widget-actions";
import { AssistantChat } from "@/components/app/AssistantChat";
import { AssistantMark } from "@/components/app/AssistantMark";
import { BRAND } from "@/config/brand";
import {
  starters as defaultStarters,
  type Starter,
} from "@/server/ai/suggestions";

/** Pages where the floating chat would only get in the way: Finn's own page, setup and payment. */
const HIDDEN_ON = [
  "/app/assistant",
  "/app/onboarding",
  "/app/checkout",
  "/app/finn-review",
];

/** Questions that fit the page the person is on, shown first. */
const PAGE_STARTERS: [string, Starter[]][] = [
  [
    "/app/budgets",
    [{ text: "Am I on track with my budgets this month?", kind: "budget" }],
  ],
  ["/app/bills", [{ text: "What bills are coming up?", kind: "bills" }]],
  [
    "/app/subscriptions",
    [{ text: "How much do my subscriptions cost me a year?", kind: "subs" }],
  ],
  ["/app/goals", [{ text: "How are my savings goals going?", kind: "goals" }]],
  [
    "/app/analytics",
    [{ text: "Where did most of my money go?", kind: "spend" }],
  ],
  [
    "/app/transactions",
    [{ text: "Which category is my biggest expense?", kind: "category" }],
  ],
  ["/app/debt", [{ text: "How much do I owe in total?", kind: "worth" }]],
  [
    "/app/forecast",
    [{ text: "Am I spending faster than usual this month?", kind: "pace" }],
  ],
];

/**
 * Finn as a floating chat on every signed-in page: a launcher in the corner that opens a small chat panel. It is the
 * same Finn as the full page (same checks, same allowance, same saved history) and loads nothing until it is opened.
 * The layout it sits in stays mounted while people move between pages, so the conversation is still there.
 */
export function FinnWidget() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [data, setData] = useState<FinnWidgetData | null>(null);
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState(0);
  const [chatId, setChatId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    if (loading || data) return;
    setLoading(true);
    setFailed(false);
    loadFinnWidgetAction().then(
      (d) => {
        setData(d);
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      },
    );
  }, [loading, data]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !everOpened) setEverOpened(true);
    if (next) load();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (HIDDEN_ON.some((p) => path.startsWith(p))) return null;

  // The page's own question first, then the personal ones once they have loaded, then the general ones.
  const pageQs = PAGE_STARTERS.find(([p]) => path.startsWith(p))?.[1] ?? [];
  const base = data?.starters ?? defaultStarters(null);
  const pageStarters = [
    ...pageQs,
    ...base.filter((b) => !pageQs.some((q) => q.text === b.text)),
  ].slice(0, 4);

  return (
    <>
      {everOpened ? (
        <section
          role="dialog"
          aria-label={`Chat with ${BRAND.assistantName}`}
          className={`finn-rise fixed inset-x-2 bottom-2 top-16 z-50 ${open ? "flex" : "hidden"} flex-col overflow-hidden rounded-2xl border border-line-strong bg-bg shadow-lg md:inset-x-auto md:bottom-7 md:right-7 md:top-auto md:h-[min(40rem,calc(100dvh-6rem))] md:w-[26rem]`}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3.5 py-2.5">
            <AssistantMark size={28} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base leading-tight">
                {BRAND.assistantName}
              </p>
              <p className="truncate text-xs text-muted">
                Your money assistant
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSession((s) => s + 1)}
              aria-label="New chat"
              title="New chat"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg"
            >
              <Plus size={16} aria-hidden />
            </button>
            <Link
              href={chatId ? `/app/assistant?c=${chatId}` : "/app/assistant"}
              onClick={() => setOpen(false)}
              aria-label="Open full page"
              title="Open full page"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg"
            >
              <ExternalLink size={15} aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              title="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg"
            >
              <X size={17} aria-hidden />
            </button>
          </header>
          <div className="relative min-h-0 flex-1">
            <AssistantChat
              key={session}
              compact
              available={data?.available ?? true}
              unavailableMessage={data?.unavailableMessage ?? ""}
              name={data?.name ?? null}
              starters={pageStarters}
              snapshot={[]}
              initialTurns={[]}
              initialChatId={null}
              quota={data?.quota ?? null}
              insights={data?.insights ?? []}
              onSaved={(id) => setChatId(id)}
              onNew={() => {
                setChatId(null);
                setSession((s) => s + 1);
              }}
            />
            {failed ? (
              <button
                type="button"
                onClick={load}
                className="absolute right-3 top-14 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:text-fg"
              >
                Could not load your details. Retry
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        onPointerEnter={load}
        onFocus={load}
        onTouchStart={load}
        aria-expanded={open}
        aria-label={open ? "Close Finn" : `Ask ${BRAND.assistantName}`}
        className={`group fixed bottom-24 right-4 z-40 items-center gap-2.5 rounded-full bg-primary py-2 pl-2 pr-2 text-primary-fg shadow-float transition-all hover:-translate-y-0.5 hover:bg-primary-hover active:scale-95 md:bottom-7 md:right-7 md:pr-4 ${open ? "hidden md:flex md:pointer-events-none md:opacity-0" : "flex"}`}
      >
        <span className="relative grid h-9 w-9 place-items-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-mint/40 motion-safe:animate-ping [animation-duration:2.5s] [animation-iteration-count:3]"
          />
          <AssistantMark size={36} className="relative" />
        </span>
        <span className="hidden text-sm font-semibold md:inline">
          Ask {BRAND.assistantName}
        </span>
      </button>
    </>
  );
}
