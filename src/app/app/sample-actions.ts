"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_SPACE_COOKIE, getContext } from "@/server/context";
import { seedSampleSpace } from "@/server/sample-seed";

export interface SampleState {
  error?: string;
}

/** Creates the fictional sample space (once) and switches to it. Everything is created with the person's own session. */
export async function loadSampleDataAction(): Promise<SampleState> {
  const ctx = await getContext();
  const res = await seedSampleSpace(ctx);
  if (res.spaceId) (await cookies()).set(ACTIVE_SPACE_COOKIE, res.spaceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  if (res.error) return { error: res.error };
  redirect("/app?sample=1");
}

/** Removes a sample space. The database refuses anything that is not flagged as sample or not solely owned by the caller. */
export async function removeSampleDataAction(_: SampleState | undefined, form: FormData): Promise<SampleState> {
  const { supabase } = await getContext();
  const id = z.string().uuid().safeParse(form.get("spaceId"));
  if (!id.success) return { error: "That sample space could not be found." };
  const { error } = await supabase.rpc("delete_sample_space", { p_space: id.data });
  if (error) return { error: /only sample/i.test(error.message) ? "Only sample data can be removed here." : /does not exist|schema cache/i.test(error.message) ? "Removing sample data is not available on this server yet." : "The sample data could not be removed. Try again." };
  (await cookies()).delete(ACTIVE_SPACE_COOKIE);
  revalidatePath("/app", "layout");
  redirect("/app");
}
