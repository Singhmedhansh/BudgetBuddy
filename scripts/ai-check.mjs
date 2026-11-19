// Checks the AI provider setup without exposing any key.
//   npm run ai:models            lists which configured model names each provider currently offers
//   npm run ai:models -- --smoke also sends ONE tiny prompt per provider (small, 200-token cap)
// Reads GEMINI_API_KEY_1.. / GEMINI_API_KEYS and GROQ_API_KEY_1.. / GROQ_API_KEYS from .env.local or the environment.
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no such file */
  }
}

const keysOf = (base) => [...new Set([...Array.from({ length: 9 }, (_, i) => process.env[`${base}_${i + 1}`]), ...(process.env[`${base}S`] ?? "").split(",")].map((k) => k?.trim()).filter(Boolean))];
const wanted = {
  gemini: (process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite,gemini-3.6-flash").split(",").map((s) => s.trim()),
  groq: (process.env.GROQ_MODEL ?? "openai/gpt-oss-120b,openai/gpt-oss-20b").split(",").map((s) => s.trim()),
};
const smoke = process.argv.includes("--smoke");
// Exit codes: 0 = every configured model was found (and answered, with --smoke); 1 = a model is missing or a call failed;
// 2 = nothing could be verified (no key). AI must stay off unless this exits 0.
const problems = [];
const unverified = [];
const get = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: res.ok ? await res.json() : null };
};

async function gemini(keys) {
  const [key] = keys;
  const r = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
  if (!r.body) { problems.push(`list:${r.status}`); return console.log(`  models list failed: HTTP ${r.status}`); }
  const names = new Set(r.body.models.map((m) => m.name.replace(/^models\//, "")));
  for (const m of wanted.gemini) { console.log(`  ${names.has(m) ? "available  " : "NOT FOUND  "} ${m}`); if (!names.has(m)) problems.push(`gemini:${m}`); }
  const alt = [...names].filter((n) => /^gemini-\d.*flash/.test(n) && !/(image|live|tts|audio|preview|exp)/.test(n)).slice(0, 8);
  console.log(`  other flash models offered: ${alt.join(", ") || "none"}`);
  if (smoke) {
    const model = wanted.gemini.find((m) => names.has(m));
    if (!model) return console.log("  smoke: skipped (no configured model is available)");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }], generationConfig: { maxOutputTokens: 200 } }), signal: AbortSignal.timeout(30000) });
    const j = res.ok ? await res.json() : null;
    const got = Boolean(j?.candidates?.[0]?.content?.parts?.[0]?.text);
    console.log(`  smoke (${model}): HTTP ${res.status}, text returned: ${got}`);
    if (!got) problems.push(`smoke:gemini:${model}`);
  }
}

async function groq(keys) {
  const [key] = keys;
  const r = await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
  if (!r.body) { problems.push(`list:${r.status}`); return console.log(`  models list failed: HTTP ${r.status}`); }
  const names = new Set(r.body.data.map((m) => m.id));
  for (const m of wanted.groq) { console.log(`  ${names.has(m) ? "available  " : "NOT FOUND  "} ${m}`); if (!names.has(m)) problems.push(`groq:${m}`); }
  console.log(`  models offered: ${[...names].filter((n) => !/(whisper|tts|guard|embed)/.test(n)).slice(0, 10).join(", ")}`);
  if (smoke) {
    const model = wanted.groq.find((m) => names.has(m));
    if (!model) return console.log("  smoke: skipped (no configured model is available)");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 200, ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}) }), signal: AbortSignal.timeout(30000) });
    const j = res.ok ? await res.json() : null;
    const got = Boolean(j?.choices?.[0]?.message?.content);
    console.log(`  smoke (${model}): HTTP ${res.status}, text returned: ${got}`);
    if (!got) problems.push(`smoke:groq:${model}`);
  }
}

for (const [name, fn, base] of [["Gemini", gemini, "GEMINI_API_KEY"], ["Groq", groq, "GROQ_API_KEY"]]) {
  const keys = keysOf(base);
  console.log(`${name}: ${keys.length} key(s) configured`);
  if (keys.length === 0) {
    console.log("  skipped: no key in the environment, so this provider is UNVERIFIED");
    unverified.push(name);
    continue;
  }
  try {
    await fn(keys);
  } catch (e) {
    console.log(`  failed: ${e?.name ?? "error"}`);
    problems.push(`error:${name}`);
  }
}
console.log(problems.length ? `\nFAILED: ${problems.join(", ")}. Do not enable AI.` : unverified.length ? `\nUNVERIFIED: ${unverified.join(", ")}. Do not enable AI for these providers.` : "\nVERIFIED: every configured model is offered and answered.");
console.log("Only the first key of each provider is used here, and no key is ever printed.");
process.exitCode = problems.length ? 1 : unverified.length ? 2 : 0;
