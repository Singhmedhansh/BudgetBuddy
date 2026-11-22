"use client";

import {
  Check,
  History,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  deleteChatAction,
  pinChatAction,
  renameChatAction,
  type Turn,
} from "@/app/app/assistant-actions";
import { AssistantChat, type Snapshot } from "@/components/app/AssistantChat";
import {
  groupChats,
  titleFrom,
  type ChatSummary,
  type Quota,
} from "@/server/ai/chats";
import type { Starter } from "@/server/ai/suggestions";

interface Props {
  chats: ChatSummary[];
  activeId: string | null;
  initialTurns: Turn[];
  quota: Quota | null;
  timeZone: string;
  available: boolean;
  unavailableMessage: string;
  name: string | null;
  starters: Starter[];
  snapshot: Snapshot[];
  /** False until migration 14 is applied: chats then work as before but are not saved. */
  historyReady: boolean;
}

function Row({
  chat,
  active,
  onGone,
}: {
  chat: ChatSummary;
  active: boolean;
  onGone: () => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [title, setTitle] = useState(chat.title);
  const done = () => {
    setMode("idle");
    router.refresh();
  };

  if (mode === "delete")
    return (
      <li className="rounded-lg border border-neg/40 bg-neg/5 p-2.5 text-sm">
        <p className="mb-2">Delete this chat for good?</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              start(async () => {
                await deleteChatAction(chat.id);
                if (active) onGone();
                done();
              })
            }
            className="rounded-full bg-neg px-3 py-1 text-xs font-semibold text-white"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="rounded-full border border-line-strong px-3 py-1 text-xs font-medium"
          >
            Keep
          </button>
        </div>
      </li>
    );

  if (mode === "rename")
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              await renameChatAction(chat.id, title);
              done();
            });
          }}
          className="flex items-center gap-1 rounded-lg border border-primary bg-surface px-2 py-1"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            autoFocus
            aria-label="Chat name"
            className="min-w-0 flex-1 bg-transparent text-sm !outline-none"
          />
          <button
            type="submit"
            aria-label="Save name"
            className="grid h-6 w-6 place-items-center rounded text-primary hover:bg-sunken"
          >
            <Check size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => setMode("idle")}
            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken"
          >
            <X size={14} aria-hidden />
          </button>
        </form>
      </li>
    );

  const tool =
    "grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken hover:text-fg";
  return (
    <li className="group relative">
      <Link
        href={`/app/assistant?c=${chat.id}`}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 pr-[4.6rem] text-sm transition-colors ${active ? "bg-sage font-medium text-fg" : "text-muted hover:bg-sunken hover:text-fg"}`}
      >
        {chat.pinned ? (
          <Pin size={12} aria-hidden className="shrink-0 text-primary" />
        ) : (
          <MessageSquare
            size={12}
            aria-hidden
            className="shrink-0 opacity-60"
          />
        )}
        <span className="truncate">{chat.title}</span>
      </Link>
      <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
        <button
          type="button"
          aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
          title={chat.pinned ? "Unpin" : "Pin"}
          onClick={() =>
            start(async () => {
              await pinChatAction(chat.id, !chat.pinned);
              done();
            })
          }
          className={tool}
        >
          {chat.pinned ? (
            <PinOff size={13} aria-hidden />
          ) : (
            <Pin size={13} aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label="Rename chat"
          title="Rename"
          onClick={() => setMode("rename")}
          className={tool}
        >
          <Pencil size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Delete chat"
          title="Delete"
          onClick={() => setMode("delete")}
          className={tool}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </span>
    </li>
  );
}

export function FinnWorkspace(p: Props) {
  const router = useRouter();
  const [session, setSession] = useState(0);
  const [extra, setExtra] = useState<ChatSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(p.activeId);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const all = useMemo(() => {
    const byId = new Map(p.chats.map((c) => [c.id, c]));
    for (const e of extra)
      byId.set(e.id, {
        ...(byId.get(e.id) ?? e),
        updatedAt: e.updatedAt,
        title: byId.get(e.id)?.title ?? e.title,
      });
    return [...byId.values()];
  }, [p.chats, extra]);
  const shown = query.trim()
    ? all.filter((c) =>
        c.title.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : all;
  const groups = groupChats(shown, new Date(), p.timeZone);

  const newChat = () => {
    setCurrentId(null);
    setSession((s) => s + 1);
    setOpen(false);
    router.push("/app/assistant");
  };

  const rail = (
    <nav aria-label="Your chats with Finn" className="space-y-3">
      <button
        type="button"
        onClick={newChat}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:border-primary"
      >
        <Plus size={14} aria-hidden />
        New chat
      </button>
      {all.length > 4 ? (
        <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus-within:border-primary">
          <Search size={14} aria-hidden className="text-muted" />
          <span className="sr-only">Search your chats</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent !outline-none placeholder:text-muted/70"
          />
        </label>
      ) : null}
      {groups.length === 0 ? (
        <p className="px-1 text-sm leading-relaxed text-muted">
          {query
            ? "No chats match that."
            : p.historyReady
              ? "Your conversations with Finn are saved here, so you can come back to them."
              : "Saved chats switch on once the database update is applied."}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h3 className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {g.group}
            </h3>
            <ul className="space-y-0.5">
              {g.chats.map((c) => (
                <Row
                  key={c.id + c.title + c.pinned}
                  chat={c}
                  active={c.id === currentId}
                  onGone={newChat}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </nav>
  );

  return (
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-muted hover:border-line-strong hover:text-fg"
        >
          <History size={14} aria-hidden />
          History{all.length ? ` (${all.length})` : ""}
        </button>
        {open ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-3">
            {rail}
          </div>
        ) : null}
      </div>
      <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {rail}
      </aside>
      <div className="min-w-0 max-w-3xl">
        <AssistantChat
          key={`${p.activeId ?? "new"}-${session}`}
          available={p.available}
          unavailableMessage={p.unavailableMessage}
          name={p.name}
          starters={p.starters}
          snapshot={p.snapshot}
          initialTurns={p.initialTurns}
          initialChatId={p.activeId}
          quota={p.quota}
          onNew={newChat}
          onSaved={(id, firstQuestion) => {
            setCurrentId(id);
            setExtra((cur) => [
              ...cur.filter((c) => c.id !== id),
              {
                id,
                title: titleFrom(firstQuestion),
                pinned: false,
                updatedAt: new Date().toISOString(),
              },
            ]);
          }}
        />
      </div>
    </div>
  );
}
