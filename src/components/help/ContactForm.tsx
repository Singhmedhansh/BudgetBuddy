"use client";

import { useActionState } from "react";
import { submitSupport, type ContactState } from "@/app/contact/actions";
import { SelectField } from "@/components/app/controls";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { TOPICS } from "@/config/support";

export function ContactForm({ defaults, signedIn }: { defaults: { email: string; topic: string; subject: string }; signedIn: boolean }) {
  const [s, action] = useActionState<ContactState | undefined, FormData>(submitSupport, undefined);
  const fe = s?.fieldErrors ?? {};
  const v = s?.values ?? {};

  if (s?.done) {
    return (
      <div role="status" className="rounded-md border border-pos/50 bg-pos/10 p-5">
        <h2 className="font-semibold text-pos-text">Message sent</h2>
        {s.reference ? (
          <p className="mt-2 text-sm">
            Your reference is <strong className="num">{s.reference}</strong>. Quote it if you write to us again about this.
          </p>
        ) : (
          <p className="mt-2 text-sm">Thanks. We will read your message.</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5" noValidate encType="multipart/form-data">
      <FormMessage error={s?.error} />
      <Field label="Your email" name="email" type="email" autoComplete="email" defaultValue={v.email ?? defaults.email} error={fe.email} hint="Where we reply. We do not share it." />
      <SelectField label="Topic" name="topic" defaultValue={v.topic ?? defaults.topic} placeholder="Choose a topic" options={TOPICS.map((t) => ({ value: t.value, label: t.label }))} error={fe.topic} />
      <Field label="Subject" name="subject" defaultValue={v.subject ?? defaults.subject} error={fe.subject} />
      <div>
        <label htmlFor="contact-message" className="mb-1.5 block text-sm font-medium">
          What happened, and what did you expect?
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          defaultValue={v.message}
          aria-invalid={fe.message ? true : undefined}
          aria-describedby="contact-message-help"
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm aria-[invalid=true]:border-neg"
        />
        <p id="contact-message-help" className={`mt-1.5 text-sm ${fe.message ? "text-neg-text" : "text-xs text-muted"}`}>
          {fe.message ?? "Please do not include your password or full card number."}
        </p>
      </div>
      <div>
        <label htmlFor="contact-file" className="mb-1.5 block text-sm font-medium">
          Attachment (optional)
        </label>
        <input id="contact-file" name="attachment" type="file" accept=".png,.jpg,.jpeg,.pdf,.txt" disabled={!signedIn} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm disabled:opacity-60" />
        <p className={`mt-1.5 text-sm ${fe.attachment ? "text-neg-text" : "text-xs text-muted"}`}>
          {fe.attachment ?? (signedIn ? "PNG, JPG, PDF or text, up to 5 MB." : "Log in to attach a screenshot or file.")}
        </p>
      </div>
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Leave this empty</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <SubmitButton pendingLabel="Sending">Send message</SubmitButton>
    </form>
  );
}
