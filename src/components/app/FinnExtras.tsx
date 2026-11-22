"use client";

import { Check, Copy, Mic, MicOff, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { feedbackAction } from "@/app/app/assistant-actions";
import { RichText } from "@/components/app/RichText";

/**
 * The newest answer appears word by word, like ChatGPT and Claude. The answer is already checked by the time it is
 * shown, so nothing unverified ever flashes on screen. Older answers, and people who prefer less motion, get the full text.
 */
export function TypedText({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  const words = text.split(/(s+)/);
  const [count, setCount] = useState(() =>
    animate &&
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : words.length,
  );
  useEffect(() => {
    if (count >= words.length) return;
    // About two seconds for a long answer, quicker for a short one.
    const step = Math.max(1, Math.ceil(words.length / 70));
    const id = window.setInterval(
      () =>
        setCount((c) =>
          c + step >= words.length
            ? (window.clearInterval(id), words.length)
            : c + step,
        ),
      28,
    );
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words.length]);
  return (
    <RichText
      text={count >= words.length ? text : words.slice(0, count).join("")}
    />
  );
}

export function CopyButton({ text }: { text: string }) {
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

/** Thumbs up or down on an answer. Saved with the message, so wrong answers can be found and fixed. */
export function Thumbs({
  id,
  initial,
}: {
  id: number;
  initial?: "up" | "down";
}) {
  const [value, setValue] = useState<"up" | "down" | null>(initial ?? null);
  const [, start] = useTransition();
  const set = (v: "up" | "down") => {
    const next = value === v ? null : v;
    setValue(next);
    start(async () => {
      await feedbackAction(id, next);
    });
  };
  const base =
    "grid h-6 w-6 place-items-center rounded-md transition-colors hover:bg-sunken";
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="group"
      aria-label="Rate this answer"
    >
      <button
        type="button"
        aria-pressed={value === "up"}
        aria-label="Good answer"
        title="Good answer"
        onClick={() => set("up")}
        className={`${base} ${value === "up" ? "text-pos-text" : "text-muted hover:text-fg"}`}
      >
        <ThumbsUp size={13} aria-hidden />
      </button>
      <button
        type="button"
        aria-pressed={value === "down"}
        aria-label="Wrong or unhelpful"
        title="Wrong or unhelpful"
        onClick={() => set("down")}
        className={`${base} ${value === "down" ? "text-neg-text" : "text-muted hover:text-fg"}`}
      >
        <ThumbsDown size={13} aria-hidden />
      </button>
      {value === "down" ? (
        <span className="ml-1 text-xs text-muted">
          Thanks, we will look at it.
        </span>
      ) : null}
    </span>
  );
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Speak a question. Uses the browser's own speech recognition; the audio is handled by the browser, not by FinnTrack. */
export function MicButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const supported = useSyncExternalStore(
    () => () => {},
    () => {
      const w = window as unknown as {
        SpeechRecognition?: unknown;
        webkitSpeechRecognition?: unknown;
      };
      return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    },
    () => false,
  );
  const rec = useRef<Recognition | null>(null);
  if (!supported) return null;
  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = "en-IN";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) =>
      onText(
        Array.from(e.results)
          .map((x) => x[0]?.transcript ?? "")
          .join(" ")
          .trim(),
      );
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Ask by voice"}
      title={listening ? "Stop listening" : "Ask by voice"}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-40 ${listening ? "animate-pulse border-neg bg-neg/10 text-neg-text" : "border-line-strong text-muted hover:border-primary hover:text-fg"}`}
    >
      {listening ? (
        <MicOff size={16} aria-hidden />
      ) : (
        <Mic size={16} aria-hidden />
      )}
    </button>
  );
}
