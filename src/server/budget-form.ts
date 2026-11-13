import { z } from "zod";
import { MoneyError, parseAmount } from "@/domain/money";
import { fieldErrors } from "./form-errors";

export interface BudgetInput {
  name: string;
  warnAt: number; // 1..100
  rollover: boolean;
  allocations: { category_id: string; amount: number }[];
}

/** Validates the budget form (create and edit share it). Returns field errors together, so every problem shows at once. */
export function parseBudgetForm(form: FormData, currency: string): { ok: true; value: BudgetInput } | { ok: false; fieldErrors?: Record<string, string>; error?: string } {
  const parsed = z
    .object({
      name: z.string({ message: "Name the budget." }).trim().min(1, "Name the budget.").max(80, "Use 80 characters or fewer."),
      warnAt: z.coerce.number({ message: "Use a whole number from 1 to 100." }).int("Use a whole number from 1 to 100.").min(1, "Use a whole number from 1 to 100.").max(100, "Use a whole number from 1 to 100."),
    })
    .safeParse({ name: form.get("name"), warnAt: form.get("warnAt") });

  const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);
  const allocations: { category_id: string; amount: number }[] = [];
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith("alloc_") || typeof raw !== "string" || raw.trim() === "") continue;
    try {
      const minor = parseAmount(raw, currency);
      if (minor < 0) throw new MoneyError("Use zero or more.");
      if (minor > 0) allocations.push({ category_id: key.slice(6), amount: minor });
    } catch (e) {
      errors[key] = e instanceof MoneyError ? e.message : "Enter an amount like 5000.";
    }
  }
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  if (allocations.length === 0) return { ok: false, error: "Set a limit for at least one category." };
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  return { ok: true, value: { name: parsed.data.name, warnAt: parsed.data.warnAt, rollover: form.get("rollover") === "on", allocations } };
}
