import type { BudgetLedgerEntry, BudgetPolicy, BudgetSnapshot } from "../domain/types";

export interface BudgetEvent {
  type: "budget_debited" | "budget_threshold_reached" | "budget_hard_stopped";
  amount_usd?: number;
  spent_usd?: number;
}

export function createBudgetSnapshot(policy: BudgetPolicy): BudgetSnapshot {
  return {
    policy,
    spent_usd: 0,
    reserved_usd: 0,
    remaining_usd: policy.task_budget_usd,
    ledger: []
  };
}

export function debitBudget(
  snapshot: BudgetSnapshot,
  amountUsd: number,
  ledgerEntry: BudgetLedgerEntry
): { snapshot: BudgetSnapshot; events: BudgetEvent[] } {
  const spentUsd = snapshot.spent_usd + amountUsd;
  const nextSnapshot: BudgetSnapshot = {
    ...snapshot,
    spent_usd: spentUsd,
    remaining_usd: Math.max(snapshot.policy.task_budget_usd - spentUsd, 0),
    ledger: [...snapshot.ledger, ledgerEntry]
  };

  const events: BudgetEvent[] = [{ type: "budget_debited", amount_usd: amountUsd }];
  if (
    snapshot.spent_usd < snapshot.policy.approval_threshold_usd &&
    spentUsd >= snapshot.policy.approval_threshold_usd
  ) {
    events.push({ type: "budget_threshold_reached", spent_usd: spentUsd });
  }
  if (
    snapshot.spent_usd < snapshot.policy.hard_stop_threshold_usd &&
    spentUsd >= snapshot.policy.hard_stop_threshold_usd
  ) {
    events.push({ type: "budget_hard_stopped", spent_usd: spentUsd });
  }

  return {
    snapshot: nextSnapshot,
    events
  };
}

export function reserveBudget(
  snapshot: BudgetSnapshot,
  amountUsd: number,
  ledgerEntry: BudgetLedgerEntry
): { snapshot: BudgetSnapshot } {
  return {
    snapshot: {
      ...snapshot,
      reserved_usd: snapshot.reserved_usd + amountUsd,
      ledger: [...snapshot.ledger, ledgerEntry]
    }
  };
}
