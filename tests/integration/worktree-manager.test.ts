import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GitWorktreeManager } from "../../src/workers/worktree-manager";

const execFileAsync = promisify(execFile);

describe("GitWorktreeManager", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("creates and cleans up an isolated git worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-worktree-"));
    roots.push(root);

    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "routing@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Routing Tests"], { cwd: root });
    await writeFile(join(root, "README.md"), "# worktree test\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });

    const manager = new GitWorktreeManager(root);
    const worktree = await manager.create("run-1", "task-1");

    await expect(readFile(join(worktree.path, "README.md"), "utf8")).resolves.toContain(
      "worktree test"
    );
    expect(worktree.baseCommit).toMatch(/[0-9a-f]{40}/);

    await manager.remove(worktree.path);

    await expect(readFile(join(worktree.path, "README.md"), "utf8")).rejects.toThrow();
  });
});
