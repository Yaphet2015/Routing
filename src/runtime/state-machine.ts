import type { BudgetPolicy, PlanStep, RunState, StepRuntimeState } from "../domain/types";
import { createBudgetSnapshot } from "./budget";

export function createEmptyStepState(stepId: string): StepRuntimeState {
  return {
    step_id: stepId,
    status: "Pending",
    attempt: 0,
    produced_artifacts: []
  };
}

export function markStepPassed(
  stepState: StepRuntimeState,
  producedArtifacts: string[]
): StepRuntimeState {
  return {
    ...stepState,
    status: "Passed",
    produced_artifacts: producedArtifacts
  };
}

export function markStepFailed(
  stepState: StepRuntimeState,
  errorMessage: string
): StepRuntimeState {
  return {
    ...stepState,
    status: "Failed",
    attempt: stepState.attempt + 1,
    last_error: errorMessage
  };
}

export function createRunState(
  sessionId: string,
  runId: string,
  budgetPolicy: BudgetPolicy
): RunState {
  return {
    session_id: sessionId,
    run_id: runId,
    run_status: "Planned",
    plan_version: 1,
    budget_snapshot: createBudgetSnapshot(budgetPolicy),
    active_task_ids: [],
    last_event_seq: 0
  };
}

export function beginRunExecution(run: RunState, stepId: string): RunState {
  return {
    ...run,
    run_status: "Executing",
    current_step_id: stepId,
    current_step_attempt: (run.current_step_attempt ?? 0) + 1
  };
}

export function cancelRun(run: RunState, reason: string): RunState {
  return {
    ...run,
    run_status: "Cancelled",
    pending_user_request: undefined
  };
}

export function pauseRun(run: RunState): RunState {
  if (run.run_status === "Completed" || run.run_status === "Failed" || run.run_status === "Cancelled") {
    return run;
  }

  return {
    ...run,
    run_status: "Paused"
  };
}

export function resumeRun(run: RunState): RunState {
  if (run.run_status !== "Paused") {
    return run;
  }

  return {
    ...run,
    run_status: run.current_step_id ? "Executing" : "Ready"
  };
}

export function selectNextExecutableStep(
  steps: PlanStep[],
  stepStates: Record<string, StepRuntimeState>
): PlanStep | undefined {
  const readySteps = steps.filter((step) => {
    const state = stepStates[step.id];
    if (!state || state.status !== "Pending") {
      return false;
    }

    return step.dependencies.every((dependencyId: string) => {
      return stepStates[dependencyId]?.status === "Passed";
    });
  });

  return readySteps.sort((left, right) => left.id.localeCompare(right.id))[0];
}
