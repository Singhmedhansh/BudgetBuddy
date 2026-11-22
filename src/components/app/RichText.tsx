import { Fragment, type ReactNode } from "react";

/** **bold** only. Everything else is plain text, so nothing a model writes can inject markup. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
const isSeparator = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Splits text into headings, paragraphs, bullet and numbered lists, and simple tables. Pure, so it is tested. */
export function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (
      line.startsWith("|") &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1])
    ) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|"))
        rows.push(cells(lines[i++]));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", text: heading[1].replace(/\*\*/g, "") });
      continue;
    }
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const numbered = /^\d{1,2}[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.lines.push(item);
      else blocks.push({ kind, lines: [item] });
    } else if (last && last.kind === "p") last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }
  return blocks;
}

/** Paragraphs, headings, lists and tables with bold, rendered as real elements in the app's own style. */
export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {parseBlocks(text).map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <h3 key={i} className="pt-1 font-display text-base">
                {b.text}
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="space-y-1 pl-4">
                {b.lines.map((l, j) => (
                  <li key={j} className="list-disc marker:text-primary">
                    {inline(l)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="space-y-1 pl-5">
                {b.lines.map((l, j) => (
                  <li
                    key={j}
                    className="list-decimal marker:font-semibold marker:text-primary"
                  >
                    {inline(l)}
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-xl border border-line"
              >
                <table className="w-full text-left text-sm">
                  <thead className="bg-sunken text-muted">
                    <tr>
                      {b.head.map((h, j) => (
                        <th
                          key={j}
                          scope="col"
                          className="px-3 py-2 font-medium"
                        >
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-t border-line">
                        {r.map((c, k) => (
                          <td key={k} className="px-3 py-2 align-top">
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i} className="break-words">
                {inline(b.lines.join(" "))}
              </p>
            );
        }
      })}
    </div>
  );
}
