import type { ContextManager } from "../domain/ports";

export class BoundedContextManager implements ContextManager {
  constructor(private readonly maxChars = 12000) {}

  async assemblePrompt(input: {
    systemPrompt: string;
    userPrompt: string;
    traces?: string[];
  }): Promise<string> {
    const traceBlock = (input.traces ?? [])
      .join("\n")
      .slice(-Math.max(this.maxChars - input.systemPrompt.length - input.userPrompt.length, 0));

    return [
      input.systemPrompt,
      "",
      input.userPrompt,
      traceBlock ? `\nRecent traces:\n${traceBlock}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
}
