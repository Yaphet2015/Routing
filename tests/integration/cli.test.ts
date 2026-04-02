import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

interface RunningCli {
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly send: (line: string) => void;
  readonly stop: () => Promise<number | null>;
}

function startCli(
  cwd: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): RunningCli {
  const child = spawn("bun", [join(process.cwd(), "src", "cli.ts"), ...args], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    send: (line: string) => {
      child.stdin.write(`${line}\n`);
    },
    stop: async () =>
      await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
        child.stdin.end();
      })
  };
}

async function waitForOutput(
  cli: RunningCli,
  pattern: RegExp,
  timeoutMs = 15_000
): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const output = cli.stdout();
    if (pattern.test(output)) {
      return output;
    }

    const stderr = cli.stderr();
    if (stderr) {
      throw new Error(`CLI stderr:\n${stderr}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${pattern}.\nstdout:\n${cli.stdout()}\nstderr:\n${cli.stderr()}`);
}

describe("CLI integration", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("runs the mock runtime flow through approval, execution, verification, and resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-cli-"));
    roots.push(root);

    const cli = startCli(root, [], {
      ...process.env,
      ROUTING_AGENT_RUNTIME: "mock"
    });

    const boot = await waitForOutput(cli, /Routing REPL[\s\S]*session: ([a-z0-9-]+)/i);
    const sessionIdMatch = boot.match(/session: ([a-z0-9-]+)/i);
    expect(sessionIdMatch?.[1]).toBeTruthy();
    const sessionId = sessionIdMatch![1];

    cli.send("run the smoke flow");
    const awaitingApproval = await waitForOutput(
      cli,
      /session_status=AwaitingUser active_run=run-1[\s\S]*Approve plan for: Mock routing smoke task\?/i
    );
    expect(awaitingApproval).toContain("session_status=AwaitingUser active_run=run-1");

    cli.send("/approve yes");
    const approved = await waitForOutput(cli, /submitted approval for run-1/);
    expect(approved).toContain("submitted approval for run-1");

    cli.send("/exit");
    await expect(cli.stop()).resolves.toBe(0);

    const eventLog = await readFile(
      join(root, ".harness", "sessions", sessionId, "runs", "run-1", "events", "events.ndjson"),
      "utf8"
    );
    expect(eventLog).toContain("\"type\":\"run_planned\"");
    expect(eventLog).toContain("\"type\":\"approval_response\"");
    expect(eventLog).toContain("\"type\":\"step_started\"");
    expect(eventLog).toContain("\"type\":\"verification_judged\"");
    expect(eventLog).toContain("\"type\":\"run_completed\"");

    const resumedCli = startCli(
      root,
      ["resume", sessionId],
      {
        ...process.env,
        ROUTING_AGENT_RUNTIME: "mock"
      }
    );
    const resumed = await waitForOutput(resumedCli, /resumed active run: run-1/i);
    expect(resumed).toContain("resumed active run: run-1");

    resumedCli.send("/exit");
    await expect(resumedCli.stop()).resolves.toBe(0);
  }, 20_000);
});
