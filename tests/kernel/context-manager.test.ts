import { describe, expect, it } from "vitest";

import { BoundedContextManager } from "../../src/kernel/context-manager";

describe("BoundedContextManager", () => {
  it("keeps the system and user prompts while trimming traces from the tail budget", async () => {
    const manager = new BoundedContextManager(10);

    const prompt = await manager.assemblePrompt({
      systemPrompt: "sys",
      userPrompt: "usr",
      traces: ["abcdef"]
    });

    expect(prompt).toBe("sys\nusr\n\nRecent traces:\ncdef");
  });

  it("omits the trace section when there are no traces", async () => {
    const manager = new BoundedContextManager();

    await expect(
      manager.assemblePrompt({
        systemPrompt: "system",
        userPrompt: "user"
      })
    ).resolves.toBe("system\nuser");
  });
});
