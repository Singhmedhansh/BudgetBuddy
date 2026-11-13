"use client";

import { useEffect } from "react";
import { applyTheme, readStoredTheme, THEME_KEY, type ThemePreference } from "./theme";

/** Applies the theme saved on the person's profile, so a choice made on one device shows up on the next. */
export function ThemeSync({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    if (readStoredTheme() === theme) return;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: still apply for this visit */
    }
    applyTheme(theme);
    window.dispatchEvent(new Event("bb-theme-change"));
  }, [theme]);
  return null;
}
