"use server";

import { z } from "zod";
import { TOPICS } from "@/config/support";
import { createClient } from "@/lib/supabase/server";
import { checkUpload } from "@/lib/upload";

export interface ContactState {
  done?: boolean;
  reference?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}


const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  topic: z.enum(TOPICS.map((t) => t.value) as [string, ...string[]], { message: "Choose a topic." }),
  subject: z.string().trim().min(3, "Add a short subject.").max(150, "Use 150 characters or fewer."),
  message: z.string().trim().min(10, "Tell us a little more, at least 10 characters.").max(5000, "Use 5000 characters or fewer."),
});

export async function submitSupport(_: ContactState | undefined, form: FormData): Promise<ContactState> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;

  // Honeypot: real people never see or fill this field. Bots get a quiet success.
  if (String(form.get("website") ?? "").trim() !== "") return { done: true };

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Support is not available right now. Please try again later.", values };
  const { data: auth } = await supabase.auth.getUser();

  let attachmentPath: string | null = null;
  const file = form.get("attachment");
  if (file instanceof File && file.size > 0) {
    if (!auth.user) return { fieldErrors: { attachment: "Log in to attach a file, or send your message without one." }, values };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload({ name: file.name, size: file.size }, bytes);
    if (!check.ok) return { fieldErrors: { attachment: check.reason }, values };
    attachmentPath = `${auth.user.id}/${crypto.randomUUID()}/${check.filename}`;
    const { error: upErr } = await supabase.storage.from("budgetbuddy-support").upload(attachmentPath, bytes, { contentType: check.type, upsert: false });
    if (upErr) return { error: "The file could not be uploaded. Try again or send your message without it.", values };
  }

  const { data, error } = await supabase.rpc("submit_support_request", {
    p_email: parsed.data.email,
    p_topic: parsed.data.topic,
    p_subject: parsed.data.subject,
    p_message: parsed.data.message,
    p_attachment_path: attachmentPath,
  });
  if (error) {
    const msg = error.message.includes("rate_limited")
      ? "You have sent several messages recently. Please wait an hour before sending another."
      : error.message.includes("invalid_email")
        ? "Enter a valid email address."
        : "Your message was not sent. Check your connection and try again.";
    return { error: msg, values };
  }
  return { done: true, reference: data as string };
}
