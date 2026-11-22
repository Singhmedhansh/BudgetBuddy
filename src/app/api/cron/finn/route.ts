import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { referenceReviewStatus } from "@/config/reference-data";
import { createAdminClient } from "@/server/admin";
import { loadFacts } from "@/server/ai/facts";
import { buildRecap } from "@/server/ai/recap";
import { emailConfigured, sendEmail } from "@/server/email";
import { contextFor } from "@/server/impersonate";
import { reviewerEmails } from "@/server/ai/reviewers";

/**
 * Daily Finn maintenance, called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`:
 *   1. the weekly recap: everyone who turned it on and has not had one in the last six days gets the email, built from
 *      their own verified figures;
 *   2. on Mondays, the reviewers get a short note: how many thumbs-down answers are waiting, and, once a month, the list
 *      of reference figures (rates, tax slabs) to re-check against their sources.
 * Failures are counted, never thrown, and carry no personal data.
 */
export const maxDuration = 300;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const admin = createAdminClient();
  if (!secret || secret.length < 16 || !admin)
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (
    !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
  )
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://getfintrack.online";
  const out = {
    recap: { due: 0, sent: 0, skipped: 0, failed: 0, email: emailConfigured() },
    reviewers: { notified: 0 },
  };

  if (out.recap.email) {
    const cutoff = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const { data: due } = await admin
      .from("finn_prefs")
      .select("user_id")
      .eq("weekly_recap", true)
      .or(`recap_sent_at.is.null,recap_sent_at.lt.${cutoff}`)
      .limit(40);
    out.recap.due = due?.length ?? 0;
    const started = Date.now();
    for (const row of due ?? []) {
      // Stay inside the function's time: anyone left over is picked up by tomorrow's run.
      if (Date.now() - started > 240_000) break;
      try {
        const ctx = await contextFor(row.user_id as string);
        const email = ctx?.user.email;
        if (!ctx || !email) {
          out.recap.skipped++;
          continue;
        }
        const facts = await loadFacts(ctx);
        const name = ctx.profile.display_name?.trim().split(/\s+/)[0] ?? null;
        const recap = buildRecap(facts, { name, origin });
        if (!recap) {
          // Nothing to say yet: do not email an empty report, and look again next week.
          await admin
            .from("finn_prefs")
            .update({ recap_sent_at: new Date().toISOString() })
            .eq("user_id", row.user_id);
          out.recap.skipped++;
          continue;
        }
        const res = await sendEmail({ to: email, ...recap });
        if (res === "sent") {
          await admin
            .from("finn_prefs")
            .update({ recap_sent_at: new Date().toISOString() })
            .eq("user_id", row.user_id);
          out.recap.sent++;
        } else out.recap.failed++;
      } catch {
        out.recap.failed++;
      }
    }
  }

  // Mondays (UTC): a short note to the reviewers.
  const reviewers = reviewerEmails();
  if (reviewers.length && emailConfigured() && new Date().getUTCDay() === 1) {
    const { count } = await admin
      .from("finn_messages")
      .select("id", { count: "exact", head: true })
      .eq("feedback", "down")
      .is("reviewed_at", null);
    const ref = referenceReviewStatus();
    const lines = [
      `Finn weekly check`,
      "",
      `Thumbs-down answers waiting for review: ${count ?? 0}`,
      `Review them at ${origin}/app/finn-review`,
    ];
    if (ref.due) {
      lines.push(
        "",
        `The reference figures were last checked on ${ref.reviewedOn} (${ref.ageDays} days ago). Re-check each against its source, then update src/config/reference-data.ts:`,
        ...ref.items.map((i) => `- ${i.label} (${i.source}): ${i.value}`),
      );
    }
    const text = lines.join("\n");
    for (const to of reviewers) {
      const r = await sendEmail({
        to,
        subject: ref.due
          ? "Finn: review answers and refresh reference figures"
          : "Finn: answers waiting for review",
        text,
        html: `<pre style="font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      });
      if (r === "sent") out.reviewers.notified++;
    }
  }
  return NextResponse.json(out);
}
