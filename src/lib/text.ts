/** Light stemming so "grocery", "groceries" and "Groceries" compare equal. */
export function stem(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** True when every word of `query` matches a word of `name` after stemming. */
export function nameMatches(name: string, query: string): boolean {
  const have = new Set(tokens(name).map(stem));
  const want = tokens(query).map(stem);
  return want.length > 0 && want.every((w) => have.has(w));
}
