import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort
} from "../../src/domain/ports";
import { WorkerHost } from "../../src/workers/worker-host";
import type { BrokerMessage } from "../../src/domain/protocol";
import type { CollaborationTask } from "../../src/domain/types";

class FakeWorkerAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    _invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    return {
      sessionId: "worker-session",
      totalCostUsd: 0.2,
      output: {
        summary: "worker completed the delegated task",
        artifact_refs: [
          {
            id: "artifact-1",
            kind: "summary",
            producer_agent_id: "worker-1",
            produced_at: "2026-04-02T00:00:00.000Z",
            summary: "delegated summary"
          }
        ]
      } as TOutput,
      messages: []
    };
  }
}

function makeTask(taskId: string): CollaborationTask {
  return {
    id: taskId,
    run_id: "run-1",
    source_step_ids: ["step-1"],
    title: "Execute step",
    objective: "Do the delegated work",
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

function makeAssignment(messageId: string): BrokerMessage {
  return {
    type: "task_assignment",
    message_id: messageId,
    seq: 0,
    session_id: "session-1",
    run_id: "run-1",
    from_agent_id: "leader",
    to_agent_id: "worker-1",
    created_at: "2026-04-02T00:00:00.000Z",
    task: makeTask("task-1")
  };
}

describe("WorkerHost", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("claims, runs, and reports a delegated task through the broker", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-worker-host-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");

    await broker.publish(makeAssignment("message-1"));
    await broker.deliver("message-1");

    const host = new WorkerHost({
      agentId: "worker-1",
      workspaceDir: root,
      broker,
      agentRuntime: new FakeWorkerAgentRuntime()
    });

    const handled = await host.runOnce();
    expect(handled).toBe(true);

    const replayedTypes: string[] = [];
    for await (const event of broker.replay()) {
      replayedTypes.push(event.type);
    }

    expect(replayedTypes).toContain("task_claim");
    expect(replayedTypes).toContain("status_update");
    expect(replayedTypes).toContain("task_result");
    expect(replayedTypes).toContain("artifact_published");
  });
});
