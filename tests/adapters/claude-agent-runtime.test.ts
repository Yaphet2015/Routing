import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ClaudeAgentRuntimeAdapter } from "../../src/adapters/claude/claude-agent-runtime";

describe("ClaudeAgentRuntimeAdapter", () => {
  it("invokes query with role-specific options and returns structured output", async () => {
    const queryMock = vi.fn(() => {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            duration_ms: 10,
            duration_api_ms: 5,
            num_turns: 1,
            result: "",
            stop_reason: null,
            total_cost_usd: 0.12,
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            },
            modelUsage: {},
            permission_denials: [],
            structured_output: {
              ok: true
            },
            uuid: "msg-1",
            session_id: "sdk-session-1"
          };
        }
      };
    });

    const adapter = new ClaudeAgentRuntimeAdapter({
      cwd: "/tmp/project",
      model: "claude-sonnet-4-6",
      queryFn: queryMock as never
    });

    const result = await adapter.invoke({
      role: "planner",
      prompt: "plan this task",
      schema: z.object({
        ok: z.boolean()
      })
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect((queryMock.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0]).toMatchObject({
      prompt: expect.stringContaining("plan this task"),
      options: expect.objectContaining({
        cwd: "/tmp/project",
        model: "claude-sonnet-4-6",
        maxTurns: 6,
        permissionMode: "plan"
      })
    });
    expect(result).toMatchObject({
      sessionId: "sdk-session-1",
      totalCostUsd: 0.12,
      output: {
        ok: true
      }
    });
  });

  it("parses JSON from result text when structured output is absent", async () => {
    const queryMock = vi.fn(() => {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            duration_ms: 10,
            duration_api_ms: 5,
            num_turns: 1,
            result: "{\"value\":\"done\"}",
            stop_reason: null,
            total_cost_usd: 0.05,
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            },
            modelUsage: {},
            permission_denials: [],
            uuid: "msg-1",
            session_id: "sdk-session-2"
          };
        }
      };
    });

    const adapter = new ClaudeAgentRuntimeAdapter({
      cwd: "/tmp/project",
      model: "claude-sonnet-4-6",
      queryFn: queryMock as never
    });

    const result = await adapter.invoke({
      role: "executor",
      prompt: "execute step",
      schema: z.object({
        value: z.string()
      }),
      sessionId: "sdk-session-1"
    });

    expect((queryMock.mock.calls as unknown as Array<[Record<string, { options?: unknown }>] >)[0]?.[0]?.options).toMatchObject({
      resume: "sdk-session-1",
      permissionMode: "acceptEdits"
    });
    expect(result.output.value).toBe("done");
  });
});
