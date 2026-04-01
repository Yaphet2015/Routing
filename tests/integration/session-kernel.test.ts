import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import { FileSystemRunStateStore, FileSystemSessionStateStore } from "../../src/adapters/fs/state-store";
import { PROTOCOL_VERSION } from "../../src/domain/protocol";
import { SessionKernel } from "../../src/kernel/session-kernel";
import type { ApprovalRequest } from "../../src/domain/protocol";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort,
  StatusSink
} from "../../src/domain/ports";
import type { BudgetPolicy, RunState, TaskGraph, VerifyObservation } from "../../src/domain/types";
import { createRunState } from "../../src/runtime/state-machine";

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

const budgetPolicy: BudgetPolicy = {
  task_budget_usd: 10,
  step_budget_cap_usd: 5,
  replan_budget_cap_usd: 2,
  teammate_budget_cap_usd: 2,
  approval_threshold_usd: 8,
  hard_stop_threshold_usd: 10
};

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

  it("attaches a historical run and updates the active run pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-kernel-"));
    roots.push(root);

    const sessionStore = new FileSystemSessionStateStore(root, "session-1");
    const run1Store = new FileSystemRunStateStore(root, "session-1", "run-1");
    const run2Store = new FileSystemRunStateStore(root, "session-1", "run-2");

    await sessionStore.save({
      session_id: "session-1",
      session_status: "Active",
      active_run_id: "run-1",
      run_ids: ["run-1", "run-2"],
      compact_boundary_seq: 0
    });
    await run1Store.save(createRunState("session-1", "run-1", budgetPolicy));
    await run2Store.save(createRunState("session-1", "run-2", budgetPolicy));

    const kernel = new SessionKernel({
      rootDir: root,
      workspaceDir: root,
      statusSink: new NullStatusSink(),
      agentRuntime: new ApprovalOnlyAgentRuntime(),
      requirePlanApproval: true
    });

    await kernel.attachRun("session-1", "run-2");

    await expect(sessionStore.load()).resolves.toMatchObject({
      active_run_id: "run-2"
    });
  });

  it("pauses and resumes the active run", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-kernel-"));
    roots.push(root);

    const sessionStore = new FileSystemSessionStateStore(root, "session-1");
    const runStore = new FileSystemRunStateStore(root, "session-1", "run-1");
    const running: RunState = {
      ...createRunState("session-1", "run-1", budgetPolicy),
      run_status: "Executing",
      current_step_id: "step-1",
      current_step_attempt: 1
    };

    await sessionStore.save({
      session_id: "session-1",
      session_status: "Active",
      active_run_id: "run-1",
      run_ids: ["run-1"],
      compact_boundary_seq: 0
    });
    await runStore.save(running);

    const kernel = new SessionKernel({
      rootDir: root,
      workspaceDir: root,
      statusSink: new NullStatusSink(),
      agentRuntime: new ApprovalOnlyAgentRuntime(),
      requirePlanApproval: true
    });

    const paused = await kernel.pauseRun("session-1");
    expect(paused.run_status).toBe("Paused");

    const resumed = await kernel.resumeRun("session-1");
    expect(resumed.run_status).toBe("Executing");
  });

  it("rejects session resume when the active run protocol version is incompatible", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-kernel-"));
    roots.push(root);

    const sessionStore = new FileSystemSessionStateStore(root, "session-1");
    await sessionStore.save({
      session_id: "session-1",
      session_status: "Resumable",
      active_run_id: "run-1",
      run_ids: ["run-1"],
      compact_boundary_seq: 0
    });

    const broker = new FileSystemBroker(root, "session-1", "run-1");
    await broker.publish({
      type: "status_update",
      message_id: "message-1",
      seq: 0,
      session_id: "session-1",
      run_id: "run-1",
      from_agent_id: "leader",
      to_agent_id: "leader",
      created_at: "2026-04-02T00:00:00.000Z",
      status: "Running"
    });

    const eventsPath = join(
      root,
      ".harness",
      "sessions",
      "session-1",
      "runs",
      "run-1",
      "events",
      "events.ndjson"
    );
    const raw = await readFile(eventsPath, "utf8");
    await writeFile(
      eventsPath,
      raw.replace(PROTOCOL_VERSION, "routing/test-incompatible"),
      "utf8"
    );

    const kernel = new SessionKernel({
      rootDir: root,
      workspaceDir: root,
      statusSink: new NullStatusSink(),
      agentRuntime: new ApprovalOnlyAgentRuntime(),
      requirePlanApproval: true
    });

    await expect(kernel.resumeSession("session-1")).rejects.toThrow(
      "Unsupported protocol version"
    );
  });
});
