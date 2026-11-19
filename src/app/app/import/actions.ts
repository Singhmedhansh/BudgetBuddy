"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseCsv, CsvError } from "@/domain/csv";
import { startOfLocalDay } from "@/domain/period";
import { detectMapping, fingerprints, parseStatementRows, type DateOrder, type ParsedRow, type RowProblem } from "@/domain/statement";
import { pdfText } from "@/server/pdf-text";
import { AI_STATEMENT_MESSAGES, categoriseWithAi, readStatementWithAi, type CategoryChoice } from "@/server/ai/statement";
import { usageStoreFor } from "@/server/ai/usage-store";
import { aiStatus } from "@/server/ai/config";
import { requireSpace } from "@/server/context";
import { friendlyDbError } from "@/server/ledger-write";
import { sniffType } from "@/lib/upload";

export interface ImportState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export interface JobRow {
  line: number;
  occurred_at: string;
  date: string;
  description: string;
  amount: number;
  fingerprint: string;
  category_id: string;
  include: boolean;
  flag: "new" | "already_imported" | "possible_duplicate";
  suggested: boolean;
  /** True when the AI, not the person's history, suggested the category. Shown on the review screen. */
  ai?: boolean;
}

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 5000;

async function ensureCategory(ctx: Awaited<ReturnType<typeof requireSpace>>, name: string, kind: "expense" | "income"): Promise<string> {
  const { data } = await ctx.supabase.from("categories").select("id").eq("space_id", ctx.space.id).eq("kind", kind).eq("name", name).maybeSingle();
  if (data) return data.id as string;
  const { data: made, error } = await ctx.supabase.from("categories").insert({ space_id: ctx.space.id, name, kind }).select("id").single();
  if (error || !made) throw new Error("Could not prepare categories for the import.");
  return made.id as string;
}

export async function uploadStatementAction(_: ImportState | undefined, form: FormData): Promise<ImportState> {
  const ctx = await requireSpace();
  const parsed = z
    .object({ accountId: z.string().uuid("Choose the account this statement is for."), dateOrder: z.enum(["dmy", "mdy"]), positiveIs: z.enum(["in", "out"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: { accountId: parsed.error.issues[0].message } };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Choose a CSV or PDF statement." } };
  if (file.size > MAX_BYTES) return { fieldErrors: { file: "The file is larger than 4 MB. Split it by date and import in parts." } };
  const isPdf = /\.pdf$/i.test(file.name);
  if (!isPdf && !/\.csv$/i.test(file.name)) return { fieldErrors: { file: "Only .csv and .pdf statements are supported. In Excel, use Save as, CSV." } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffType(bytes);
  const useAi = form.get("useAi") === "on";
  const aiDeps = { usage: usageStoreFor(ctx.supabase) };

  let rows: ParsedRow[];
  let problems: RowProblem[];
  if (isPdf) {
    if (kind !== "application/pdf") return { fieldErrors: { file: "That does not look like a PDF file." } };
    if (!aiStatus().available) return { fieldErrors: { file: AI_STATEMENT_MESSAGES.disabled } };
    if (!useAi) return { fieldErrors: { useAi: "Tick the box to let the AI reader process this PDF." } };
    const pdf = await pdfText(bytes);
    if (!pdf.ok) {
      const msg = pdf.reason === "encrypted" ? "That PDF is password protected. Remove the password and upload it again." : pdf.reason === "no_text" ? AI_STATEMENT_MESSAGES.unreadable : "That PDF could not be read, or it has more than 30 pages. Split it by month.";
      return { fieldErrors: { file: msg } };
    }
    const read = await readStatementWithAi(pdf.text, aiDeps, { currency: ctx.space.currency, dateOrder: parsed.data.dateOrder as DateOrder });
    if (!read.ok) return { fieldErrors: { file: AI_STATEMENT_MESSAGES[read.reason] } };
    rows = read.rows;
    problems = read.problems;
  } else {
    if (kind !== "text/plain") return { fieldErrors: { file: "That does not look like a text CSV file." } };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { fieldErrors: { file: "The file is not UTF-8 text. Re-save it as CSV UTF-8." } };
    }
    let table: string[][];
    try {
      table = parseCsv(text);
    } catch (e) {
      return { fieldErrors: { file: e instanceof CsvError ? e.message : "The file could not be read." } };
    }
    const detected = detectMapping(table);
    if (!detected) return { fieldErrors: { file: "We could not find the columns. The file needs a header row with Date, Description and Amount (or Debit and Credit)." } };
    ({ rows, problems } = parseStatementRows(table, detected.headerRow, { ...detected.mapping, positiveIs: parsed.data.positiveIs }, { currency: ctx.space.currency, dateOrder: parsed.data.dateOrder as DateOrder }));
  }
  if (rows.length > MAX_ROWS) return { fieldErrors: { file: `The file has more than ${MAX_ROWS} usable rows. Split it and import in parts.` } };
  if (rows.length === 0) return { fieldErrors: { file: problems.length ? "No row could be read. See the date and amount formats in Help." : "The file has no transactions." } };

  const fps = fingerprints(parsed.data.accountId, rows);
  const [already, history, expenseCat, incomeCat] = await Promise.all([
    ctx.supabase.from("transactions").select("external_id").eq("space_id", ctx.space.id).eq("source", "import").in("external_id", fps),
    ctx.supabase.from("transactions").select("merchant, occurred_at, amount, ledger_entries(account_id, category_id, amount)").eq("space_id", ctx.space.id).order("occurred_at", { ascending: false }).limit(2000),
    ensureCategory(ctx, "Uncategorised", "expense"),
    ensureCategory(ctx, "Other income", "income"),
  ]);
  const alreadySet = new Set((already.data ?? []).map((r) => r.external_id as string));

  // Suggest a category from how the same merchant was categorised before.
  const byMerchant = new Map<string, Map<string, number>>();
  const existing: { account: string; amount: number; date: string }[] = [];
  const tz = ctx.profile.timezone;
  for (const t of history.data ?? []) {
    const entries = (t.ledger_entries ?? []) as { account_id: string | null; category_id: string | null; amount: number }[];
    const cat = entries.find((e) => e.category_id)?.category_id;
    const m = (t.merchant as string | null)?.toLowerCase();
    if (m && cat) {
      const counts = byMerchant.get(m) ?? new Map<string, number>();
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
      byMerchant.set(m, counts);
    }
    const acct = entries.find((e) => e.account_id === parsed.data.accountId);
    if (acct) existing.push({ account: acct.account_id!, amount: Number(acct.amount), date: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t.occurred_at as string)) });
  }

  // Descriptions the person's history does not cover are offered to the AI, which can only choose among their own categories.
  const history_best = (desc: string) => {
    const counts = byMerchant.get(desc.slice(0, 120).toLowerCase());
    return counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
  };
  let aiPicks = new Map<string, string>();
  if (useAi && aiStatus().available) {
    const { data: cats } = await ctx.supabase.from("categories").select("id,name,kind").eq("space_id", ctx.space.id).order("name");
    const choices = ((cats ?? []) as CategoryChoice[]).filter((c) => c.name !== "Uncategorised" && c.name !== "Other income");
    const unmatched = rows.filter((r) => !history_best(r.description)).map((r) => ({ description: r.description, direction: (r.amount > 0 ? "in" : "out") as "in" | "out" }));
    aiPicks = await categoriseWithAi(unmatched, choices, aiDeps);
  }

  const jobRows: JobRow[] = rows.map((r, i) => {
    const [y, m, d] = r.date.split("-").map(Number);
    const occurred = new Date(startOfLocalDay(y, m, d, tz).getTime() + 12 * 3600 * 1000);
    const fromHistory = history_best(r.description);
    const fromAi = fromHistory ? undefined : aiPicks.get(`${r.amount > 0 ? "in" : "out"}|${r.description}`);
    const best = fromHistory ?? fromAi ?? null;
    const fallback = r.amount > 0 ? incomeCat : expenseCat;
    const isDup = !alreadySet.has(fps[i]) && existing.some((e) => e.date === r.date && e.amount === r.amount);
    const flag: JobRow["flag"] = alreadySet.has(fps[i]) ? "already_imported" : isDup ? "possible_duplicate" : "new";
    return {
      line: r.line,
      occurred_at: occurred.toISOString(),
      date: r.date,
      description: r.description,
      amount: r.amount,
      fingerprint: fps[i],
      category_id: best ?? fallback,
      include: flag === "new",
      flag,
      suggested: Boolean(best),
      ...(fromAi ? { ai: true } : {}),
    };
  });

  const { data: job, error } = await ctx.supabase
    .from("import_jobs")
    .insert({ space_id: ctx.space.id, account_id: parsed.data.accountId, filename: file.name.slice(0, 200), rows: jobRows, problems, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !job) return { error: friendlyDbError(error?.message ?? "") };
  redirect(`/app/import/${job.id}`);
}

export async function commitImportAction(form: FormData) {
  const ctx = await requireSpace();
  const id = z.string().uuid().safeParse(form.get("job"));
  if (!id.success) redirect("/app/import");
  const { data: job } = await ctx.supabase.from("import_jobs").select("id, rows, status").eq("id", id.data).single();
  if (!job || job.status !== "preview") redirect(`/app/import/${id.data}`);

  // Apply the user's choices from the review screen, validating each one.
  const uuid = z.string().uuid();
  const rows = (job.rows as JobRow[]).map((r, i) => {
    const cat = form.get(`cat_${i}`);
    const category = typeof cat === "string" && uuid.safeParse(cat).success ? cat : r.category_id;
    return { ...r, category_id: category, include: form.get(`include_${i}`) === "on" };
  });
  const { error: upErr } = await ctx.supabase.from("import_jobs").update({ rows }).eq("id", id.data);
  if (upErr) redirect(`/app/import/${id.data}?error=${encodeURIComponent(friendlyDbError(upErr.message))}`);
  const { error } = await ctx.supabase.rpc("commit_import", { p_job: id.data });
  revalidatePath("/app", "layout");
  redirect(`/app/import/${id.data}${error ? `?error=${encodeURIComponent(friendlyDbError(error.message))}` : ""}`);
}
