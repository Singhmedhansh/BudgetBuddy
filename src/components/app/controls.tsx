"use client";

import { useId } from "react";

const base =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-fg focus:border-primary aria-[invalid=true]:border-neg";

export function SelectField({
  label,
  name,
  options,
  error,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  error?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
        className={base}
      >
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
      {error ? (
        <p id={`${id}-e`} className="mt-1.5 text-sm text-neg-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A group of mutually exclusive choices shown as selectable rows, with a description each. */
export function ChoiceGroup({
  legend,
  name,
  options,
  error,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; description: string }[];
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="space-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-surface p-3 has-[:checked]:border-primary has-[:checked]:bg-sage/50">
            <input type="radio" name={name} value={o.value} className="mt-1 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-sm text-neg-text">{error}</p> : null}
    </fieldset>
  );
}
