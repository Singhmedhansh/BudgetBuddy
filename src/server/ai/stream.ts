import { sentenceOk, type Facts } from "./grounding";

/**
 * Shows an answer while the model is still writing it, without ever showing a figure that is not in the person's
 * records. Text is held until a sentence (or a line of a list or table) is complete; each complete unit goes through the
 * same check the finished answer gets, and only units that pass are released. The leading [A] / [G] tag is read first
 * and never shown. When the model finishes, the caller replaces what was streamed with the fully checked answer, so the
 * stream can only ever be a preview of the final text, never more than it.
 */
export class SentenceVerifier {
  private buf = "";
  private tag: "A" | "G" | null = null;
  private released = "";

  constructor(
    private readonly facts: Facts,
    private readonly emit: (text: string) => void,
  ) {}

  /** The tag once it has been read. */
  get readTag() {
    return this.tag;
  }
  /** Everything released so far. */
  get shown() {
    return this.released;
  }

  push(chunk: string) {
    this.buf += chunk;
    if (this.tag === null) {
      const m = /^\s*\[(A|G)\]\s*/i.exec(this.buf);
      if (m) {
        this.tag = m[1].toUpperCase() as "A" | "G";
        this.buf = this.buf.slice(m[0].length);
      } else if (this.buf.trimStart().length >= 4) {
        // No tag is treated as [A], the strict case, exactly as the finished answer is.
        this.tag = "A";
      } else return;
    }
    this.drain(false);
  }

  /** Call once the model has finished: releases whatever is left, if it passes the check. */
  finish() {
    if (this.tag === null) this.tag = "A";
    this.drain(true);
  }

  private drain(final: boolean) {
    const tag = this.tag!;
    const sep = /(?<=[.!?])\s+|\n+/g;
    let prev = 0;
    let out = "";
    for (const m of this.buf.matchAll(sep)) {
      const end = (m.index ?? 0) + m[0].length;
      // A separator at the very end could still be followed by more of the same unit (a decimal, an abbreviation).
      if (!final && end >= this.buf.length) break;
      const unit = this.buf.slice(prev, m.index).trim();
      prev = end;
      if (unit && sentenceOk(unit, tag, this.facts))
        out += unit + (m[0].includes("\n") ? "\n" : " ");
    }
    let rest = this.buf.slice(prev);
    if (final) {
      const unit = rest.trim();
      if (unit && sentenceOk(unit, tag, this.facts)) out += unit;
      rest = "";
    }
    this.buf = rest;
    if (out) {
      this.released += out;
      this.emit(out);
    }
  }
}
