"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NAV_COUNT_KEY } from "./NavTracker";

/**
 * Goes back through real browser history when this tab has navigated within the
 * app; otherwise it is a plain link to a sensible parent. Rendered only on
 * pages that are reached from somewhere else.
 */
export function BackButton({ fallbackHref, label = "Back" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      onClick={(e) => {
        let count = 0;
        try {
          count = Number(sessionStorage.getItem(NAV_COUNT_KEY) ?? 0);
        } catch {}
        if (count > 0 && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="mb-5 inline-flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-muted transition-colors hover:text-fg"
    >
      <ArrowLeft size={15} aria-hidden />
      {label}
    </Link>
  );
}
