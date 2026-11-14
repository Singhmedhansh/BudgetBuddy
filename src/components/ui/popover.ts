"use client";

import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Fixed-position placement for a popover anchored to a trigger. Callers portal it to <body>, so it is never clipped by a
 * scrolling table or card, it flips above the trigger when there is no room below, and it follows scroll and resize.
 */
export function useAnchoredPosition(open: boolean, anchor: RefObject<HTMLElement | null>, want: number, opts: { matchWidth?: boolean; minWidth?: number } = {}): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const { matchWidth = true, minWidth = 0 } = opts;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const down = below >= want || below >= above;
      const width = Math.max(matchWidth ? r.width : 0, minWidth);
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      setStyle(
        down
          ? { position: "fixed", top: r.bottom + 6, left, width, maxHeight: Math.max(160, Math.min(want, below)) }
          : { position: "fixed", bottom: window.innerHeight - r.top + 6, left, width, maxHeight: Math.max(160, Math.min(want, above)) },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, want, matchWidth, minWidth]);
  return open ? style : null;
}

/** Closes on a press outside the trigger and the popover. */
export function useDismiss(open: boolean, inside: Array<RefObject<HTMLElement | null>>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (inside.some((r) => r.current?.contains(t))) return;
      close();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
