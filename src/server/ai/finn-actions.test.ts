import { describe, expect, it } from "vitest";
import { actionAmount, pickCategory } from "./finn-actions";

const cats = [
  "Food",
  "Groceries",
  "Transport",
  "Bills",
  "Rent",
  "Salary",
  "Entertainment",
  "Shopping",
].map((name, i) => ({ id: String(i), name }));

describe("reading a request to record something", () => {
  it("reads amounts in plain, thousand and lakh forms", () => {
    expect(actionAmount("add a 450 grocery expense")).toBe(450);
    expect(actionAmount("log 1.5k for fuel")).toBe(1500);
    expect(actionAmount("received 2 lakh bonus")).toBe(200000);
    expect(actionAmount("set Food budget to 6,000")).toBe(6000);
    expect(actionAmount("add an expense")).toBeNull();
  });
  it("finds the category by its name, or by what the words point to", () => {
    expect(pickCategory("add 450 for Food", cats)?.name).toBe("Food");
    expect(pickCategory("add a 450 grocery expense", cats)?.name).toBe(
      "Groceries",
    );
    expect(pickCategory("I paid for an uber", cats)?.name).toBe("Transport");
    expect(pickCategory("log my electricity bill", cats)?.name).toBe("Bills");
    expect(pickCategory("record salary", cats)?.name).toBe("Salary");
    expect(pickCategory("add 300 for something odd", cats)).toBeNull();
  });
});
