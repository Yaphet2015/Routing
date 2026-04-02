import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort
} from "../../domain/ports";
import type { TaskGraph, VerifyObservation } from "../../domain/types";

const mockPlan: TaskGraph = {
  goal: "Mock routing smoke task",
  assumptions: [
    "Claude Agent SDK is mocked for this run",
    "The goal is to validate the REPL control flow"
  ],
  steps: [
    {
      id: "step-1",
      title: "Execute mock implementation",
      type: "implement",
      action: "Simulate executor work for the REPL smoke flow",
      dependencies: [],
      preferred_profile: "executor",
      execution_mode: "inline",
      verification_spec_id: "verify-1",
      done_when: {},
      max_retries: 1,
      timeout_ms: 30_000
    }
  ],
  verification_specs: [
    {
      id: "verify-1",
      related_step_ids: ["step-1"],
      description: "The mocked verification path reports success",
      invariants: ["The runtime reaches completion without Claude credentials"],
      test_scenarios: [
        {
          name: "mock verification passes",
          given: "the executor returns a mock result",
          when: "the verifier evaluates the step",
          then: "the scenario is marked passed",
          priority: "must"
        }
      ],
      verification_approach: "Simulate a verifier response",
      acceptance_criteria: ["The run reaches Completed state"]
    }
  ],
  budget_policy: {
    task_budget_usd: 1,
    step_budget_cap_usd: 1,
    replan_budget_cap_usd: 1,
    teammate_budget_cap_usd: 1,
    approval_threshold_usd: 1,
    hard_stop_threshold_usd: 2
  }
};

export class MockAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "mock-planner-session",
        totalCostUsd: 0,
        output: mockPlan as TOutput,
        messages: []
      };
    }

    if (invocation.role === "executor") {
      return {
        sessionId: "mock-executor-session",
        totalCostUsd: 0,
        output: {
          summary: "mock executor completed the smoke task",
          artifact_refs: []
        } as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [
        {
          command: "mock:verify",
          exit_code: 0
        }
      ],
      scenario_results: [
        {
          scenario: "mock verification passes",
          priority: "must",
          status: "passed",
          evidence: "mock verifier returned success"
        }
      ],
      generated_artifacts: [],
      summary: "mock verification passed"
    };

    return {
      sessionId: `mock-${invocation.role}-session`,
      totalCostUsd: 0,
      output: observation as TOutput,
      messages: []
    };
  }
}
