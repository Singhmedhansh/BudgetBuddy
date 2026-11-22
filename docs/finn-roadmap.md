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

## Next, in priority order

1. **Clarifying questions and memory of the conversation.** Ask for the one missing detail (tax regime, loan type, horizon). Keep the last chat per person so it can be resumed. (Research: chatbots are wrong about tax when they never ask for the relevant details.)
2. **Streaming answers.** Words appear as they are written; the wait feels half as long.
3. **Actions, with confirmation.** "Add a 450 expense for groceries yesterday", "set a Food budget of 6,000", "remind me about rent". Finn proposes, the person taps Confirm, the app writes. Never writes on its own.
4. **Proactive insights.** A weekly recap and alerts ("Food is up 40% against last month", "rent is due in 3 days", "a subscription price changed") on the dashboard and by email.
5. **Live data for general answers.** Current repo rate, PPF/EPF rate, tax slabs and limits from a maintained table or a search tool, with the date shown, so rates are never guessed.
6. **Documents.** Upload a bank statement, salary slip or loan sheet and ask about it.
7. **Feedback and review.** Thumbs up or down on every answer, a "report a wrong answer" flow, and a private review list for improving prompts. Error repair matters: a wrong answer corrected gracefully keeps trust.
8. **Scenario planning.** "What if I pay 5,000 extra on the loan", "what if I cut Food by 20%": show the new projection next to the current one.
9. **Voice and WhatsApp.** Ask while on the move; log expenses by message.
10. **Evaluation set.** 200 saved questions (own-numbers and general) run on every change, scoring correctness, refusal behaviour and figure leaks, before anything ships.

## Rules Finn keeps

- Never states a figure about the person that is not in their records. General benchmarks only in sentences that do not address them.
- Never tells them to buy or sell a specific security, predicts markets or promises returns. Tax, legal and big one-off decisions: principles plus a pointer to a qualified professional.
- Says plainly when it is general guidance and when it is from their records.
- Privacy: the model sees summaries and payee totals only, never account numbers, and nothing is used to train a model.

## Research notes

- Assistants people like (Cleo, Monarch, Bank of America's Erica) win on plain-English questions about spending, weekly recaps and proactive nudges; a casual tone can annoy people who want straight answers, so Finn stays warm but brief.
- Studies on financial chatbots find privacy and security assurances matter more than chattiness, transparency about AI use builds trust, and chatbots sound authoritative even when wrong. Hence the visible source label, the figure checks and the professional-help pointers.
