#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { cwd } from "node:process";
import { randomUUID } from "node:crypto";

import { ClaudeAgentRuntimeAdapter } from "./adapters/claude/claude-agent-runtime";
import type { SessionKernelPort } from "./domain/ports";
import { executeShellCommand } from "./kernel/host-shell";
import { SessionKernel } from "./kernel/session-kernel";
import { ConsoleStatusSink } from "./kernel/console-status-sink";

function parseArgs(argv: string[]): { sessionId: string; resume: boolean } {
  if (argv[2] === "resume" && argv[3]) {
    return { sessionId: argv[3], resume: true };
  }

  return {
    sessionId: randomUUID(),
    resume: false
  };
}

async function main(): Promise<void> {
  const { sessionId, resume } = parseArgs(process.argv);
  const workspaceDir = cwd();
  const kernel: SessionKernelPort = new SessionKernel({
    rootDir: workspaceDir,
    workspaceDir,
    statusSink: new ConsoleStatusSink(),
    agentRuntime: new ClaudeAgentRuntimeAdapter({
      cwd: workspaceDir,
      model: process.env.ROUTING_MODEL ?? "claude-sonnet-4-6"
    }),
    requirePlanApproval: true
  });

  const rl = createInterface({ input, output });
  process.stdout.write(
    [
      "Routing REPL",
      `session: ${sessionId}`,
      "commands: /help, /status, /runs, /attach <run-id>, /pause, /resume, /approve <answer>, /exit"
    ].join("\n") + "\n"
  );

  if (resume) {
    const resumed = await kernel.resumeSession(sessionId);
    process.stdout.write(
      `resumed active run: ${resumed.active_run_id ?? "none"}\n`
    );
    for (const pending of resumed.pending_user_interactions) {
      process.stdout.write(`pending: ${pending.question}\n`);
    }
  }

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) {
      continue;
    }
    if (line === "/exit") {
      break;
    }

    if (line.startsWith("/")) {
      process.stdout.write(
        `${await executeShellCommand(kernel, sessionId, line)}\n`
      );
      continue;
    }

    const result = await kernel.submitUserInput({
      session_id: sessionId,
      text: line
    });

    process.stdout.write(
      `session_status=${result.session_status} active_run=${result.active_run_id ?? "none"}\n`
    );
    if (result.user_interaction_request) {
      process.stdout.write(`${result.user_interaction_request.question}\n`);
    }
  }

  await kernel.closeSession();
  rl.close();
}

void main();
