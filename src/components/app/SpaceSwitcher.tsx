import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";
import Link from "next/link";
import { switchSpaceAction } from "@/app/app/space-actions";
import type { Space } from "@/server/types";

/** Lists the spaces a person belongs to; choosing one makes it the active space. Dark variant sits on the ink sidebar. */
export function SpaceSwitcher({ spaces, activeId, role, dark }: { spaces: Space[]; activeId: string | null; role: string | null; dark?: boolean }) {
  const active = spaces.find((s) => s.id === activeId);
  const panel = dark ? "glass text-fg" : "glass";
  return (
    <details className="group relative">
      <summary
        aria-label="Switch space"
        className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2.5 ring-1 transition-colors ${dark ? "bg-white/5 ring-white/10 hover:bg-white/10" : "bg-surface ring-line-strong"}`}
      >
        <span className="min-w-0 text-left">
          <span className={`block text-[11px] ${dark ? "text-white/50" : "text-muted"}`}>Space{role ? ` · ${role}` : ""}</span>
          <span className="block truncate text-sm font-medium">{active?.name ?? "Set up your finances"}</span>
        </span>
        <ChevronsUpDown size={15} aria-hidden className={dark ? "text-white/50" : "text-muted"} />
      </summary>
      <div className={`anim-pop absolute left-0 right-0 top-full z-40 mt-2 rounded-xl p-1.5 shadow-float ${panel}`}>
        {/* Only the list scrolls, so a long list never pushes the links below it out of reach. */}
        <ul className="max-h-[min(50vh,18rem)] overflow-y-auto overscroll-contain" tabIndex={-1}>
          {spaces.map((s) => (
            <li key={s.id}>
              <form action={switchSpaceAction}>
                <input type="hidden" name="space" value={s.id} />
                <button type="submit" className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-sage" aria-current={s.id === activeId ? "true" : undefined}>
                  <span className="min-w-0 truncate">{s.name}</span>
                  {s.id === activeId ? <Check size={14} aria-hidden className="shrink-0 text-primary" /> : null}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/app/members" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-sage">
            <Users size={14} aria-hidden /> Members
          </Link>
          <Link href="/app/spaces/new" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-sage">
            <Plus size={14} aria-hidden /> New shared space
          </Link>
        </div>
      </div>
    </details>
  );
}
