/**
 * Finn's saved question set. Each case says what the code around the model must do with the question: which
 * calculation, what-if or reference figure is attached, whether it is a request to change something, and which
 * picture is drawn. These run on every change (no model needed). The live set (eval.live.test.ts) sends the general
 * questions to the real model and checks the guardrails on what comes back.
 */
export interface EvalCase {
  q: string;
  /** A request to change something (handled as a confirm-to-save proposal). */
  action?: boolean;
  calc?: "emi" | "sip" | "lumpsum";
  reference?: string[];
  scenario?: boolean;
  visuals?: string[];
}

export const CASES: EvalCase[] = [
  // Their own numbers: which picture
  { q: "How much did I spend this month?", visuals: ["donut", "bars"] },
  { q: "Where did most of my money go?", visuals: ["donut", "bars"] },
  { q: "Which category is my biggest expense?", visuals: ["donut", "bars"] },
  {
    q: "What were my biggest spending categories?",
    visuals: ["donut", "bars"],
  },
  { q: "Compare my income across months", visuals: ["columns", "stats"] },
  {
    q: "How has my saving rate changed over the last few months?",
    visuals: ["columns", "stats"],
  },
  { q: "Am I on track with my budgets this month?", visuals: ["progress"] },
  { q: "Which budget is closest to its limit?", visuals: ["progress"] },
  { q: "How are my savings goals going?", visuals: ["progress"] },
  { q: "What bills are coming up?", visuals: ["timeline", "stats"] },
  { q: "What is due this week?", visuals: ["timeline", "stats"] },
  {
    q: "How much do my subscriptions cost me a year?",
    visuals: ["timeline", "stats"],
  },
  { q: "What is my net worth right now?", visuals: ["stats", "bars"] },
  { q: "How much do I owe in total?", visuals: ["stats", "bars"] },
  { q: "How big should my emergency fund be?", visuals: ["stats", "progress"] },
  {
    q: "How many months of expenses could I live on?",
    visuals: ["stats", "progress"],
  },
  { q: "Explain the 50/30/20 rule using my income", visuals: ["donut"] },
  { q: "How much can I spend per day this month?", visuals: ["stats"] },
  // What-ifs and calculators
  {
    q: "What would the EMI be on a 5 lakh loan at 10% for 3 years?",
    calc: "emi",
    visuals: ["stats", "donut", "line"],
  },
  {
    q: "EMI for a loan of 2,00,000 at 9.5% for 24 months",
    calc: "emi",
    visuals: ["stats", "donut", "line"],
  },
  {
    q: "My home loan of 50 lakh at 8.5% for 20 years: what is the EMI?",
    calc: "emi",
    visuals: ["stats", "donut", "line"],
  },
  {
    q: "If I invest 5000 a month in a SIP at 12% for 10 years what do I get?",
    calc: "sip",
    visuals: ["stats", "line"],
  },
  {
    q: "SIP of 10,000 per month at 11% for 15 years",
    calc: "sip",
    visuals: ["stats", "line"],
  },
  {
    q: "How much will 1 lakh in an FD at 7% be worth after 5 years?",
    calc: "lumpsum",
    visuals: ["stats", "line"],
  },
  {
    q: "What if I cut my Food spending by 20%?",
    scenario: true,
    visuals: ["stats", "bars", "bars"],
  },
  {
    q: "What if I reduce my spending by 10%?",
    scenario: true,
    visuals: ["stats", "bars", "bars"],
  },
  // Dated reference figures
  {
    q: "What is the current PPF interest rate?",
    reference: ["PPF interest rate"],
  },
  { q: "What is the RBI repo rate now?", reference: ["RBI repo rate"] },
  {
    q: "What is the Sukanya Samriddhi rate?",
    reference: ["Sukanya Samriddhi rate"],
  },
  { q: "What is the EPF interest rate?", reference: ["EPF interest rate"] },
  {
    q: "Which income tax slab applies to 10 lakh under the new regime?",
    reference: ["Income tax, new regime (resident individual)"],
  },
  {
    q: "Is the standard deduction 75,000?",
    reference: ["Income tax, new regime (resident individual)"],
  },
  {
    q: "Tell me about the senior citizens savings scheme",
    reference: ["Senior Citizens Savings Scheme rate"],
  },
  // Requests to change something
  { q: "Add a 450 grocery expense", action: true },
  { q: "Log 1200 for electricity bill yesterday", action: true },
  { q: "Record that I received 50000 salary", action: true },
  { q: "add 300 for lunch at Subway", action: true },
  { q: "I spent 250 on coffee", action: true },
  { q: "Set my Food budget to 6000", action: true },
  { q: "Change the Transport limit to 4,500", action: true },
  { q: "Please enter an expense of 99 for a movie", action: true },
  // Plain questions must never be mistaken for requests
  { q: "How much did I spend on groceries?" },
  { q: "Should I add more to my emergency fund?" },
  { q: "What is a good budget for food?" },
  { q: "Is 450 a lot to spend on groceries?" },
  // General knowledge: nothing special attached
  { q: "What is an emergency fund?" },
  { q: "Explain compound interest simply" },
  { q: "What is the difference between a debit card and a credit card?" },
  { q: "How does a credit score work?" },
  { q: "Should I pay off my loan or invest?" },
  { q: "What is inflation and why does it matter?" },
  {
    q: "What is the difference between PPF and ELSS?",
    reference: ["PPF interest rate"],
  },
  { q: "How do I start investing with a small amount?" },
  { q: "What does term insurance cover?" },
  {
    q: "Explain the old and new tax regime in simple words",
    reference: ["Income tax, new regime (resident individual)"],
  },
  { q: "What is the 4% rule for retirement?" },
  { q: "How do I build a budget from scratch?" },
  { q: "What is a mutual fund?" },
  { q: "What is the snowball method for debt?" },
  { q: "How can I improve my CIBIL score?" },
  { q: "What is an index fund?" },
  { q: "Is it better to rent or buy a house?" },
  { q: "How much should I save from my salary?" },
  { q: "What is a good savings rate?" },
  { q: "How does UPI work?" },
  { q: "What is the difference between simple and compound interest?" },
  { q: "What are the risks of crypto?" },
  { q: "Explain what a SIP is" },
  { q: "How do I read my credit card statement?" },
  { q: "What should I do with my first salary?" },
];
