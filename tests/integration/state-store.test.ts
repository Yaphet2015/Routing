import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileSystemRunStateStore,
  FileSystemSessionStateStore
} from "../../src/adapters/fs/state-store";
import { createRunState } from "../../src/runtime/state-machine";
import type { SessionStateStoreRecord } from "../../src/domain/protocol";

describe("state store", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true }))
    );
    roots.length = 0;
  });

  it("persists and restores active run session state", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-state-"));
    roots.push(root);

    const sessionStore = new FileSystemSessionStateStore(root, "session-1");
    const runStore = new FileSystemRunStateStore(root, "session-1", "run-1");

    const session: SessionStateStoreRecord = {
      session_id: "session-1",
      session_status: "Active",
      active_run_id: "run-1",
      run_ids: ["run-1"],
      compact_boundary_seq: 0
    };
    const run = createRunState("session-1", "run-1", {
      task_budget_usd: 10,
      step_budget_cap_usd: 5,
      replan_budget_cap_usd: 2,
      teammate_budget_cap_usd: 2,
      approval_threshold_usd: 8,
      hard_stop_threshold_usd: 10
    });

    await sessionStore.save(session);
    await runStore.save(run);

    await expect(sessionStore.load()).resolves.toEqual(session);
    await expect(runStore.load()).resolves.toEqual(run);
  });
});
