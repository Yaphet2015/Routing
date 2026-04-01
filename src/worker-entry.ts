#!/usr/bin/env bun

import { ClaudeAgentRuntimeAdapter } from "./adapters/claude/claude-agent-runtime";
import { FileSystemBroker } from "./adapters/fs/file-system-broker";
import { WorkerHost } from "./workers/worker-host";

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
    agentRuntime: new ClaudeAgentRuntimeAdapter({
      cwd: workspaceDir,
      model: process.env.ROUTING_MODEL ?? "claude-sonnet-4-6"
    })
  });

  await host.runOnce();
}

void main();
