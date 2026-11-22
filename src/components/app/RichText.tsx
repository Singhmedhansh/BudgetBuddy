import { Fragment, type ReactNode } from "react";

/** **bold** only. Everything else is plain text, so nothing a model writes can inject markup. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** Paragraphs and "- " bullet lists with bold, rendered as real elements. */
export function RichText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.list) last.lines.push(bullet[1]);
      else blocks.push({ list: true, lines: [bullet[1]] });
    } else if (last && !last.list) last.lines.push(line);
    else blocks.push({ list: false, lines: [line] });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="space-y-1 pl-4">
            {b.lines.map((l, j) => (
              <li key={j} className="list-disc marker:text-primary">
                {inline(l)}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="break-words">
            {inline(b.lines.join(" "))}
          </p>
        ),
      )}
    </div>
  );
}
