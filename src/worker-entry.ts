#!/usr/bin/env bun

import { ClaudeAgentRuntimeAdapter } from "./adapters/claude/claude-agent-runtime";
import { FileSystemBroker } from "./adapters/fs/file-system-broker";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort
} from "./domain/ports";
import { WorkerHost } from "./workers/worker-host";

class FixtureWorkerAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    _invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    const approvalRequest = process.env.ROUTING_WORKER_APPROVAL_JSON
      ? JSON.parse(process.env.ROUTING_WORKER_APPROVAL_JSON)
      : undefined;
    const result = process.env.ROUTING_WORKER_RESULT_JSON
      ? JSON.parse(process.env.ROUTING_WORKER_RESULT_JSON)
      : {
          summary: "worker completed",
          artifact_refs: []
        };

    return {
      sessionId: "fixture-worker-session",
      totalCostUsd: 0,
      output: {
        ...result,
        approval_request: approvalRequest
      } as TOutput,
      messages: []
    };
  }
}

async function main(): Promise<void> {
  const [rootDir, workspaceDir, sessionId, runId, agentId] = process.argv.slice(2);
  if (!rootDir || !workspaceDir || !sessionId || !runId || !agentId) {
    throw new Error(
      "Usage: worker-entry.ts <rootDir> <workspaceDir> <sessionId> <runId> <agentId>"
    );
  }

  const broker = new FileSystemBroker(rootDir, sessionId, runId);
  const host = new WorkerHost({
    agentId,
    workspaceDir,
    broker,
    agentRuntime:
      process.env.ROUTING_WORKER_APPROVAL_JSON || process.env.ROUTING_WORKER_RESULT_JSON
        ? new FixtureWorkerAgentRuntime()
        : new ClaudeAgentRuntimeAdapter({
            cwd: workspaceDir,
            model: process.env.ROUTING_MODEL ?? "claude-sonnet-4-6"
          })
  });

  await host.runOnce();
}

void main();
