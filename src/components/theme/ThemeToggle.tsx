"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, readStoredTheme, THEME_KEY, type ThemePreference } from "./theme";

const CHANGE_EVENT = "bb-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "system", label: "Match system theme", Icon: Monitor },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

/** `onChoose` lets the signed-in app save the choice to the profile so it follows the person to other devices. */
export function ThemeToggle({ onChoose }: { onChoose?: (theme: ThemePreference) => void | Promise<unknown> }) {
  // Light is the server snapshot (the default); the stored preference is read
  // on the client without a hydration mismatch.
  const pref = useSyncExternalStore<ThemePreference>(subscribe, readStoredTheme, () => "light");

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePreference) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Saving is best effort: the theme already applies here even if the save fails.
    void Promise.resolve(onChoose?.(next)).catch(() => undefined);
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={`grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${
            pref === value ? "bg-sage text-fg" : "text-muted hover:text-fg"
          }`}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
