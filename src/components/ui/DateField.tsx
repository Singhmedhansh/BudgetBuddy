"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, useDismiss } from "./popover";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string | undefined | null): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return iso(d) === s ? d : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const show = (s: string) => {
  const d = parse(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : "";
};

const triggerCls =
  "flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface text-left text-fg transition-colors hover:border-primary/60 focus:border-primary aria-expanded:border-primary data-[invalid=true]:border-neg disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A date field with a calendar. A real <input type="date"> stays in the DOM (out of view, hidden from assistive technology)
 * so the ISO value submits with the form unchanged; this component changes how the date is shown and chosen.
 *
 * Keyboard in the calendar: arrows move by day and week, PageUp and PageDown by month, Home and End to the ends of the week,
 * Enter chooses, Escape closes.
 */
export function DateField({
  id,
  name,
  defaultValue,
  min,
  max,
  label,
  invalid,
  describedBy,
  clearable,
  size = "md",
  className = "",
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  clearable?: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  const auto = useId();
  const triggerId = id ?? auto;
  const [value, setValue] = useState(parse(defaultValue) ? (defaultValue as string) : "");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "months">("days");
  const [view, setView] = useState(() => parse(value) ?? new Date());
  const [focusIso, setFocusIso] = useState(value);
  const nativeRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(open, btnRef, 400, { minWidth: 296, matchWidth: false });
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btnRef, popRef], close);

  // Follow changes made to the hidden input (form reset, scripted fill).
  useEffect(() => {
    const el = nativeRef.current;
    if (!el) return;
    const sync = () => setValue(parse(el.value) ? el.value : "");
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    const form = el.form;
    const reset = () => setTimeout(sync, 0);
    form?.addEventListener("reset", reset);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
      form?.removeEventListener("reset", reset);
    };
  }, []);

  const out = (s: string) => (min ? s < min : false) || (max ? s > max : false);
  const today = iso(new Date());

  const commit = (s: string) => {
    const el = nativeRef.current;
    if (el) {
      el.value = s;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setValue(s);
    setOpen(false);
    btnRef.current?.focus();
  };

  const openCal = () => {
    const start = parse(value) ?? parse(today)!;
    const bounded = out(iso(start)) ? (parse(max && iso(start) > max ? max : min) ?? start) : start;
    setView(bounded);
    setFocusIso(iso(bounded));
    setMode("days");
    setOpen(true);
  };

  // Put keyboard focus on the focused day whenever it changes while open.
  useEffect(() => {
    if (open && mode === "days") popRef.current?.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`)?.focus();
  }, [open, mode, focusIso, style]);

  const move = (d: Date) => {
    setFocusIso(iso(d));
    setView(d);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const cur = parse(focusIso) ?? new Date();
    const key = e.key;
    let next: Date | null = null;
    if (key === "ArrowLeft") next = addDays(cur, -1);
    else if (key === "ArrowRight") next = addDays(cur, 1);
    else if (key === "ArrowUp") next = addDays(cur, -7);
    else if (key === "ArrowDown") next = addDays(cur, 7);
    else if (key === "Home") next = addDays(cur, -((cur.getDay() + 6) % 7));
    else if (key === "End") next = addDays(cur, 6 - ((cur.getDay() + 6) % 7));
    else if (key === "PageUp") next = new Date(cur.getFullYear(), cur.getMonth() - (e.shiftKey ? 12 : 1), cur.getDate());
    else if (key === "PageDown") next = new Date(cur.getFullYear(), cur.getMonth() + (e.shiftKey ? 12 : 1), cur.getDate());
    if (next) {
      e.preventDefault();
      move(next);
    }
  };

  const onPopKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    } else if (e.key === "Tab") {
      // Tab leaves the calendar and carries on from the field.
      close();
      btnRef.current?.focus();
    }
  };

  const y = view.getFullYear();
  const m = view.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - lead + i));
  const monthStart = iso(new Date(y, m, 1));
  const monthEnd = iso(new Date(y, m + 1, 0));
  const canPrev = !min || min < monthStart;
  const canNext = !max || max > monthEnd;
  const navCls = "grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-sage hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  const padCls = size === "sm" ? "px-3 py-2 text-sm" : "px-3 py-2.5 text-sm";

  return (
    <div className="relative">
      <input ref={nativeRef} type="date" name={name} defaultValue={defaultValue} min={min} max={max} tabIndex={-1} aria-hidden="true" className="sr-only" />
      <button
        ref={btnRef}
        id={triggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label}${value ? `, ${show(value)}` : ""}` : undefined}
        data-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : openCal())}
        className={`${triggerCls} ${padCls} ${className}`}
      >
        <span className={`truncate ${value ? "" : "text-muted/80"}`}>{value ? show(value) : "Choose a date"}</span>
        <CalendarDays size={16} aria-hidden className="shrink-0 text-muted" />
      </button>
      {open && style
        ? createPortal(
            <div ref={popRef} role="dialog" aria-label="Choose a date" style={style} onKeyDown={onPopKey} className="anim-pop glass z-[100] overflow-y-auto rounded-2xl p-3 shadow-float">
              <div className="flex items-center justify-between gap-1">
                <button type="button" className={navCls} disabled={mode === "days" ? !canPrev : false} aria-label={mode === "days" ? "Previous month" : "Previous year"} onClick={() => setView(mode === "days" ? new Date(y, m - 1, 1) : new Date(y - 1, m, 1))}>
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <button type="button" aria-live="polite" onClick={() => setMode(mode === "days" ? "months" : "days")} className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-sage">
                  {mode === "days" ? `${MONTHS[m]} ${y}` : y}
                </button>
                <button type="button" className={navCls} disabled={mode === "days" ? !canNext : false} aria-label={mode === "days" ? "Next month" : "Next year"} onClick={() => setView(mode === "days" ? new Date(y, m + 1, 1) : new Date(y + 1, m, 1))}>
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>

              {mode === "days" ? (
                <div role="grid" aria-label={`${MONTHS[m]} ${y}`} onKeyDown={onGridKey} className="mt-2">
                  <div role="row" className="grid grid-cols-7 text-center text-xs text-muted">
                    {WEEK.map((w) => (
                      <span key={w} role="columnheader" aria-label={w} className="py-1.5 font-medium">
                        {w.slice(0, 2)}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-0.5">
                    {cells.map((d) => {
                      const s = iso(d);
                      const inMonth = d.getMonth() === m;
                      const sel = s === value;
                      const disabled = out(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          role="gridcell"
                          data-iso={s}
                          tabIndex={s === focusIso ? 0 : -1}
                          disabled={disabled}
                          aria-selected={sel}
                          aria-current={s === today ? "date" : undefined}
                          aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`}
                          onClick={() => commit(s)}
                          className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-30 ${
                            sel ? "bg-primary font-semibold text-primary-fg" : `${inMonth ? "text-fg" : "text-muted/60"} hover:bg-sage ${s === today ? "ring-1 ring-inset ring-primary" : ""}`
                          }`}
                        >
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {MONTHS.map((name, i) => {
                    const first = iso(new Date(y, i, 1));
                    const last = iso(new Date(y, i + 1, 0));
                    const disabled = (min ? last < min : false) || (max ? first > max : false);
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={disabled}
                        aria-pressed={i === m}
                        onClick={() => {
                          const target = new Date(y, i, 1);
                          setView(target);
                          setFocusIso(iso(target));
                          setMode("days");
                        }}
                        className={`rounded-lg py-2.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-30 ${i === m ? "bg-primary font-semibold text-primary-fg" : "hover:bg-sage"}`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                <button type="button" disabled={out(today)} onClick={() => commit(today)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-sage disabled:pointer-events-none disabled:opacity-30">
                  Today
                </button>
                {clearable && value ? (
                  <button type="button" onClick={() => commit("")} className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-sage hover:text-fg">
                    Clear
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
