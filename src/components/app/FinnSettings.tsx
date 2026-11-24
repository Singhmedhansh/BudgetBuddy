"use client";

import { Mail, MessageCircle, Zap } from "lucide-react";
import { useState, useTransition } from "react";
import {
  setAutoSaveLogsAction,
  setWeeklyRecapAction,
  startWhatsAppLinkAction,
  unlinkWhatsAppAction,
} from "@/app/app/finn-settings-actions";
import { BRAND } from "@/config/brand";
import type { FinnSettings as Settings } from "@/server/ai/finn-settings";

/** Weekly recap and WhatsApp, under the chat list. Each section says plainly when it cannot be used yet. */
export function FinnSettings({ settings }: { settings: Settings }) {
  const [recap, setRecap] = useState(settings.weeklyRecap);
  const [autoSave, setAutoSave] = useState(settings.autoSaveLogs);
  const [msg, setMsg] = useState("");
  const [phone, setPhone] = useState(settings.whatsapp.phone ?? "");
  const [code, setCode] = useState<string | null>(null);
  const [linked, setLinked] = useState(settings.whatsapp.verified);
  const [busy, start] = useTransition();
  const wa = settings.whatsapp;

  if (!settings.ready)
    return (
      <p className="mt-6 rounded-xl border border-line bg-sunken px-3 py-2.5 text-xs leading-relaxed text-muted">
        The weekly recap and WhatsApp switch on once the latest database update
        is applied.
      </p>
    );

  return (
    <section
      aria-label={`${BRAND.assistantName} settings`}
      className="mt-6 space-y-4 border-t border-line pt-4 text-sm"
    >
      <div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={recap}
            disabled={busy}
            onChange={(e) => {
              const on = e.target.checked;
              setRecap(on);
              setMsg("");
              start(async () => {
                const r = await setWeeklyRecapAction(on);
                if (!r.ok) {
                  setRecap(!on);
                  setMsg(r.message ?? "That could not be saved.");
                }
              });
            }}
            className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Mail size={13} aria-hidden /> Weekly recap by email
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              Where the month stands, what {BRAND.assistantName} noticed and
              what is coming up. Sent about once a week.
              {!settings.emailOn
                ? " Email sending is not switched on yet, so nothing will arrive until it is."
                : ""}
            </span>
          </span>
        </label>
        {msg ? (
          <p role="alert" className="mt-1 text-xs text-neg-text">
            {msg}
          </p>
        ) : null}
      </div>

      {settings.autoSaveReady ? (
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={autoSave}
            disabled={busy}
            onChange={(e) => {
              const on = e.target.checked;
              setAutoSave(on);
              setMsg("");
              start(async () => {
                const r = await setAutoSaveLogsAction(on);
                if (!r.ok) {
                  setAutoSave(!on);
                  setMsg(r.message ?? "That could not be saved.");
                }
              });
            }}
            className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Zap size={13} aria-hidden /> Save quick records without asking
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              When you tell {BRAND.assistantName} something like &ldquo;400 on
              food&rdquo;, it is saved straight away, with an Undo. Off: you
              confirm each one first.
            </span>
          </span>
        </label>
      ) : null}

      <div>
        <p className="flex items-center gap-1.5 font-medium">
          <MessageCircle size={13} aria-hidden /> Ask on WhatsApp
        </p>
        {!wa.number ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            WhatsApp is not switched on yet.
          </p>
        ) : linked ? (
          <div className="mt-1 text-xs leading-relaxed text-muted">
            <p>
              Linked to <span className="num text-fg">{wa.phone ?? phone}</span>
              . Message {BRAND.assistantName} on +{wa.number}: ask a question,
              or say “add 450 for groceries” and reply YES to save it.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  await unlinkWhatsAppAction();
                  setLinked(false);
                  setCode(null);
                })
              }
              className="mt-1.5 font-medium text-primary underline-offset-2 hover:underline"
            >
              Unlink this number
            </button>
          </div>
        ) : (
          <form
            className="mt-1 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMsg("");
              start(async () => {
                const r = await startWhatsAppLinkAction(phone);
                if (r.ok) setCode(r.code);
                else setMsg(r.message);
              });
            }}
          >
            <label className="block text-xs text-muted">
              Your WhatsApp number, with country code
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                className="mt-1 block w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg"
              />
            </label>
            <button
              type="submit"
              disabled={busy || phone.replace(/\D/g, "").length < 8}
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-50"
            >
              Get my code
            </button>
            {code ? (
              <p className="text-xs leading-relaxed text-muted">
                From that number, send{" "}
                <span className="num rounded bg-sunken px-1.5 py-0.5 font-semibold text-fg">
                  LINK {code}
                </span>{" "}
                to +{wa.number} within 15 minutes.{" "}
                <a
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  href={`https://wa.me/${wa.number}?text=${encodeURIComponent("LINK " + code)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open WhatsApp
                </a>
              </p>
            ) : null}
            {msg ? (
              <p role="alert" className="text-xs text-neg-text">
                {msg}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}
