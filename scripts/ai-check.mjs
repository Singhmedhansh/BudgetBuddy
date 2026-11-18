// Checks the AI provider setup without exposing any key.
//   npm run ai:models            lists which configured model names each provider currently offers
//   npm run ai:models -- --smoke also sends ONE tiny prompt per provider (about 20 output tokens each)
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
  gemini: (process.env.GEMINI_MODEL ?? "gemini-3.6-flash,gemini-3.5-flash").split(",").map((s) => s.trim()),
  groq: (process.env.GROQ_MODEL ?? "openai/gpt-oss-120b,qwen/qwen3.6-27b").split(",").map((s) => s.trim()),
};
const smoke = process.argv.includes("--smoke");
const get = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: res.ok ? await res.json() : null };
};

async function gemini(keys) {
  const [key] = keys;
  const r = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
  if (!r.body) return console.log(`  models list failed: HTTP ${r.status}`);
  const names = new Set(r.body.models.map((m) => m.name.replace(/^models\//, "")));
  for (const m of wanted.gemini) console.log(`  ${names.has(m) ? "available  " : "NOT FOUND  "} ${m}`);
  const alt = [...names].filter((n) => /^gemini-\d.*flash/.test(n) && !/(image|live|tts|audio|preview|exp)/.test(n)).slice(0, 8);
  console.log(`  other flash models offered: ${alt.join(", ") || "none"}`);
  if (smoke) {
    const model = wanted.gemini.find((m) => names.has(m));
    if (!model) return console.log("  smoke: skipped (no configured model is available)");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }], generationConfig: { maxOutputTokens: 20 } }), signal: AbortSignal.timeout(30000) });
    const j = res.ok ? await res.json() : null;
    console.log(`  smoke (${model}): HTTP ${res.status}, text returned: ${Boolean(j?.candidates?.[0]?.content?.parts?.[0]?.text)}`);
  }
}

async function groq(keys) {
  const [key] = keys;
  const r = await get("https://api.groq.com/openai/v1/models", { authorization: `Bearer ${key}` });
  if (!r.body) return console.log(`  models list failed: HTTP ${r.status}`);
  const names = new Set(r.body.data.map((m) => m.id));
  for (const m of wanted.groq) console.log(`  ${names.has(m) ? "available  " : "NOT FOUND  "} ${m}`);
  console.log(`  models offered: ${[...names].filter((n) => !/(whisper|tts|guard|embed)/.test(n)).slice(0, 10).join(", ")}`);
  if (smoke) {
    const model = wanted.groq.find((m) => names.has(m));
    if (!model) return console.log("  smoke: skipped (no configured model is available)");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 20 }), signal: AbortSignal.timeout(30000) });
    const j = res.ok ? await res.json() : null;
    console.log(`  smoke (${model}): HTTP ${res.status}, text returned: ${Boolean(j?.choices?.[0]?.message?.content)}`);
  }
}

for (const [name, fn, base] of [["Gemini", gemini, "GEMINI_API_KEY"], ["Groq", groq, "GROQ_API_KEY"]]) {
  const keys = keysOf(base);
  console.log(`${name}: ${keys.length} key(s) configured`);
  if (keys.length === 0) {
    console.log("  skipped: no key in the environment");
    continue;
  }
  try {
    await fn(keys);
  } catch (e) {
    console.log(`  failed: ${e?.name ?? "error"}`);
  }
}
console.log("\nOnly the first key of each provider is used here, and no key is ever printed.");
