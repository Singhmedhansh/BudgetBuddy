"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, useDismiss } from "./popover";

export type SelectOption = { value: string; label: string; group?: string };

const triggerCls =
  "flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface text-left text-fg transition-colors hover:border-primary/60 focus:border-primary aria-expanded:border-primary aria-[invalid=true]:border-neg disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A listbox-style select. A real <select> stays in the DOM (out of view and hidden from assistive technology) so the value
 * submits with the form exactly as before; this component only changes how choosing looks and feels.
 *
 * Keyboard: arrow keys, Home/End, type-ahead, Enter or Space to choose, Escape to close.
 */
export function Select({
  id,
  name,
  options,
  defaultValue,
  value,
  onChange,
  placeholder,
  label,
  invalid,
  describedBy,
  disabled,
  size = "md",
  className = "",
}: {
  id?: string;
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  const auto = useId();
  const triggerId = id ?? auto;
  const listId = `${auto}-list`;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === current);
  const headers = options.filter((o, i) => o.group && o.group !== options[i - 1]?.group).length;
  const want = Math.min(options.length * 38 + 20 + headers * 28, 320);
  const style = useAnchoredPosition(open, btnRef, want, { minWidth: 160 });
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btnRef, popRef], close);

  // A form reset puts the hidden select back to its default; follow it.
  useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form) return;
    const reset = () => setTimeout(() => setInner(nativeRef.current?.value ?? ""), 0);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, style]);

  const choose = (v: string) => {
    const el = nativeRef.current;
    if (el && el.value !== v) {
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setOpen(false);
    btnRef.current?.focus();
  };

  const openList = () => {
    const i = options.findIndex((o) => o.value === current);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(last, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active].value);
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const items = useMemo(() => options.map((o, i) => ({ o, i, header: o.group && o.group !== options[i - 1]?.group ? o.group : null })), [options]);
  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm";
  const nativeProps = controlled
    ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) }
    : {
        defaultValue: defaultValue ?? "",
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          setInner(e.target.value);
          onChange?.(e.target.value);
        },
      };

  return (
    <div className="relative">
      {/* The value that actually submits. Not focusable and not announced: the button below is the control. */}
      <select ref={nativeRef} name={name} tabIndex={-1} aria-hidden="true" disabled={disabled} className="sr-only" {...nativeProps}>
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        ref={btnRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${auto}-o${active}` : undefined}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`${triggerCls} ${pad} ${className}`}
      >
        <span className={`truncate ${selected ? "" : "text-muted/80"}`}>{selected ? selected.label : (placeholder ?? "Choose")}</span>
        <ChevronDown size={size === "sm" ? 14 : 16} aria-hidden className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && style
        ? createPortal(
            <ul ref={popRef} id={listId} role="listbox" aria-label={label} style={style} className="anim-pop glass z-[100] overflow-y-auto rounded-xl p-1.5 shadow-float">
              {items.map(({ o, i, header }) => (
                <li key={o.value} role="presentation">
                  {header ? <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted">{header}</div> : null}
                  <div
                    id={`${auto}-o${i}`}
                    role="option"
                    aria-selected={o.value === current}
                    data-index={i}
                    data-value={o.value}
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={`flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm ${i === active ? "bg-sage text-fg" : ""} ${o.value === current ? "font-medium" : ""}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.value === current ? <Check size={15} aria-hidden className="shrink-0 text-primary" /> : null}
                  </div>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
