import { describe, expect, it } from "vitest";

import {
  createBudgetSnapshot,
  debitBudget,
  reserveBudget
} from "../../src/runtime/budget";
import type { BudgetPolicy } from "../../src/domain/types";

const policy: BudgetPolicy = {
  task_budget_usd: 10,
  step_budget_cap_usd: 5,
  replan_budget_cap_usd: 2,
  teammate_budget_cap_usd: 3,
  approval_threshold_usd: 8,
  hard_stop_threshold_usd: 10
};

describe("budget engine", () => {
  it("tracks spend and emits threshold state transitions", () => {
    const snapshot = createBudgetSnapshot(policy);
    const afterDebit = debitBudget(snapshot, 8.5, {
      entry_id: "entry-1",
      session_id: "session-1",
      run_id: "run-1",
      kind: "model_call",
      amount_usd: 8.5,
      created_at: "2026-04-02T00:00:00.000Z"
    });

    expect(afterDebit.snapshot.spent_usd).toBe(8.5);
    expect(afterDebit.events).toEqual([
      { type: "budget_debited", amount_usd: 8.5 },
      { type: "budget_threshold_reached", spent_usd: 8.5 }
    ]);
  });

  it("hard stops when a debit crosses the hard threshold", () => {
    const snapshot = createBudgetSnapshot(policy);
    const result = debitBudget(snapshot, 10, {
      entry_id: "entry-1",
      session_id: "session-1",
      run_id: "run-1",
      kind: "model_call",
      amount_usd: 10,
      created_at: "2026-04-02T00:00:00.000Z"
    });

    expect(result.events).toEqual([
      { type: "budget_debited", amount_usd: 10 },
      { type: "budget_threshold_reached", spent_usd: 10 },
      { type: "budget_hard_stopped", spent_usd: 10 }
    ]);
  });

  it("reserves teammate budget without counting it as spend", () => {
    const snapshot = createBudgetSnapshot(policy);
    const result = reserveBudget(snapshot, 2.5, {
      entry_id: "entry-1",
      session_id: "session-1",
      run_id: "run-1",
      collab_task_id: "task-1",
      kind: "reservation",
      amount_usd: 2.5,
      created_at: "2026-04-02T00:00:00.000Z"
    });

    expect(result.snapshot.reserved_usd).toBe(2.5);
    expect(result.snapshot.spent_usd).toBe(0);
  });
});
