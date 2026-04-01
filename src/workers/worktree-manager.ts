import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { WorktreeLease, WorktreeManagerPort } from "../domain/ports";

const execFileAsync = promisify(execFile);

export class GitWorktreeManager implements WorktreeManagerPort {
  constructor(
    private readonly repoRoot: string,
    private readonly worktreeRoot = join(repoRoot, ".harness", "worktrees")
  ) {}

  async create(runId: string, taskId: string): Promise<WorktreeLease> {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: this.repoRoot
    });
    const baseCommit = stdout.trim();
    const path = join(this.worktreeRoot, `${runId}-${taskId}`);

    await execFileAsync("git", ["worktree", "add", "--detach", path, baseCommit], {
      cwd: this.repoRoot
    });

    return {
      path,
      baseCommit
    };
  }

  async remove(path: string): Promise<void> {
    await execFileAsync("git", ["worktree", "remove", "--force", path], {
      cwd: this.repoRoot
    });
  }
}
