import { toCsv } from "@/domain/csv";
import { requireSpace } from "@/server/context";

/** Downloadable report of the rows that could not be read. Editors only (RLS). */
export async function GET(_: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job: id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const ctx = await requireSpace();
  const { data: job } = await ctx.supabase.from("import_jobs").select("filename,problems").eq("id", id).maybeSingle();
  if (!job) return new Response("Not found", { status: 404 });
  const problems = (job.problems ?? []) as { line: number; reason: string }[];
  const body = toCsv([["Line", "Problem"], ...problems.map((p) => [{ raw: String(p.line) }, p.reason])]);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="import-errors.csv"',
      "Cache-Control": "no-store",
    },
  });
}
