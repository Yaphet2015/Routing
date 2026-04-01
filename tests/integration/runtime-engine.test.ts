import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import { DeterministicRuntimeEngine } from "../../src/runtime/runtime-engine";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort
} from "../../src/domain/ports";
import type { TaskGraph, VerifyObservation } from "../../src/domain/types";

class FakeAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.11,
        output: {
          goal: "Ship phase 1",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Implement feature",
              type: "implement",
              action: "Write code",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "inline",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 1
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "Tests pass",
              invariants: [],
              test_scenarios: [
                {
                  name: "tests pass",
                  given: "implementation exists",
                  when: "verification runs",
                  then: "tests pass",
                  priority: "must"
                }
              ],
              verification_approach: "Run tests",
              acceptance_criteria: ["tests pass"]
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 8,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    if (invocation.role === "executor") {
      return {
        sessionId: "executor-session",
        totalCostUsd: 0.21,
        output: {
          summary: "implemented feature",
          artifact_refs: []
        } as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: "passed"
        }
      ],
      generated_artifacts: [],
      summary: "verification passed"
    };

    return {
      sessionId: "verifier-session",
      totalCostUsd: 0.09,
      output: observation as TOutput,
      messages: []
    };
  }
}

describe("DeterministicRuntimeEngine", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("plans, executes, verifies, and completes a leader-only run", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new FakeAgentRuntime(),
      requirePlanApproval: false
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "build phase 1"
    });

    expect(run.run_status).toBe("Completed");

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog).toContain("\"type\":\"run_planned\"");
    expect(eventLog).toContain("\"type\":\"step_started\"");
    expect(eventLog).toContain("\"type\":\"verification_judged\"");
    expect(eventLog).toContain("\"type\":\"run_completed\"");
  });
});
