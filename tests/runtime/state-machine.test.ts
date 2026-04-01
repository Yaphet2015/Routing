import { describe, expect, it } from "vitest";

import {
  beginRunExecution,
  cancelRun,
  createEmptyStepState,
  createRunState,
  markStepFailed,
  markStepPassed,
  pauseRun,
  resumeRun,
  selectNextExecutableStep
} from "../../src/runtime/state-machine";
import type { PlanStep } from "../../src/domain/types";

function makeStep(overrides: Partial<PlanStep>): PlanStep {
  return {
    id: overrides.id ?? "step-1",
    title: overrides.title ?? "Step",
    type: overrides.type ?? "implement",
    action: overrides.action ?? "Do thing",
    dependencies: overrides.dependencies ?? [],
    preferred_profile: overrides.preferred_profile ?? "executor",
    execution_mode: overrides.execution_mode ?? "inline",
    verification_spec_id: overrides.verification_spec_id ?? "verify-1",
    done_when: overrides.done_when ?? {},
    max_retries: overrides.max_retries ?? 1,
    timeout_ms: overrides.timeout_ms ?? 60_000
  };
}

describe("state-machine", () => {
  it("selects the first dependency-satisfied pending step", () => {
    const steps = [
      makeStep({ id: "a" }),
      makeStep({ id: "b", dependencies: ["a"] })
    ];
    const stepStates = {
      a: createEmptyStepState("a"),
      b: createEmptyStepState("b")
    };

    expect(selectNextExecutableStep(steps, stepStates)?.id).toBe("a");

    stepStates.a = markStepPassed(stepStates.a, []);

    expect(selectNextExecutableStep(steps, stepStates)?.id).toBe("b");
  });

  it("moves a planned run into executing with the current step", () => {
    const run = createRunState("session-1", "run-1", {
      task_budget_usd: 10,
      step_budget_cap_usd: 5,
      replan_budget_cap_usd: 2,
      teammate_budget_cap_usd: 1,
      approval_threshold_usd: 8,
      hard_stop_threshold_usd: 10
    });

    const nextRun = beginRunExecution(run, "step-1");

    expect(nextRun.run_status).toBe("Executing");
    expect(nextRun.current_step_id).toBe("step-1");
    expect(nextRun.current_step_attempt).toBe(1);
  });

  it("chooses the same next step regardless of input array order", () => {
    const steps = [
      makeStep({ id: "b" }),
      makeStep({ id: "a" })
    ];
    const stepStates = {
      a: createEmptyStepState("a"),
      b: createEmptyStepState("b")
    };

    expect(selectNextExecutableStep(steps, stepStates)?.id).toBe("a");
  });

  it("fails a step with remaining retries without cancelling the run", () => {
    const stepState = createEmptyStepState("step-1");
    const failed = markStepFailed(stepState, "tool timeout");

    expect(failed.status).toBe("Failed");
    expect(failed.attempt).toBe(1);

    const run = beginRunExecution(
      createRunState("session-1", "run-1", {
        task_budget_usd: 10,
        step_budget_cap_usd: 5,
        replan_budget_cap_usd: 2,
        teammate_budget_cap_usd: 1,
        approval_threshold_usd: 8,
        hard_stop_threshold_usd: 10
      }),
      "step-1"
    );

    const cancelled = cancelRun(run, "user requested");
    expect(cancelled.run_status).toBe("Cancelled");
    expect(cancelled.pending_user_request).toBeUndefined();
  });

  it("pauses and resumes a run without mutating the active step", () => {
    const run = beginRunExecution(
      createRunState("session-1", "run-1", {
        task_budget_usd: 10,
        step_budget_cap_usd: 5,
        replan_budget_cap_usd: 2,
        teammate_budget_cap_usd: 1,
        approval_threshold_usd: 8,
        hard_stop_threshold_usd: 10
      }),
      "step-1"
    );

    const paused = pauseRun(run);
    expect(paused.run_status).toBe("Paused");
    expect(paused.current_step_id).toBe("step-1");

    const resumed = resumeRun(paused);
    expect(resumed.run_status).toBe("Executing");
    expect(resumed.current_step_id).toBe("step-1");
  });
});
