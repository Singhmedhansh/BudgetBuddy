"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { passwordStrength } from "@/lib/password";

const inputCls =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-muted/70 focus:border-primary aria-[invalid=true]:border-neg";

export function Field({
  label,
  name,
  type = "text",
  error,
  defaultValue,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? msgId : undefined}
        className={inputCls}
      />
      {error ? (
        <p id={msgId} className="mt-1.5 text-sm text-neg-text">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with show/hide and, for new passwords, a strength readout. */
export function PasswordField({
  label,
  name,
  error,
  autoComplete,
  showStrength,
}: {
  label: string;
  name: string;
  error?: string;
  autoComplete: string;
  showStrength?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const s = passwordStrength(value);
  const msgId = `${id}-msg`;
  const bar = ["bg-line-strong", "bg-neg", "bg-warn", "bg-pos", "bg-pos"][s.score];
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || showStrength ? msgId : undefined}
          className={`${inputCls} pr-16`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-muted hover:text-fg"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {showStrength && value ? (
        <div id={msgId} className="mt-2" aria-live="polite">
          <div className="flex gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= s.score ? bar : "bg-line"}`} />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {s.label}
            {s.hint ? `. ${s.hint}` : ""}
          </p>
        </div>
      ) : error ? (
        <p id={msgId} className="mt-1.5 text-sm text-neg-text">
          {error}
        </p>
      ) : null}
      {showStrength && error ? <p className="mt-1.5 text-sm text-neg-text">{error}</p> : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-md border px-3 py-2.5 text-sm ${error ? "border-neg/50 bg-neg/10 text-neg-text" : "border-pos/50 bg-pos/10 text-pos-text"}`}
    >
      {error ?? notice}
    </p>
  );
}
