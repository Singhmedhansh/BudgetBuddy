import Link from "next/link";
import type { Block } from "@/content/help/articles";

const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/** Renders text with [label](/internal/path) links. External or unsafe targets are never linked. */
export function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const [full, label, href] = m;
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    if (href.startsWith("//")) parts.push(label);
    else
      parts.push(
        <Link key={i} href={href} className="font-medium text-primary underline-offset-2 hover:underline">
          {label}
        </Link>,
      );
    last = i + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-5 text-[0.95rem] leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return (
              <p key={i} className="max-w-[65ch]">
                <Inline text={b.text} />
              </p>
            );
          case "steps":
            return (
              <ol key={i} className="max-w-[65ch] list-decimal space-y-2 pl-5 marker:font-semibold marker:text-muted">
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} />
                  </li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={i} className="max-w-[65ch] list-disc space-y-2 pl-5 marker:text-muted">
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} />
                  </li>
                ))}
              </ul>
            );
          case "note":
            return (
              <p key={i} className="max-w-[65ch] rounded-md border border-line-strong bg-sunken px-4 py-3 text-sm">
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
