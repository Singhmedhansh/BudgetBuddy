# Finn first: limits, product shape and build plan

Status: proposal, 24 Nov 2026. Nothing here is built yet. Decisions that need the owner are marked **Decide**.

The goal: Finn is what people come for, a money assistant that understands them, gives sound guidance, and does the
bookkeeping when told ("400 on food", a photo of a bill). FinTrack's ledger, budgets, goals and reports are what Finn
runs on. Everything stays on free AI tiers until paid users exist.

---

## 1. How much free capacity there really is

Free limits are set **per Google project, per Groq organisation and per OpenRouter account, not per key**. Extra keys in
the same project or organisation add nothing. Published figures disagree and change often, so treat the table as a
starting estimate and read the real numbers from each console (Google AI Studio → Rate limits, Groq console → Limits).

| Provider and model | Free limit (latest reports, Oct–Nov 2026) | What binds first | Personal questions a day* |
|---|---|---|---|
| Groq `openai/gpt-oss-120b` | ~30 a minute, ~1,000 a day, ~8K tokens a minute, **~200K tokens a day** | tokens a day | ~60 |
| Groq `openai/gpt-oss-20b` | limits per model, reported similar | tokens a day | ~60 |
| Groq `llama-3.1-8b-instant` (light) | reports range from 1,000 to 14,400 a day; one report says it has left the free tier | check console | general questions only |
| Gemini Flash-Lite (3.5 / 3.1) | ~15 a minute, ~250K tokens a minute, **~500 a day per project** | requests a day | ~500 per project |
| Gemini Flash | ~5 a minute, ~20 a day | requests a day | ~20 (not worth routing to) |
| OpenRouter `openrouter/free` | 20 a minute, **50 a day per account** | requests a day | 0 (general only, by design) |

\*A personal question is about 3,000–3,500 tokens after the pruning added this week (it was 4,000–6,000).

**Usable total:** roughly **600–1,600 personal-grade model calls a day**. The spread depends on whether the three Gemini
keys sit in one Google Cloud project or three. Plan for 70% of that so a busy hour never hits the wall: about
**450–1,100 a day**. Shared cached answers and anything Finn does in code (most expense logging, see §3) cost nothing on
top of that.

**Gemini is the volume workhorse and Groq the fast one.** The current order (Groq first) is right for speed. Once Groq's
daily token budget is spent, traffic should move to Gemini Flash-Lite automatically. The router already fails over on
rate limits. Section 5 adds a daily budget so it moves before the 429s start.

**Privacy point to decide now.** Google's free tier states that content sent on it is used to improve Google's
products. Today, personal facts can reach Gemini whenever Groq is resting. **Decide:**
- (a) Keep it and disclose it plainly in the privacy page and in Finn settings, or
- (b) send personal questions to Groq only, use Gemini for general questions and opt-in receipt scans, and accept fewer
  personal answers a day (~120 instead of ~1,000).

Recommended: (a) now, with the disclosure. Move to a paid tier with no training on data once there is revenue.

**Decided (24 Nov):** keep it and disclose it in the last lines of the privacy policy and in Finn settings.

### 1b. More free capacity: what is worth adding

Researched 24 Nov 2026. Figures are from third-party listings; confirm on each provider's console before relying on them.

| Provider | Free allowance | Data terms | Verdict |
|---|---|---|---|
| **Cloudflare Workers AI** | 10,000 "neurons" a day per account (about 100–200 answers), resets 00:00 UTC; has vision models | not used for training | **Add.** Personal-safe, OpenAI-style endpoint, also a second option for reading receipts |
| **Mistral (Experiment plan)** | very large (reported ~1B tokens a month, ~1 request a second) | requests may be used for training; meant for trying the API | **Add for general questions only**, like OpenRouter. Biggest boost for "what is a SIP" style questions |
| **GitHub Models** | ~15 a minute, ~150 a day on smaller models | intended for prototyping | Skip: terms aim it at prototyping, not production |
| **SambaNova** | ~20 a day | unverified | Skip: too small to matter |
| **NVIDIA NIM** | prototyping access, limits only in console | prototyping terms | Skip for production |
| **Cerebras** | no longer free (one-time $5 credit with a card since Jul 2026) | — | Skip |
| **Cohere trial** | small | **non-commercial only** | Not allowed for FinTrack |

**What not to do:** create extra Google projects, Groq organisations or OpenRouter accounts just to multiply free
quotas. OpenRouter says extra accounts or keys do not change its limits, and splitting usage across accounts to get
around a free limit can breach the providers' terms and get every key banned at once. Use one honest account per
provider.

**The single cheapest big jump (breaks the strict free rule, so it is only an option):** a one-time $10 credit on
OpenRouter raises its free-model allowance from 50 to 1,000 requests a day. The key's 1-cent spending cap stays in
place, so the credit is never spent; it only unlocks the higher free limit. **Decide** whether a one-time ~₹850 is
acceptable.

With Cloudflare and Mistral added, the estimate becomes roughly **700–1,800 personal-grade calls a day** plus several
thousand general ones.

---

## 2. Limits per person

### What other assistants do
- **Rolling windows instead of a midnight reset.** Claude's free plan uses a rolling five-hour window that starts with
  the first message, reportedly about 15–40 messages per window depending on demand. ChatGPT used 3- to 5-hour windows
  and reportedly moved free users to a weekly limit in 2026. Gemini also uses a rolling window.
- A short window stops one person from spending the shared budget in a burst. A daily or weekly ceiling bounds the
  total. A midnight reset (what FinTrack does now) is simple, but it locks people out for up to a day and invites "use
  it or lose it" bursts at 23:59.
- Good products show **when** the next message frees up, not just "limit reached".

### Recommendation (all values live in `src/config/plans.ts`)

| | FinTrack Free | FinTrack One |
|---|---|---|
| Finn messages that use a model | **20 per rolling 5 hours, at most 40 a day** (owner decision, 24 Nov) | **50 per rolling 5 hours, at most 150 a day** (owner decision, 24 Nov) |
| Quick logs Finn handles in code ("400 on food", "salary 50k credited") | **not counted**; fair use 100 a day | not counted; fair use 300 a day |
| Receipt or screenshot scans | **3 a day** | **30 a day** |
| Attached statements or PDFs | 2 a day | 20 a day |
| Burst guard | 5 a minute | 10 a minute |
| Monthly token guard (cost backstop) | 600K | 5M |

Why these numbers:
- **Logging is free and unlimited.** Logging expenses is the habit that makes Finn indispensable, and the code path
  costs nothing, so it should never hit a wall. That makes "just tell Finn" the default way to record money.
- **20 per 5 hours** covers several real conversations a day. Most people use far fewer: at an average of 4–6 model
  messages per active free user a day, the usable budget in §1 (plus the providers in §1b) supports roughly
  **150–300 daily active free users**. The capacity guard below is what makes 20 safe: when the shared budget runs low,
  Free users move to the light path before anyone hits a wall.
- **40 a day** caps the worst case for one free user at about 130K tokens.
- **One at 50 per 5 hours, 150 a day** feels unlimited for real use and keeps paid users first in line.
- A shared cached answer, a confirm or undo, and any reply that fails or is refused **never count**. That matches
  today's behaviour.

### Capacity guard (protects everyone when the shared budget runs low)
1. **Normal:** everyone gets the full models.
2. **Over 80% of the day's estimated free budget used:** Free users get the light path (cache, then the small model,
   then short answers). One users are unaffected.
3. **Over 95%:** Free model questions pause with "Finn is busy, back in about N minutes". Quick logs still work because
   they need no model. One users still get through.

The day's budget is estimated from `ai_usage` plus Groq's `x-ratelimit-remaining-*` response headers. Gemini sends no
such headers, so its share is counted from usage.

### Database change
A new `ai_reserve_window(p_window interval, p_window_max int, p_day_max int, p_per_minute int, p_kind text, ...)`
replaces the day count with rolling counts. It returns `retry_at` so the UI can say "next message at 3:40 pm". A `kind`
column on `ai_usage` (`chat | scan | doc | log_model`) lets scans have their own cap. Migration 19, with a rollback and
PGlite tests, the same pattern as 14–18.

---

## 3. "Just tell Finn": recording money from words, voice and photos

### 3a. Words (the 80% case, zero cost)
Today `looksLikeAction` only matches "add…", "log…" or "I spent…". **"400 spent on food" does not match**, and neither
does "food 400" or "₹250 swiggy". Widen the code parser first, because it is free, instant and cannot hallucinate.
- Amount-first and category-first forms: `400 spent on food`, `400 on food`, `food 400`, `swiggy ₹250`,
  `paid 1200 rent`, `got 50k salary`.
- Several items in one message: `200 auto, 150 chai, 90 metro yesterday` becomes three transactions in one card.
- Dates: today, yesterday, "on Monday", "12 Nov".
- Accounts and payment method: "from HDFC", "cash", "UPI", "card".
- A category hint table grown from Indian merchants (Swiggy, Zomato, Blinkit, Zepto, Ola, Uber, IRCTC, Jio, Airtel,
  BigBasket, DMart…). Learn per person: once someone files "Chaayos" under Food, use that again.

**Model fallback for messy text.** When the code parser cannot read it ("lent ravi 500 and paid back 200 of the
dinner"), ask a model for **structured output only**: a JSON schema with `transactions[]`, each holding `type`, `amount`,
`categoryName`, `accountName`, `date`, `merchant` and `note`. Code then checks every field:
- every amount must appear in the message;
- the category must be one of theirs, otherwise it is shown as "new category?";
- the account must be one of theirs;
- the date cannot be in the future or more than a year back.

Anything that fails a check is asked about, never guessed. This counts as one Finn message. It never goes to OpenRouter,
because the message is personal.

### 3b. Voice
The mic button already uses the browser's own speech recognition, which is free and runs on the device. Route its text
through the same parser so "four hundred on food" works hands-free. Add number words (hundred, thousand, lakh).

### 3c. Photos: bills, receipts, UPI screenshots
- **On the phone:** `accept="image/*"` with the camera allowed. Shrink to at most 1600 px and about 200–300 KB JPEG in
  the browser before upload, and handle HEIC.
- **Reading it.** Gemini Flash-Lite with an image and a response schema: `merchant`, `date`, `total`, `currency`,
  `items[]`, `paymentMethod`, `upiRef`, `confidence`. An image costs roughly 260–560 tokens. If Gemini is resting or the
  person has declined Gemini (see §1), fall back to **on-device text recognition (Tesseract.js) in the browser**, which
  is free and never leaves the phone. Then send the recognised text through the same extraction as 3a.
- **UPI screenshots** (GPay, PhonePe, Paytm, BHIM) get their own prompt: payee, amount, UTR or reference, date and time.
  The UTR makes duplicates impossible. In India this will be used more than paper receipts.
- **Checks in code:**
  - the total must be readable;
  - the line items must add up to the total within ₹1, or Finn asks;
  - a matching amount within 2 days with the same merchant or UTR gives a "looks like a duplicate" warning;
  - future dates are refused.
- **Nothing is stored by default.** The image is read and dropped. "Keep the receipt with the transaction" can come
  later on Supabase Storage, but its free 1 GB fills fast.
- **Quality bar before launch:** a set of 50 real Indian receipts and screenshots, labelled. Target: total ≥ 95%,
  date ≥ 90%, merchant ≥ 85%, category ≥ 80% correct. Run it in CI like the existing eval set.

### 3d. Confirm or auto-save
**Decide:**
- (a) Always show the confirm card (today's behaviour), or
- (b) save quick logs straight away with an **Undo** toast for 8 seconds, while multi-item, photo and model-read entries
  still show the editable card.

Recommended: (b) as an opt-in setting ("Save quick logs without asking"), off by default.

**Also:**
- "undo that", "change it to 450", "that was yesterday": keep a `finn_action_log` with the ids Finn created so the last
  action can be edited or reversed.
- The card becomes editable in place (amount, category, account, date) instead of confirm or cancel only.

---

## 4. Finn that understands the person and gives real guidance

### 4a. Money profile ("what Finn knows about you")
- A short chat-style onboarding: income pattern (salary date, stipend, irregular), fixed costs (rent, EMIs), goals,
  dependents, how they feel about risk, tax regime, city tier.
- Stored in `finn_profile`, which is RLS-protected and fully visible, editable and deletable on a "What Finn knows"
  page. A compact profile line goes into every personal prompt, adding about 150 tokens.
- Finn may offer to remember something it was told ("Want me to remember your salary comes on the 1st?"). It never
  stores anything silently.

### 4b. Advice playbooks: computed in code, explained by Finn
This keeps the current rule that numbers come from code and words from the model.
- Emergency fund (exists), debt payoff by avalanche vs snowball with month-by-month payoff, a 50/30/20 split (exists),
  and goal plans (exists as `savingsPlan`). Add contribution schedules across several goals.
- "Make me a budget" proposes a whole budget from the last three months. Confirming creates it.
- Old vs new tax regime: a comparison from the reference figures, dated and sourced, with a "check with a CA" line.
- SIP and lump-sum projections (exist) shown as ranges, never promises.
- Health score: a monthly 0–100 with the three drivers to work on.

### 4c. Where advice must stop (India)
SEBI's 2024 amendments hold registered advisers fully responsible for AI-generated advice. SEBI orders have treated
buy/sell calls labelled "education" as investment advice that needs registration. FinTrack is not a registered adviser,
so Finn:
- explains products, trade-offs and principles, and plans budgets, debt and goals;
- **never** names a specific stock, fund, coin or policy to buy or sell, never predicts markets, never promises returns.
  The current prompt already says this, and the eval set should test it;
- has one standing line in Finn settings and the terms: "Finn gives general guidance and education. It is not a
  SEBI-registered investment adviser." Do not repeat it in every answer.

Get a short legal review before marketing Finn as giving "financial advice". "Money guidance" or "money coach" is safer
wording.

---

## 5. Making Finn the face of FinTrack

### 5a. Landing page (`src/app/page.tsx`), in this order
1. **Hero: Finn in action.** A looping, scripted chat (no live calls): "400 on food" saves a card; a photo of a Swiggy
   bill fills a card; "Can I afford a ₹7,000 monitor this month?" gives an answer with a chart. Headline in the spirit
   of "Tell Finn. It handles your money." with "Start free with Finn" as the call to action.
2. **Just tell Finn**: logging by words, voice, photo and UPI screenshot.
3. **Ask Finn anything**: own-money questions with charts, plus general money questions.
4. **Finn plans with you**: budgets, goals, debt payoff, tax regime.
5. **Finn keeps watch**: weekly recap, bill and budget nudges, WhatsApp (once Meta is set up).
6. **Why you can trust Finn**: numbers checked against your records, asks before changing anything, never moves money,
   your data stays yours.
7. **Everything Finn runs on**: the current FinTrack feature grid (ledger, budgets, bills, imports, shared spaces,
   forecasts), reframed as Finn's foundation.
8. Plans (Finn allowances first), FAQ, footer.

`BRAND.tagline` and `BRAND.description` change in `src/config/brand.ts` only (AGENTS.md rule). **Decide** the new
tagline. For example: "Meet Finn. Your money, handled." / "Your money assistant. Your money, in focus."

### 5b. Inside the app
- **"Tell Finn" bar** at the top of the dashboard and on Transactions: one line that takes text, voice or a photo. This
  becomes the main way to add a transaction, with the old form kept as "Add manually".
- **Finn first in the navigation**, and `/app` opens on a Finn home: the chat, today's snapshot and two or three
  insight cards Finn wrote ("Food is 61% above last month: see why").
- **"Ask Finn" on every chart and card**, which opens the side panel with the question pre-filled.
- The floating launcher stays on every other page (built).
- Plans page and checkout lead with Finn's allowances.

All UI work goes through the ui-consistency phases (finding-patterns, then planning, implementing and verifying) so the
new surfaces match the existing pages.

---

## 6. Build order

Each step ships on its own: tests, type check, lint, deploy.

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | Widen the code parser: amount-first, multi-item, dates, Indian merchants, number words for voice; quick logs not counted | S | — |
| 2 | Migration 19: rolling 5-hour window, daily cap, per-minute guard, `kind` per usage row, `retry_at`; plans config values; UI "next message at…" | M | owner applies migration |
| 3 | Daily provider budgets and the capacity guard (Groq headers + usage counts), with capacity bars on the review page | M | 2 |
| 4 | Editable confirm card, multi-item card, undo and edit-last via `finn_action_log`, opt-in auto-save | M | 1 |
| 5 | Model fallback for messy logs with a JSON schema and code checks | M | 4 |
| 6 | Photo and screenshot scanning: client shrink, Gemini vision schema, Tesseract.js fallback, UPI prompt, duplicate check, 50-receipt eval | L | 4, 5 |
| 7 | Money profile, "What Finn knows" page, onboarding chat | M | — |
| 8 | Playbooks: debt payoff plan, budget builder, tax regime comparison, health score | L | 7 |
| 9 | Landing page rebuilt Finn-first, new tagline | M | Decide tagline |
| 10 | In-app Finn home, "Tell Finn" bar, "Ask Finn" on cards, nav order | L | 1, 4 |
| 11 | Eval growth: actions, receipts, advice boundaries (no named securities), refusal and limit messages | S each | alongside |

Suggested first slice (about a week of work): **1, 2, 4, then 9**. That makes "400 on food" work everywhere for free, sets
fair limits, and repositions the site around Finn. After that: **6** (photos), then **7–8** (understanding and
guidance), then **10**.

## 7. Decisions
1. Gemini free tier: **decided**, keep and disclose in the last lines of the privacy policy. (§1)
2. Limits: **decided**, Free 20 per 5 hours (40 a day), One 50 per 5 hours (150 a day). (§2)
3. Quick logs: **decided**, opt-in auto-save with undo, off by default. (§3d)
4. Tagline: **decided**, "Meet Finn. Your money, handled." (§5a)
5. **Open:** the one-time $10 OpenRouter credit (§1b).

Tagline shortlist: "Meet Finn. Your money, handled." · "Just tell Finn." · "Talk to your money." · "Say it. Finn sorts it." ·
"Your money, explained." · "Ask Finn. Know your money."

## Sources
- Gemini free tier: [imisofts, Oct 2026 readings](https://imisofts.com/blog/gemini-api-free-tier-limits/), [aifreeapi, Nov 2026](https://www.aifreeapi.com/en/posts/google-gemini-api-free-tier), [Google pricing (free tier data use)](https://ai.google.dev/gemini-api/docs/pricing)
- Groq free tier: [klymentiev](https://klymentiev.com/blog/groq-pricing), [benchlm](https://benchlm.ai/free-tier/groq), [Groq rate-limit docs and headers](https://console.groq.com/docs/rate-limits)
- OpenRouter: [limits](https://openrouter.ai/docs/api/reference/limits), [help article](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379), [free router](https://openrouter.ai/openrouter/free)
- More free providers: [OpenRouter comparison](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/), [requesty](https://www.requesty.ai/blog/free-llm-apis), [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Mistral Experiment plan](https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan), [Cerebras free tier change](https://benchlm.ai/free-tier/cerebras)
- Chat limits design: [Claude free usage](https://support.claude.com/en/articles/8602283-about-free-claude-usage), [SlashGear on the 5-hour window](https://www.slashgear.com/2198499/what-is-the-5-hour-limit-on-claude-free-plan/), [Engadget on ChatGPT free 2026](https://engadget.com/2234173/chatgpt-free-features-2026), [tech-insider comparison](https://tech-insider.org/chatgpt-vs-claude-vs-gemini-free-tier-2026/)
- Receipt extraction: [IBM tutorial](https://developer.ibm.com/tutorials/awb-vibe-coding-expense-report/), [receipt categorisation study](https://arxiv.org/html/2604.01615)
- Chat-first finance apps: [Copilot Money assistant](https://www.copilot.money/dispatch/beta-introducing-your-money-assistant), [Cleo 3.0](https://web.meetcleo.com/blog/Introducing-cleo-3-0), [Rocket Money roundup](https://www.rocketmoney.com/learn/personal-finance/best-ai-budgeting-apps)
- SEBI and AI: [Bar & Bench](https://www.barandbench.com/news/law-policy/sebis-amendment-to-investment-advisor-regulations-addresses-ai-concerns), [Mondaq 2026](https://www.mondaq.com/india/securities/1759228/sebis-new-digital-compliance-rules-what-investment-advisers-must-know-in-2026), [Taxmann](https://www.taxmann.com/post/blog/sebi-mandates-investment-advisers-to-disclose-use-of-ai-tools-to-clients-in-providing-investment-advice)
