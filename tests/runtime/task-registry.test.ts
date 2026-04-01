import { describe, expect, it } from "vitest";

import {
  applyBrokerMessageToTaskRegistry,
  createTaskRegistrySnapshot,
  registerCollaborationTask
} from "../../src/runtime/task-registry";
import type { BrokerMessage } from "../../src/domain/protocol";
import type { CollaborationTask, TaskGraph } from "../../src/domain/types";

function makeGraph(): TaskGraph {
  return {
    goal: "delegate feature",
    assumptions: [],
    steps: [
      {
        id: "step-1",
        title: "Delegate feature",
        type: "implement",
        action: "Do the work",
        dependencies: [],
        preferred_profile: "executor",
        execution_mode: "delegated",
        verification_spec_id: "verify-1",
        done_when: {},
        max_retries: 1,
        timeout_ms: 60_000
      }
    ],
    verification_specs: [
      {
        id: "verify-1",
        related_step_ids: ["step-1"],
        description: "done",
        invariants: [],
        test_scenarios: [],
        verification_approach: "unused",
        acceptance_criteria: []
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
  };
}

function makeTask(): CollaborationTask {
  return {
    id: "task-1",
    run_id: "run-1",
    source_step_ids: ["step-1"],
    title: "Delegate feature",
    objective: "Do the work",
    required_profile: "executor",
    owner_policy: "assignable",
    runtime_placement: "local_process",
    isolation_mode: "worktree",
    dependencies: [],
    input_artifacts: [],
    acceptance_ref: {
      verification_spec_ids: ["verify-1"],
      done_when: {}
    },
    status: "Pending",
    timeout_ms: 60_000
  };
}

describe("task-registry projection", () => {
  it("rebuilds task ownership and result artifacts from broker messages", () => {
    let snapshot = createTaskRegistrySnapshot("run-1", 1, makeGraph());
    snapshot = registerCollaborationTask(snapshot, makeTask());

    const claim: BrokerMessage = {
      type: "task_claim",
      message_id: "claim-1",
      seq: 1,
      session_id: "session-1",
      run_id: "run-1",
      from_agent_id: "worker-1",
      to_agent_id: "leader",
      created_at: "2026-04-02T00:00:00.000Z",
      task_id: "task-1"
    };
    const result: BrokerMessage = {
      type: "task_result",
      message_id: "result-1",
      seq: 2,
      session_id: "session-1",
      run_id: "run-1",
      from_agent_id: "worker-1",
      to_agent_id: "leader",
      created_at: "2026-04-02T00:00:01.000Z",
      task_id: "task-1",
      artifact_refs: [
        {
          id: "artifact-1",
          kind: "summary",
          producer_agent_id: "worker-1",
          produced_at: "2026-04-02T00:00:01.000Z",
          summary: "delegated summary"
        }
      ],
      summary: "done"
    };

    snapshot = applyBrokerMessageToTaskRegistry(snapshot, claim);
    snapshot = applyBrokerMessageToTaskRegistry(snapshot, result);

    expect(snapshot.task_claims["task-1"]).toEqual({
      task_id: "task-1",
      owner_agent_id: "worker-1",
      claimed_at: "2026-04-02T00:00:00.000Z",
      last_result_artifact_ids: ["artifact-1"]
    });
    expect(snapshot.collab_tasks["task-1"]?.status).toBe("Completed");
    expect(snapshot.artifacts["artifact-1"]?.producer_agent_id).toBe("worker-1");
  });
});
