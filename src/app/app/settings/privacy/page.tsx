import type { Metadata } from "next";
import Link from "next/link";
import { LoadSampleButton, RemoveSampleForm } from "@/components/app/sample-data-forms";
import { DeleteAccountForm } from "@/components/app/settings-forms";
import { hasPassword } from "@/server/account";
import { getContext } from "@/server/context";
import { isSampleSpace } from "@/server/sample-data";

export const metadata: Metadata = { title: "Data and privacy" };

export default async function PrivacyPage() {
  const { supabase, user, spaces } = await getContext();
  const { data: mine } = await supabase.from("financial_space_members").select("space_id,role").eq("user_id", user.id);
  const role = new Map((mine ?? []).map((m) => [m.space_id as string, m.role as string]));
  const owned = spaces.filter((s) => role.get(s.id) === "owner");
  const joined = spaces.filter((s) => role.get(s.id) !== "owner" && role.has(s.id));
  const { data: blockers, error: blockErr } = await supabase.rpc("deletion_blockers");
  const blocking = (blockers ?? []) as { space_id: string; space_name: string; other_members: number }[];
  const counts = await Promise.all(
    owned.map(async (s) => {
      const { count } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", s.id);
      return [s.id, count ?? 0] as const;
    }),
  );
  const txns = new Map(counts);
  const blockedIds = new Set(blocking.map((b) => b.space_id));
  const willDelete = owned.filter((s) => !blockedIds.has(s.id));
  const sample = spaces.find((s) => isSampleSpace(s));

  return (
    <>
      <section aria-labelledby="sample">
        <h2 id="sample" className="mb-2 font-semibold">
          Sample data
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted">A fictional household with three months of transactions, budgets and bills, so you can explore every screen. It is clearly labelled, belongs only to you, and can be removed at any time.</p>
        {sample ? <RemoveSampleForm spaceId={sample.id} /> : <LoadSampleButton />}
      </section>

      <section aria-labelledby="export">
        <h2 id="export" className="mb-2 font-semibold">
          Download your data
        </h2>
        <p className="text-sm leading-relaxed text-muted">Everything you have recorded, any time, on any plan. These files contain only data you can already see.</p>
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a href="/app/export/all" className="font-medium text-primary hover:underline">
            Download all data (JSON)
          </a>
          <a href="/app/export/transactions" className="font-medium text-primary hover:underline">
            Download transactions (CSV)
          </a>
        </p>
      </section>

      <section aria-labelledby="handling">
        <h2 id="handling" className="mb-3 font-semibold">
          How your data is handled
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Your records are stored in a database with access rules that let only the members of a space read it. Those rules are enforced by the database itself, not only by the screens.</li>
          <li>Card numbers and bank logins are never collected. Accounts and balances are only what you enter or import.</li>
          <li>Files you upload (receipts, statements, your photo) are kept in private storage and are not publicly linkable.</li>
          <li>Your profile photo and phone number are optional and are never shared with other members. Members see your display name only.</li>
          <li>Your ledger is append-only while your account is active: a mistake is corrected by a reversal, so your history stays accurate.</li>
          <li>
            Read the full{" "}
            <Link href="/legal/privacy" className="text-primary hover:underline">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/security" className="text-primary hover:underline">
              how we protect your data
            </Link>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="delete" className="rounded-xl border border-neg/40 p-5">
        <h2 id="delete" className="font-semibold text-neg-text">
          Delete my account data
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">This cannot be undone. Download your data first if you want a copy.</p>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <h3 className="font-medium">Will be permanently deleted</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
              <li>Your profile, photo, phone number and preferences</li>
              {willDelete.map((s) => (
                <li key={s.id}>
                  The space <strong className="font-medium text-fg">{s.name}</strong> with all its accounts, {txns.get(s.id) ?? 0} transaction{txns.get(s.id) === 1 ? "" : "s"}, budgets, goals, bills and imported files
                </li>
              ))}
              <li>Your support messages and help feedback, and your AI usage history</li>
            </ul>
          </div>
          {joined.length > 0 ? (
            <div>
              <h3 className="font-medium">You will be removed from, and these will stay for their other members</h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
                {joined.map((s) => (
                  <li key={s.id}>
                    {s.name}. Records you added stay, because they are part of that space&apos;s ledger.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className="font-medium">What happens to your sign-in</h3>
            <p className="mt-1.5 text-muted">
              Your data is removed and you are signed out. Your sign-in identity belongs to the shared account system, which other products may also use, so it is removed only if this project is set up to do that. If it is not, contact support and we will remove it.
            </p>
          </div>
        </div>

        {blocking.length > 0 ? (
          <div role="alert" className="mt-5 rounded-md border border-warn/50 bg-warn/10 p-4 text-sm">
            <p className="font-medium">You need to hand over {blocking.length === 1 ? "a space" : "some spaces"} first</p>
            <p className="mt-1 text-muted">Other people use these spaces and you are the owner. Transfer ownership, or remove them, so they do not lose their records.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {blocking.map((b) => (
                <li key={b.space_id}>
                  {b.space_name} ({b.other_members} other member{b.other_members === 1 ? "" : "s"})
                </li>
              ))}
            </ul>
            <Link href="/app/members" className="mt-3 inline-block font-medium text-primary hover:underline">
              Open members
            </Link>
          </div>
        ) : null}
        {blockErr ? <p className="mt-5 text-sm text-muted">Account deletion is not available on this server yet.</p> : null}

        <div className="mt-6">
          <DeleteAccountForm needsPassword={hasPassword(user)} blocked={blocking.length > 0 || Boolean(blockErr)} />
        </div>
      </section>
    </>
  );
}
