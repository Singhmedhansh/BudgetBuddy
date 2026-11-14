import type { Metadata } from "next";
import { Select } from "@/components/ui/Select";
import { headers } from "next/headers";
import Link from "next/link";
import { removeMemberAction, revokeInviteAction, setMemberRoleAction, transferOwnershipAction } from "@/app/app/space-actions";
import { InviteForm } from "@/components/app/space-ui";
import { EmptyState, formatDate, Notice, PageHeader } from "@/components/app/ui";
import { atLeast, requireSpace } from "@/server/context";
import type { SpaceRole } from "@/server/types";

export const metadata: Metadata = { title: "Members" };

const ROLE_TEXT: Record<SpaceRole, string> = {
  owner: "Owner: full control of the space",
  admin: "Admin: manages members and everything below",
  editor: "Editor: adds and corrects transactions, accounts and budgets",
  viewer: "Viewer: can see everything, change nothing",
};

interface Member {
  user_id: string;
  display_name: string | null;
  role: SpaceRole;
  joined_at: string;
  is_you: boolean;
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const isAdmin = atLeast(ctx.role, "admin");
  const isOwner = ctx.role === "owner";
  const { data, error } = await ctx.supabase.rpc("list_members", { p_space: ctx.space.id });
  const members = (data ?? []) as Member[];
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const { data: invites } = isAdmin ? await ctx.supabase.from("space_invites").select("id,role,expires_at,created_at").eq("space_id", ctx.space.id).is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }) : { data: [] };

  return (
    <>
      <PageHeader title="Members" description={`${ctx.space.name}. You are ${ctx.role === "admin" ? "an" : "a"} ${ctx.role}. Each person sees this space's accounts, budgets and history according to their role.`} />
      {sp.created ? <Notice kind="success">Space created. Invite the people you share it with below.</Notice> : null}
      {sp.updated ? <Notice kind="success">Role updated.</Notice> : null}
      {sp.removed ? <Notice kind="success">Member removed. Their access ended immediately.</Notice> : null}
      {sp.revoked ? <Notice kind="success">Invitation revoked.</Notice> : null}
      {sp.transferred ? <Notice kind="success">Ownership transferred. You are now an admin of this space.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That request was not valid." : sp.error}</Notice> : null}

      {error ? (
        <EmptyState title="Members are not available yet" body="Sharing needs a database update that has not been applied to this server. Nothing is wrong with your data." />
      ) : (
        <div className="space-y-12">
          <section aria-label="People with access">
            <h2 className="mb-3 font-semibold">People with access</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {members.map((m) => {
                const canManage = isAdmin && !m.is_you && m.role !== "owner" && (isOwner || m.role !== "admin");
                const name = m.display_name || "Member";
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {name}
                        {m.is_you ? <span className="ml-2 rounded-full bg-sage px-2 py-0.5 text-[11px] font-normal">You</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        <span className="capitalize">{m.role}</span> · joined {formatDate(m.joined_at, ctx.profile.timezone)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {canManage ? (
                        <form action={setMemberRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="user" value={m.user_id} />
                          <label htmlFor={`role-${m.user_id}`} className="sr-only">
                            Role for {name}
                          </label>
                          <Select id={`role-${m.user_id}`} name="role" label={`Role for ${name}`} size="sm" className="min-w-28" defaultValue={m.role} options={[{ value: "viewer", label: "Viewer" }, { value: "editor", label: "Editor" }, ...(isOwner ? [{ value: "admin", label: "Admin" }] : [])]} />
                          <button type="submit" className="rounded-md border border-line-strong px-3 py-1.5 hover:border-primary" aria-label={`Save role for ${name}`}>
                            Save
                          </button>
                        </form>
                      ) : null}
                      {isOwner && !m.is_you ? (
                        <details className="group">
                          <summary className="cursor-pointer list-none text-primary underline hover:no-underline">Make owner</summary>
                          <form action={transferOwnershipAction} className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-sunken p-2">
                            <input type="hidden" name="user" value={m.user_id} />
                            <label htmlFor={`own-${m.user_id}`} className="sr-only">
                              Type TRANSFER to hand ownership to {name}
                            </label>
                            <input id={`own-${m.user_id}`} name="confirm" autoComplete="off" placeholder="Type TRANSFER" className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs" />
                            <button type="submit" className="rounded-md border border-line-strong px-3 py-1.5 hover:border-primary">
                              Hand over
                            </button>
                          </form>
                        </details>
                      ) : null}
                      {canManage || (m.is_you && m.role !== "owner") ? (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="user" value={m.user_id} />
                          <button type="submit" className="text-neg-text underline hover:no-underline" aria-label={m.is_you ? "Leave this space" : `Remove ${name}`}>
                            {m.is_you ? "Leave space" : "Remove"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-4 grid gap-1.5 text-xs text-muted">
              {(Object.keys(ROLE_TEXT) as SpaceRole[]).map((r) => (
                <div key={r}>
                  <dt className="inline font-medium capitalize text-fg">{r}</dt> <dd className="inline">{ROLE_TEXT[r].split(": ")[1]}</dd>
                </div>
              ))}
            </dl>
          </section>

          {isAdmin ? (
            <section aria-label="Invitations">
              <h2 className="mb-3 font-semibold">Invite someone</h2>
              <InviteForm canInviteAdmin={isOwner} origin={origin} />
              {(invites ?? []).length ? (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-medium">Open invitations</h3>
                  <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
                    {(invites ?? []).map((i) => (
                      <li key={i.id as string} className="flex items-center justify-between gap-3 px-4 py-3">
                        <span>
                          <span className="capitalize">{i.role as string}</span> · expires {formatDate(i.expires_at as string, ctx.profile.timezone)}
                        </span>
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="id" value={i.id as string} />
                          <button type="submit" className="text-xs text-neg-text underline hover:no-underline">
                            Revoke
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-muted">Only admins can invite people or change roles.</p>
          )}

          <p className="text-sm text-muted">
            Have an invitation code?{" "}
            <Link href="/app/join" className="text-primary hover:underline">
              Join a space
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
