import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/app/ui";
import { readAiConfig } from "@/server/ai/config";
import { gatewayHealth } from "@/server/ai/router";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "AI usage" };

interface Summary {
  days: number;
  totals: { requests: number; ok: number; failed: number; pending: number; rate_limited: number; fallbacks: number; avg_latency_ms: number; prompt_tokens: number; completion_tokens: number };
  by_provider_model: { provider: string; model: string; requests: number; ok: number; failed: number; avg_latency_ms: number; tokens: number }[];
  errors: { error_kind: string | null; n: number }[];
  last_success: string | null;
  last_failure: string | null;
}

const RANGES = [1, 7, 30] as const;
const ERROR_LABEL: Record<string, string> = {
  rate_limit: "Rate limited",
  auth: "Credential rejected",
  server: "Provider error",
  timeout: "Timed out",
  network: "Network failure",
  empty: "Empty answer",
  model_unavailable: "Model unavailable",
  bad_request: "Request refused",
  all_failed: "All providers failed",
  facts: "Could not load figures",
  internal: "Internal error",
};

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getContext();
  // The database function refuses anyone who is not a platform admin; this page then looks like it does not exist.
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) notFound();
  const days = RANGES.find((d) => String(d) === sp.days) ?? 7;
  const { data } = await supabase.rpc("ai_usage_summary", { p_days: days });
  const s = data as Summary | null;
  const config = readAiConfig();
  const health = gatewayHealth(config);
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: profile.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "Never");
  const failRate = s && s.totals.requests > 0 ? Math.round((s.totals.failed / s.totals.requests) * 100) : 0;

  return (
    <>
      <PageHeader title="AI usage" description="Aggregate figures only. No questions, answers, keys or individual people appear here." />
      <nav aria-label="Period" className="mb-6 flex gap-2">
        {RANGES.map((d) => (
          <Link key={d} href={`/app/admin/ai?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-full border px-4 py-1.5 text-sm ${d === days ? "border-primary bg-sage font-medium" : "border-line-strong hover:border-primary"}`}>
            {d === 1 ? "24 hours" : `${d} days`}
          </Link>
        ))}
      </nav>

      {!s ? (
        <p role="alert" className="rounded-md border border-neg/50 bg-neg/10 px-3 py-2.5 text-sm text-neg-text">
          The usage summary is not available. Migration 11 may not be applied yet.
        </p>
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="totals">
            <h2 id="totals" className="mb-4 font-semibold">
              Requests
            </h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total", s.totals.requests],
                ["Succeeded", s.totals.ok],
                ["Failed", `${s.totals.failed} (${failRate}%)`],
                ["Rate limited", s.totals.rate_limited],
                ["Fallbacks", s.totals.fallbacks],
                ["Average time", `${s.totals.avg_latency_ms} ms`],
                ["Prompt tokens", s.totals.prompt_tokens.toLocaleString("en-IN")],
                ["Answer tokens", s.totals.completion_tokens.toLocaleString("en-IN")],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl border border-line bg-surface p-4">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="num mt-1 text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted">
              Last success: {when(s.last_success)}. Last failure: {when(s.last_failure)}. Token counts are what each provider reports; some report none.
            </p>
          </section>

          <section aria-labelledby="models">
            <h2 id="models" className="mb-4 font-semibold">
              By provider and model
            </h2>
            {s.by_provider_model.length === 0 ? (
              <p className="text-sm text-muted">No requests in this period.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Requests by provider and model</caption>
                  <thead className="bg-sunken text-muted">
                    <tr>
                      {["Provider", "Model", "Requests", "OK", "Failed", "Avg ms", "Tokens"].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.by_provider_model.map((r) => (
                      <tr key={r.provider + r.model} className="num border-t border-line">
                        <td className="px-4 py-2.5 capitalize">{r.provider}</td>
                        <td className="px-4 py-2.5">{r.model || "–"}</td>
                        <td className="px-4 py-2.5">{r.requests}</td>
                        <td className="px-4 py-2.5">{r.ok}</td>
                        <td className="px-4 py-2.5">{r.failed}</td>
                        <td className="px-4 py-2.5">{r.avg_latency_ms}</td>
                        <td className="px-4 py-2.5">{r.tokens.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="errors">
            <h2 id="errors" className="mb-4 font-semibold">
              Failures by category
            </h2>
            {s.errors.length === 0 ? (
              <p className="text-sm text-muted">No failures in this period.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {s.errors.map((e) => (
                  <li key={e.error_kind ?? "unknown"} className="flex justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-2">
                    <span>{ERROR_LABEL[e.error_kind ?? ""] ?? e.error_kind ?? "Unclassified"}</span>
                    <span className="num font-medium">{e.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <section aria-labelledby="health" className="mt-10">
        <h2 id="health" className="mb-2 font-semibold">
          Provider health
        </h2>
        <p className="mb-4 text-sm text-muted">The assistant is {config.enabled ? "switched on" : "switched off"}. Counts below are for this server instance only; serverless instances do not share them. Keys are never shown.</p>
        {health.length === 0 ? (
          <p className="text-sm text-muted">No provider has a key configured.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {health.map((h) => (
              <li key={h.provider} className="rounded-xl border border-line bg-surface p-4">
                <p className="font-medium capitalize">{h.provider}</p>
                <p className="mt-1 text-muted">
                  Keys: {h.keysAvailable} of {h.keys} usable now. Models in order: {h.models.join(", ")}.
                  {h.modelsResting.length > 0 ? ` Resting: ${h.modelsResting.join(", ")}.` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
