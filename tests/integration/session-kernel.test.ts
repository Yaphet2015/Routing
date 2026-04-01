import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import { FileSystemRunStateStore, FileSystemSessionStateStore } from "../../src/adapters/fs/state-store";
import { SessionKernel } from "../../src/kernel/session-kernel";
import type { ApprovalRequest } from "../../src/domain/protocol";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort,
  StatusSink
} from "../../src/domain/ports";
import type { TaskGraph, VerifyObservation } from "../../src/domain/types";

class NullStatusSink implements StatusSink {
  public readonly events: string[] = [];

  async onEvent(event: { type: string }): Promise<void> {
    this.events.push(event.type);
  }

  async flush(): Promise<void> {
    return;
  }
}

class ApprovalOnlyAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      const plan: TaskGraph = {
        goal: "Need approval",
        assumptions: [],
        steps: [],
        verification_specs: [],
        budget_policy: {
          task_budget_usd: 10,
          step_budget_cap_usd: 5,
          replan_budget_cap_usd: 2,
          teammate_budget_cap_usd: 2,
          approval_threshold_usd: 8,
          hard_stop_threshold_usd: 10
        }
      };
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.05,
        output: plan as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [],
      generated_artifacts: [],
      summary: "noop"
    };

    return {
      sessionId: "noop-session",
      totalCostUsd: 0.01,
      output: observation as TOutput,
      messages: []
    };
  }
}

describe("SessionKernel", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("persists an awaiting-approval run and restores it on resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-kernel-"));
    roots.push(root);

    const kernel = new SessionKernel({
      rootDir: root,
      workspaceDir: root,
      statusSink: new NullStatusSink(),
      agentRuntime: new ApprovalOnlyAgentRuntime(),
      requirePlanApproval: true
    });

    const turn = await kernel.submitUserInput({
      session_id: "session-1",
      text: "start planning"
    });

    expect(turn.session_status).toBe("AwaitingUser");
    expect(turn.user_interaction_request?.kind).toBe("approval");

    const resumed = await kernel.resumeSession("session-1");
    expect(resumed.active_run_id).toBe("run-1");
    expect(resumed.pending_user_interactions).toHaveLength(1);
    expect(resumed.pending_user_interactions[0]?.correlation_id).toBe(
      turn.user_interaction_request?.correlation_id
    );
  });

  it("maps approval requests to user interaction and preserves correlation on response", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-kernel-"));
    roots.push(root);

    const kernel = new SessionKernel({
      rootDir: root,
      workspaceDir: root,
      statusSink: new NullStatusSink(),
      agentRuntime: new ApprovalOnlyAgentRuntime(),
      requirePlanApproval: true
    });

    await kernel.submitUserInput({
      session_id: "session-1",
      text: "start planning"
    });

    const approvalRequest: ApprovalRequest = {
      id: "approval-1",
      kind: "task_result",
      question: "Accept task result?",
      requester_agent_id: "leader",
      target: "user",
      related_run_id: "run-1",
      correlation_id: "corr-1"
    };

    const interaction = await kernel.registerApprovalRequest("session-1", "run-1", approvalRequest);
    expect(interaction.source_approval_request_id).toBe("approval-1");
    expect(interaction.correlation_id).toBe("corr-1");

    await kernel.submitUserInput({
      session_id: "session-1",
      target_run_id: "run-1",
      text: "approve"
    });

    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const replayedTypes: string[] = [];
    for await (const event of broker.replay()) {
      replayedTypes.push(event.type);
    }

    expect(replayedTypes).toContain("approval_response");
  });
});
