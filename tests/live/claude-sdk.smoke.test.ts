import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ClaudeAgentRuntimeAdapter } from "../../src/adapters/claude/claude-agent-runtime";

const hasLiveCredentials = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!hasLiveCredentials)("Claude Agent SDK smoke", () => {
  it("returns structured planner output from the live SDK", async () => {
    const adapter = new ClaudeAgentRuntimeAdapter({
      cwd: process.cwd(),
      model: process.env.ROUTING_MODEL ?? "claude-sonnet-4-6"
    });

    const result = await adapter.invoke({
      role: "planner",
      prompt: "Return goal='smoke', assumptions=[], steps=[], verification_specs=[], budget_policy with small numeric values.",
      schema: z.object({
        goal: z.string(),
        assumptions: z.array(z.string()),
        steps: z.array(z.unknown()),
        verification_specs: z.array(z.unknown()),
        budget_policy: z.object({
          task_budget_usd: z.number(),
          step_budget_cap_usd: z.number(),
          replan_budget_cap_usd: z.number(),
          teammate_budget_cap_usd: z.number(),
          approval_threshold_usd: z.number(),
          hard_stop_threshold_usd: z.number()
        })
      })
    });

    expect(result.output.goal).toBe("smoke");
    expect(result.output.steps).toEqual([]);
  });
});
