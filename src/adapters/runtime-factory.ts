import type { AgentRuntimePort } from "../domain/ports";
import { ClaudeAgentRuntimeAdapter } from "./claude/claude-agent-runtime";
import { MockAgentRuntime } from "./mock/mock-agent-runtime";

interface CreateAgentRuntimeOptions {
  cwd: string;
  model: string;
}

export function createAgentRuntime(
  options: CreateAgentRuntimeOptions
): AgentRuntimePort {
  if (process.env.ROUTING_AGENT_RUNTIME?.toLowerCase() === "mock") {
    return new MockAgentRuntime();
  }

  return new ClaudeAgentRuntimeAdapter(options);
}
