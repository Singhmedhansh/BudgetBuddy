"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/** Frosted floating button that appears after the first screen and scrolls smoothly to the top. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > Math.max(600, window.innerHeight * 0.9));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
      className={`glass fixed bottom-5 right-5 z-30 grid h-11 w-11 place-items-center rounded-full text-fg shadow-float transition-all duration-300 hover:bg-surface md:bottom-7 md:right-7 ${show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}
    >
      <ArrowUp size={18} aria-hidden />
    </button>
  );
}
