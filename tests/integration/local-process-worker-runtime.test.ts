import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalProcessWorkerRuntime } from "../../src/workers/local-process-worker-runtime";

describe("LocalProcessWorkerRuntime", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("launches a worker process and waits for it to exit cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-worker-process-"));
    roots.push(root);
    const outputPath = join(root, "worker-output.txt");

    const runtime = new LocalProcessWorkerRuntime();
    const result = await runtime.run({
      command: "/bin/sh",
      args: ["-c", `printf 'worker-ok' > '${outputPath}'`],
      cwd: root
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(outputPath, "utf8")).resolves.toBe("worker-ok");
  });
});
