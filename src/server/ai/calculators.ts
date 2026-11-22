/**
 * Money calculators Finn runs in code. A language model must never do this arithmetic itself, so when a question
 * names the numbers (a loan amount, a rate, a term), the answer is worked out here and handed over as a fact.
 */
export type Calculation =
  | {
      kind: "emi";
      loanAmount: string;
      ratePercent: number;
      months: number;
      monthlyPayment: string;
      totalPaid: string;
      totalInterest: string;
    }
  | {
      kind: "sip";
      monthlyInvestment: string;
      ratePercent: number;
      years: number;
      totalInvested: string;
      futureValue: string;
      estimatedGain: string;
    }
  | {
      kind: "lumpsum";
      amount: string;
      ratePercent: number;
      years: number;
      futureValue: string;
      estimatedGain: string;
    };

const SUFFIX: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  l: 1e5,
  lac: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  cr: 1e7,
  crore: 1e7,
};
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Equated monthly instalment: P r (1+r)^n / ((1+r)^n - 1), with r the monthly rate. */
export function emi(principal: number, annualPercent: number, months: number) {
  const r = annualPercent / 12 / 100;
  const payment =
    r === 0
      ? principal / months
      : (principal * r * Math.pow(1 + r, months)) /
        (Math.pow(1 + r, months) - 1);
  const total = payment * months;
  return { payment, total, interest: total - principal };
}

/** Future value of a monthly investment made at the start of each month, compounding monthly. */
export function sip(monthly: number, annualPercent: number, years: number) {
  const n = Math.round(years * 12);
  const r = annualPercent / 12 / 100;
  const value =
    r === 0 ? monthly * n : monthly * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
  return { invested: monthly * n, value };
}

/** Future value of one amount compounding annually. */
export function lumpsum(amount: number, annualPercent: number, years: number) {
  return amount * Math.pow(1 + annualPercent / 100, years);
}

const RATE = /(\d+(?:\.\d+)?)\s*(?:%|(?:percent|per\s?cent|pc)\b)/i;
const TERM = /(\d+(?:\.\d+)?)\s*[- ]?(years?|yrs?|y|months?|mos?)\b/i;

function amountIn(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(
    /(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakhs?|lac|crore|million|mn|cr|k|l|m)?(?![a-z0-9])/gi,
  )) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const v = n * (m[2] ? (SUFFIX[m[2].toLowerCase()] ?? 1) : 1);
    if (v >= 100 && (best === null || v > best)) best = v;
  }
  return best;
}

/** Recognises an EMI, SIP or compound-growth question that names its numbers; null when it does not. */
export function detectCalculation(question: string): Calculation | null {
  const q = question.replace(/\s+/g, " ");
  const rate = RATE.exec(q);
  const term = TERM.exec(q);
  if (!rate || !term) return null;
  const ratePercent = Number(rate[1]);
  const termNum = Number(term[1]);
  const inMonths = /^m/i.test(term[2]);
  const months = Math.round(inMonths ? termNum : termNum * 12);
  const years = inMonths ? termNum / 12 : termNum;
  const amount = amountIn(q.replace(RATE, " ").replace(TERM, " "));
  if (
    amount === null ||
    !(ratePercent >= 0 && ratePercent <= 60) ||
    months < 1 ||
    months > 600
  )
    return null;

  if (/\b(emi|loan|mortgage|borrow|borrowing|instal?lments?)\b/i.test(q)) {
    const r = emi(amount, ratePercent, months);
    return {
      kind: "emi",
      loanAmount: money(amount),
      ratePercent,
      months,
      monthlyPayment: money(r.payment),
      totalPaid: money(r.total),
      totalInterest: money(r.interest),
    };
  }
  if (
    /\b(sip|every month|each month|a month|per month|monthly|\/month|\/mo)\b/i.test(
      q,
    ) &&
    /\b(invest|sip|save|saving|deposit|put)\w*/i.test(q)
  ) {
    const r = sip(amount, ratePercent, years);
    return {
      kind: "sip",
      monthlyInvestment: money(amount),
      ratePercent,
      years,
      totalInvested: money(r.invested),
      futureValue: money(r.value),
      estimatedGain: money(r.value - r.invested),
    };
  }
  if (
    /\b(fd|fixed deposit|compound|grow|growth|invest|invested|worth|return|returns|lump ?sum)\b/i.test(
      q,
    )
  ) {
    const v = lumpsum(amount, ratePercent, years);
    return {
      kind: "lumpsum",
      amount: money(amount),
      ratePercent,
      years,
      futureValue: money(v),
      estimatedGain: money(v - amount),
    };
  }
  return null;
}

/** The loan still owed at the start and after each year of an EMI loan, for charts. */
export function emiBalanceByYear(
  principal: number,
  annualPercent: number,
  months: number,
): number[] {
  const r = annualPercent / 12 / 100;
  const payment = emi(principal, annualPercent, months).payment;
  const out = [principal];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + r) - payment;
    if (m % 12 === 0 || m === months)
      out.push(Math.max(0, Math.round(balance * 100) / 100));
  }
  return out;
}

/** Value and amount put in at the start and after each year, for a SIP or a lump sum. */
export function growthByYear(
  input:
    | { kind: "sip"; monthly: number; ratePercent: number; years: number }
    | { kind: "lumpsum"; amount: number; ratePercent: number; years: number },
): { value: number[]; invested: number[] } {
  const whole = Math.max(1, Math.ceil(input.years));
  const value: number[] = [];
  const invested: number[] = [];
  for (let y = 0; y <= whole; y++) {
    const t = Math.min(y, input.years);
    if (input.kind === "sip") {
      const s = sip(input.monthly, input.ratePercent, t);
      value.push(Math.round(s.value * 100) / 100);
      invested.push(Math.round(s.invested * 100) / 100);
    } else {
      value.push(
        Math.round(lumpsum(input.amount, input.ratePercent, t) * 100) / 100,
      );
      invested.push(input.amount);
    }
  }
  return { value, invested };
}
