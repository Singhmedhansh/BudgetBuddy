export type ThemePreference = "light" | "dark" | "system";
export const THEME_KEY = "bb-theme";

export function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "light";
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/**
 * Inline script run before first paint so the stored theme is applied without a
 * flash. Kept dependency-free and wrapped in try/catch: on any failure the page
 * simply stays on the light default.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_KEY}',v=localStorage.getItem(k),t='light';if(v==='dark')t='dark';else if(v==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';document.documentElement.dataset.theme=t;}catch(e){}})();`;
