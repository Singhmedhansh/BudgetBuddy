# Finn: what it is and what it needs next

Finn is FinTrack's money assistant. It does two jobs: answer from the person's own records (every figure checked in
code), and answer any general money question from its own knowledge, tagged so the person can tell which is which.

## Built (22 Nov 2026)

| Area | What exists |
| --- | --- |
| Own numbers | Six months of income, spending and net; categories against last month and the 3-month average; top payees; this month's pace; bills, subscriptions, goals, debts; budgets |
| Calculations done in code | Savings time and affordability, EMI, SIP, lump-sum growth, emergency fund (3 and 6 months), 50/30/20 split. The model never does arithmetic |
| General finance | Any money question, country-aware (India terms by default from `region`), rates and limits given as approximate with a pointer to the official figure |
| Trust | Answers are tagged "from your records" or "general guidance"; unverifiable sentences are cut, not the whole answer; benchmarks allowed only when they do not address the person |
| Product feel | Name and mark, personalised starter questions, snapshot tiles, follow-up chips, bold and bullet rendering |

## Also built (23 Nov 2026)

| Area | What exists |
| --- | --- |
| Charts | Donuts, bars, income-against-spending columns, EMI and SIP growth lines, progress bars, bill timelines and stat cards, built in code from the verified facts |
| Saved chats | Left rail with search, Pinned / Today / Yesterday / Previous 7 days / Earlier, rename, pin, delete; private to the person |
| Plan allowances | Free 5 questions a day, FinTrack One 50 a day, monthly token caps behind them (AI_ALLOWANCE in plans.ts); a meter and an upgrade card |
| Answer layout | Bold recommendation first, short headings, numbered steps, small comparison tables; newest answer appears word by word |
| Actions with confirmation | "Add a 450 grocery expense", "Set my Food budget to 6000" become a card with Confirm and Cancel. No model involved, everything checked again on the server, saved once even if tapped twice |
| What Finn noticed | Over-budget lines, overdue and due-soon bills, categories up 25% or more, pace above usual, low savings rate, thin emergency cushion, subscriptions cost, goals behind |
| What-if scenarios | "What if I cut Food by 20%": worked out in code from the usual month, shown as before and after |
| Live reference data | Repo rate, PPF, Sukanya, SCSS, NSC, EPF and income tax slabs, each with its date and source (src/config/reference-data.ts); Finn quotes the date and says to confirm at the source |
| Feedback | Thumbs up or down on every answer, saved with the message (migration 15) |
| Voice | A microphone button in the composer where the browser supports speech recognition |
| Saved question set | 70 questions in src/server/ai/eval run on every change; a live guardrail set runs against the real model on demand |

## Also built (24 Nov 2026)

| Area | What exists |
| --- | --- |
| Streaming | The answer appears while it is being written. Each sentence is checked against the person's records before it is released; the finished answer replaces the preview, so the stream can never show more than the check allows (src/server/ai/stream.ts, /api/finn/ask) |
| Documents | A paperclip in the composer: attach a PDF (text-based), CSV or text file up to 3 MB. Finn answers from it for that one question; nothing is stored, and figures in the file are verified against the file |
| Weekly recap | Opt-in on the Finn page. A daily job emails everyone who is due (at most once every 6 days) a recap built from their verified figures (src/server/ai/recap.ts, /api/cron/finn). Needs RESEND_API_KEY and FINN_FROM_EMAIL |
| WhatsApp | Link a number with a 6-digit code, then ask questions or say "add 450 for groceries" and reply YES. Same allowance, same checks, same confirm step as the app (/api/webhooks/whatsapp). Needs the five WHATSAPP_* values and a Meta business number |
| Review queue | /app/finn-review for the addresses in FINN_REVIEWERS: thumbs-down answers with the question that led to each, mark as reviewed. The thumbs-down control tells people it is reviewed |
| Reference data | The weekly job emails the reviewers a monthly reminder, with every figure and its source, when the list has not been checked for 35 days. Updating the figures is still a human check against the official source |

## Setup for the new pieces

| Piece | Needs |
| --- | --- |
| Everything below | Migration 16 (supabase/migrations/20261124000016_finn_recap_whatsapp_review.sql) and SUPABASE_SERVICE_ROLE_KEY |
| Recap email | RESEND_API_KEY, FINN_FROM_EMAIL (an address on a domain verified in Resend) |
| WhatsApp | WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_NUMBER; webhook URL https://getfintrack.online/api/webhooks/whatsapp |
| Review queue and reminders | FINN_REVIEWERS (comma-separated emails) |

## Still to build

1. **Image and photo documents.** Scans and photos of slips and statements need OCR; today they are refused with a clear message.
2. **WhatsApp voice notes and images.** Only text messages are read.
3. **Automatic reference-data refresh.** Official sources publish rates in notices and press releases, not a feed, so the job reminds and lists sources rather than scraping.
4. **Per-user recap time and day.** Everyone gets the recap about every 6 days, early morning India time.

## Rules Finn keeps

- Never states a figure about the person that is not in their records. General benchmarks only in sentences that do not address them.
- Never tells them to buy or sell a specific security, predicts markets or promises returns. Tax, legal and big one-off decisions: principles plus a pointer to a qualified professional.
- Says plainly when it is general guidance and when it is from their records.
- Privacy: the model sees summaries and payee totals only, never account numbers, and nothing is used to train a model.

## Research notes

- Assistants people like (Cleo, Monarch, Bank of America's Erica) win on plain-English questions about spending, weekly recaps and proactive nudges; a casual tone can annoy people who want straight answers, so Finn stays warm but brief.
- Studies on financial chatbots find privacy and security assurances matter more than chattiness, transparency about AI use builds trust, and chatbots sound authoritative even when wrong. Hence the visible source label, the figure checks and the professional-help pointers.
