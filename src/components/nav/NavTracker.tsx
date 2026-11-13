"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export const NAV_COUNT_KEY = "bb-nav-count";

/** Counts in-app route changes this tab has made, so a back button knows whether there is an in-app page behind it. */
export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    try {
      const prev = sessionStorage.getItem("bb-nav-last");
      if (prev !== null && prev !== path) sessionStorage.setItem(NAV_COUNT_KEY, String(Number(sessionStorage.getItem(NAV_COUNT_KEY) ?? 0) + 1));
      sessionStorage.setItem("bb-nav-last", path);
    } catch {
      /* storage unavailable: the back button falls back to its link */
    }
  }, [path]);
  return null;
}
