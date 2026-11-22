import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_ALLOWANCE, type PlanId } from "@/config/plans";
import { localDate, monthRange, startOfLocalDay } from "@/domain/period";
import type { Visual } from "./visuals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}
export interface StoredTurn {
  role: "user" | "assistant";
  content: string;
  source?: "model" | "figures" | "general";
  visuals?: Visual[];
}

/** A chat's title from its first question: one line, trimmed to a sensible length. Pure, so it is tested. */
export function titleFrom(question: string): string {
  const t = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.]+$/, "");
  if (!t) return "New chat";
  return t.length <= 52 ? t : `${t.slice(0, 50).trimEnd()}…`;
}

export type ChatGroup =
  "Pinned" | "Today" | "Yesterday" | "Previous 7 days" | "Earlier";
const ORDER: ChatGroup[] = [
  "Pinned",
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Earlier",
];

/** Groups chats the way ChatGPT and Claude do: pinned first, then by how recently they were used. Pure. */
export function groupChats(
  chats: ChatSummary[],
  now: Date,
  timeZone: string,
): { group: ChatGroup; chats: ChatSummary[] }[] {
  const t = localDate(now, timeZone);
  const today = startOfLocalDay(t.year, t.month, t.day, timeZone).getTime();
  const buckets = new Map<ChatGroup, ChatSummary[]>();
  for (const c of [...chats].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    const at = new Date(c.updatedAt).getTime();
    const g: ChatGroup = c.pinned
      ? "Pinned"
      : at >= today
        ? "Today"
        : at >= today - 864e5
          ? "Yesterday"
          : at >= today - 7 * 864e5
            ? "Previous 7 days"
            : "Earlier";
    buckets.set(g, [...(buckets.get(g) ?? []), c]);
  }
  return ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    chats: buckets.get(g)!,
  }));
}

/** The start of the person's local day and month, which is what the allowances are counted from. Pure. */
export function periodStarts(
  now: Date,
  timeZone: string,
): { dayStart: Date; monthStart: Date } {
  const t = localDate(now, timeZone);
  return {
    dayStart: startOfLocalDay(t.year, t.month, t.day, timeZone),
    monthStart: monthRange(t.year, t.month, timeZone).from,
  };
}

export interface Quota {
  plan: PlanId;
  questionsPerDay: number;
  questionsToday: number;
  tokensPerMonth: number;
  tokensMonth: number;
}

/** What has been used today and this month. Null when the database has not been updated yet (then nothing is enforced). */
export async function loadQuota(
  db: Db,
  plan: PlanId,
  now: Date,
  timeZone: string,
): Promise<Quota | null> {
  const { dayStart, monthStart } = periodStarts(now, timeZone);
  const { data, error } = await db.rpc("ai_quota", {
    p_day_start: dayStart.toISOString(),
    p_month_start: monthStart.toISOString(),
  });
  if (error || !data) return null;
  const r = data as { questions_today: number; tokens_month: number };
  const a = AI_ALLOWANCE[plan];
  return {
    plan,
    questionsPerDay: a.questionsPerDay,
    questionsToday: Number(r.questions_today),
    tokensPerMonth: a.tokensPerMonth,
    tokensMonth: Number(r.tokens_month),
  };
}

export async function listChats(db: Db): Promise<ChatSummary[]> {
  const { data, error } = await db
    .from("finn_conversations")
    .select("id,title,pinned,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (
    data as { id: string; title: string; pinned: boolean; updated_at: string }[]
  ).map((c) => ({
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    updatedAt: c.updated_at,
  }));
}

export async function loadChat(
  db: Db,
  id: string,
): Promise<{ id: string; title: string; turns: StoredTurn[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: convo } = await db
    .from("finn_conversations")
    .select("id,title")
    .eq("id", id)
    .maybeSingle();
  if (!convo) return null;
  const { data: msgs } = await db
    .from("finn_messages")
    .select("role,content,source,visuals")
    .eq("conversation_id", id)
    .order("id", { ascending: true })
    .limit(200);
  return {
    id: convo.id as string,
    title: convo.title as string,
    turns: (
      (msgs ?? []) as {
        role: "user" | "assistant";
        content: string;
        source: StoredTurn["source"] | null;
        visuals: Visual[] | null;
      }[]
    ).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.source ? { source: m.source } : {}),
      ...(m.visuals?.length ? { visuals: m.visuals } : {}),
    })),
  };
}

/** Saves one question and its answer, creating the chat if needed. Best effort: a failure never blocks the answer. */
export async function saveExchange(
  db: Db,
  args: {
    userId: string;
    spaceId: string;
    chatId: string | null;
    question: string;
    answer: StoredTurn;
  },
): Promise<string | null> {
  try {
    let id = args.chatId;
    if (id) {
      const { data } = await db
        .from("finn_conversations")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (!data) id = null;
    }
    if (!id) {
      const { data, error } = await db
        .from("finn_conversations")
        .insert({
          user_id: args.userId,
          space_id: args.spaceId,
          title: titleFrom(args.question),
        })
        .select("id")
        .single();
      if (error || !data) return null;
      id = data.id as string;
    }
    const rows = [
      {
        conversation_id: id,
        user_id: args.userId,
        role: "user",
        content: args.question.slice(0, 8000),
      },
      {
        conversation_id: id,
        user_id: args.userId,
        role: "assistant",
        content: args.answer.content.slice(0, 8000),
        source: args.answer.source ?? null,
        visuals: args.answer.visuals?.length ? args.answer.visuals : null,
      },
    ];
    const { error } = await db.from("finn_messages").insert(rows);
    if (error) return null;
    await db
      .from("finn_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
    return id;
  } catch {
    return null;
  }
}
