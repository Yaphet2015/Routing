import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage
} from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";

import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort,
  AgentRole
} from "../../domain/ports";

type QueryFunction = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

interface ClaudeAgentRuntimeAdapterOptions {
  cwd: string;
  model: string;
  queryFn?: QueryFunction;
}

function systemPromptForRole(role: AgentRole): string {
  switch (role) {
    case "planner":
      return [
        "You are the planner for a leader-only protocol-ready coding runtime.",
        "Return strictly valid JSON matching the requested schema.",
        "Do not execute tools beyond planning-level inspection."
      ].join("\n");
    case "executor":
      return [
        "You are the executor for a deterministic runtime.",
        "Perform the requested implementation work and return only valid JSON."
      ].join("\n");
    case "verifier":
      return [
        "You are the verifier for a deterministic runtime.",
        "Observe and report evidence only. Return valid JSON."
      ].join("\n");
    case "leader":
      return [
        "You are the leader orchestrator.",
        "Summarize and coordinate, but return only valid JSON."
      ].join("\n");
    default:
      throw new Error(`Unsupported role: ${role satisfies never}`);
  }
}

function queryOptionsForRole(
  base: ClaudeAgentRuntimeAdapterOptions,
  role: AgentRole,
  sessionId?: string
): Options {
  const common: Options = {
    cwd: base.cwd,
    model: base.model,
    maxTurns: role === "planner" ? 6 : 8,
    permissionMode: role === "planner" ? "plan" : "acceptEdits",
    allowedTools:
      role === "verifier"
        ? ["Read", "Glob", "Grep", "LS", "Bash"]
        : undefined,
    disallowedTools:
      role === "verifier" ? ["Edit", "Write", "MultiEdit"] : undefined
  };

  if (sessionId) {
    common.resume = sessionId;
  }

  return common;
}

function isResultMessage(message: SDKMessage): message is SDKResultMessage {
  return message.type === "result";
}

function isSuccessfulResult(
  message: SDKResultMessage
): message is Extract<SDKResultMessage, { subtype: "success" }> {
  return message.subtype === "success" && message.is_error === false;
}

export class ClaudeAgentRuntimeAdapter implements AgentRuntimePort {
  private readonly queryFn: QueryFunction;

  constructor(private readonly options: ClaudeAgentRuntimeAdapterOptions) {
    this.queryFn = options.queryFn ?? query;
  }

  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    const prompt = [
      systemPromptForRole(invocation.role),
      "",
      invocation.prompt,
      "",
      "Return JSON only."
    ].join("\n");

    const messages: SDKMessage[] = [];
    const runQuery = this.queryFn({
      prompt,
      options: queryOptionsForRole(
        this.options,
        invocation.role,
        invocation.sessionId
      )
    });

    let resultMessage: SDKResultMessage | undefined;
    for await (const message of runQuery) {
      messages.push(message);
      if (isResultMessage(message)) {
        resultMessage = message;
      }
    }

    if (!resultMessage || !isSuccessfulResult(resultMessage)) {
      throw new Error("Claude Agent SDK invocation failed");
    }

    const rawOutput =
      resultMessage.structured_output ??
      JSON.parse(resultMessage.result || "{}");

    return {
      sessionId: resultMessage.session_id,
      totalCostUsd: resultMessage.total_cost_usd,
      output: invocation.schema.parse(rawOutput),
      messages
    };
  }
}
