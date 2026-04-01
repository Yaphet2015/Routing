import { describe, expect, it } from "vitest";

import { executeShellCommand } from "../../src/kernel/host-shell";
import type {
  KernelTurnResult,
  ResumeResult,
  SessionKernelPort,
  SessionOverview
} from "../../src/domain/ports";
import type { RunState } from "../../src/domain/types";

class FakeKernel implements SessionKernelPort {
  public readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async submitUserInput(input: {
    session_id: string;
    text: string;
    target_run_id?: string;
  }): Promise<KernelTurnResult> {
    this.calls.push({ method: "submitUserInput", args: [input] });
    return {
      session_status: "AwaitingUser",
      active_run_id: "run-1",
      emitted_event_ids: [],
      user_interaction_request: {
        id: "req-1",
        kind: "approval",
        question: "approve?",
        timeout_policy: "wait",
        correlation_id: "corr-1"
      }
    };
  }

  async attachRun(sessionId: string, runId: string): Promise<void> {
    this.calls.push({ method: "attachRun", args: [sessionId, runId] });
  }

  async interruptCurrentTurn(reason: string): Promise<void> {
    this.calls.push({ method: "interruptCurrentTurn", args: [reason] });
  }

  async resumeSession(sessionId: string): Promise<ResumeResult> {
    this.calls.push({ method: "resumeSession", args: [sessionId] });
    return {
      session_status: "Active",
      restored_run_ids: ["run-1"],
      active_run_id: "run-1",
      pending_user_interactions: []
    };
  }

  async closeSession(): Promise<void> {
    this.calls.push({ method: "closeSession", args: [] });
  }

  async getSessionOverview(sessionId: string): Promise<SessionOverview> {
    this.calls.push({ method: "getSessionOverview", args: [sessionId] });
    return {
      session_id: "session-1",
      session_status: "Active",
      active_run_id: "run-1",
      run_ids: ["run-1", "run-2"],
      runs: [
        { run_id: "run-1", run_status: "AwaitingUser" },
        { run_id: "run-2", run_status: "Completed" }
      ],
      pending_user_interactions: ["approve?"]
    };
  }

  async pauseRun(sessionId: string, runId?: string): Promise<RunState> {
    this.calls.push({ method: "pauseRun", args: [sessionId, runId] });
    return makeRunState("Paused");
  }

  async resumeRun(sessionId: string, runId?: string): Promise<RunState> {
    this.calls.push({ method: "resumeRun", args: [sessionId, runId] });
    return makeRunState("Executing");
  }
}

function makeRunState(status: RunState["run_status"]): RunState {
  return {
    session_id: "session-1",
    run_id: "run-1",
    run_status: status,
    plan_version: 1,
    active_task_ids: [],
    budget_snapshot: {
      policy: {
        task_budget_usd: 10,
        step_budget_cap_usd: 5,
        replan_budget_cap_usd: 2,
        teammate_budget_cap_usd: 2,
        approval_threshold_usd: 8,
        hard_stop_threshold_usd: 10
      },
      spent_usd: 0,
      reserved_usd: 0,
      remaining_usd: 10,
      ledger: []
    },
    last_event_seq: 0
  };
}

describe("host-shell", () => {
  it("renders status and run listings from session overview", async () => {
    const kernel = new FakeKernel();

    const status = await executeShellCommand(kernel, "session-1", "/status");
    const runs = await executeShellCommand(kernel, "session-1", "/runs");

    expect(status).toContain("session=session-1");
    expect(status).toContain("active_run=run-1");
    expect(runs).toContain("run-1: AwaitingUser");
    expect(runs).toContain("run-2: Completed");
  });

  it("routes attach, pause, resume, and approve commands to the kernel", async () => {
    const kernel = new FakeKernel();

    await executeShellCommand(kernel, "session-1", "/attach run-2");
    await executeShellCommand(kernel, "session-1", "/pause");
    await executeShellCommand(kernel, "session-1", "/resume");
    await executeShellCommand(kernel, "session-1", "/approve yes");

    expect(kernel.calls).toEqual([
      { method: "attachRun", args: ["session-1", "run-2"] },
      { method: "pauseRun", args: ["session-1", undefined] },
      { method: "resumeRun", args: ["session-1", undefined] },
      { method: "getSessionOverview", args: ["session-1"] },
      {
        method: "submitUserInput",
        args: [{ session_id: "session-1", text: "yes", target_run_id: "run-1" }]
      }
    ]);
  });
});
