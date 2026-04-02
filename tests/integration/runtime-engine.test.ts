import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import type { WorkerRuntimePort, LocalProcessRunInput, LocalProcessRunResult } from "../../src/domain/ports";
import { DeterministicRuntimeEngine } from "../../src/runtime/runtime-engine";
import type {
  AgentRuntimeInvocation,
  AgentRuntimeInvocationResult,
  AgentRuntimePort
} from "../../src/domain/ports";
import type { TaskGraph, VerifyObservation } from "../../src/domain/types";
import { GitWorktreeManager } from "../../src/workers/worktree-manager";

const execFileAsync = promisify(execFile);

class FakeAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.11,
        output: {
          goal: "Ship phase 1",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Implement feature",
              type: "implement",
              action: "Write code",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "inline",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 1
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "Tests pass",
              invariants: [],
              test_scenarios: [
                {
                  name: "tests pass",
                  given: "implementation exists",
                  when: "verification runs",
                  then: "tests pass",
                  priority: "must"
                }
              ],
              verification_approach: "Run tests",
              acceptance_criteria: ["tests pass"]
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 8,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    if (invocation.role === "executor") {
      return {
        sessionId: "executor-session",
        totalCostUsd: 0.21,
        output: {
          summary: "implemented feature",
          artifact_refs: []
        } as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: "passed"
        }
      ],
      generated_artifacts: [],
      summary: "verification passed"
    };

    return {
      sessionId: "verifier-session",
      totalCostUsd: 0.09,
      output: observation as TOutput,
      messages: []
    };
  }
}

class RetryAgentRuntime implements AgentRuntimePort {
  private verifyCount = 0;

  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.11,
        output: {
          goal: "Ship retry path",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Implement feature",
              type: "implement",
              action: "Write code",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "inline",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 2,
              timeout_ms: 60_000
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "Tests pass",
              invariants: [],
              test_scenarios: [
                {
                  name: "tests pass",
                  given: "implementation exists",
                  when: "verification runs",
                  then: "tests pass",
                  priority: "must"
                }
              ],
              verification_approach: "Run tests",
              acceptance_criteria: ["tests pass"]
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 8,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    if (invocation.role === "executor") {
      return {
        sessionId: "executor-session",
        totalCostUsd: 0.2,
        output: {
          summary: "implemented feature",
          artifact_refs: []
        } as TOutput,
        messages: []
      };
    }

    this.verifyCount += 1;
    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: this.verifyCount === 1 ? "failed" : "passed",
          evidence: this.verifyCount === 1 ? "exit 1" : undefined
        }
      ],
      generated_artifacts: [],
      summary: this.verifyCount === 1 ? "verification failed" : "verification passed"
    };

    return {
      sessionId: "verifier-session",
      totalCostUsd: 0.09,
      output: observation as TOutput,
      messages: []
    };
  }
}

class BudgetGateAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.5,
        output: {
          goal: "Trip approval threshold",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Implement feature",
              type: "implement",
              action: "Write code",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "inline",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 1,
              timeout_ms: 60_000
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "Tests pass",
              invariants: [],
              test_scenarios: [
                {
                  name: "tests pass",
                  given: "implementation exists",
                  when: "verification runs",
                  then: "tests pass",
                  priority: "must"
                }
              ],
              verification_approach: "Run tests",
              acceptance_criteria: ["tests pass"]
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 0.6,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    if (invocation.role === "executor") {
      return {
        sessionId: "executor-session",
        totalCostUsd: 0.2,
        output: {
          summary: "implemented feature",
          artifact_refs: []
        } as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "tests pass",
          priority: "must",
          status: "passed"
        }
      ],
      generated_artifacts: [],
      summary: "verification passed"
    };

    return {
      sessionId: "verifier-session",
      totalCostUsd: 0.09,
      output: observation as TOutput,
      messages: []
    };
  }
}

class DelegatedWorkerAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.11,
        output: {
          goal: "Ship delegated work",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Delegate feature",
              type: "implement",
              action: "Delegate the code change",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "delegated",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 1,
              timeout_ms: 60_000
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "File updated",
              invariants: [],
              test_scenarios: [
                {
                  name: "file updated",
                  given: "delegated task completed",
                  when: "verification runs",
                  then: "feature file contains delegated change",
                  priority: "must"
                }
              ],
              verification_approach: "Read the file",
              acceptance_criteria: ["feature file contains delegated change"]
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 8,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    const observation: VerifyObservation = {
      verification_spec_id: "verify-1",
      commands_run: [],
      scenario_results: [
        {
          scenario: "file updated",
          priority: "must",
          status: "passed"
        }
      ],
      generated_artifacts: [],
      summary: "verification passed"
    };

    return {
      sessionId: "verifier-session",
      totalCostUsd: 0.09,
      output: observation as TOutput,
      messages: []
    };
  }
}

class WorkerApprovalAgentRuntime implements AgentRuntimePort {
  async invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>> {
    if (invocation.role === "planner") {
      return {
        sessionId: "planner-session",
        totalCostUsd: 0.11,
        output: {
          goal: "Need teammate approval",
          assumptions: [],
          steps: [
            {
              id: "step-1",
              title: "Delegate gated feature",
              type: "implement",
              action: "Delegate the gated code change",
              dependencies: [],
              preferred_profile: "executor",
              execution_mode: "delegated",
              verification_spec_id: "verify-1",
              done_when: {},
              max_retries: 1,
              timeout_ms: 60_000
            }
          ],
          verification_specs: [
            {
              id: "verify-1",
              related_step_ids: ["step-1"],
              description: "unused",
              invariants: [],
              test_scenarios: [],
              verification_approach: "unused",
              acceptance_criteria: []
            }
          ],
          budget_policy: {
            task_budget_usd: 10,
            step_budget_cap_usd: 5,
            replan_budget_cap_usd: 2,
            teammate_budget_cap_usd: 2,
            approval_threshold_usd: 8,
            hard_stop_threshold_usd: 10
          }
        } as TOutput,
        messages: []
      };
    }

    return {
      sessionId: "noop-session",
      totalCostUsd: 0.01,
      output: {
        verification_spec_id: "verify-1",
        commands_run: [],
        scenario_results: [],
        generated_artifacts: [],
        summary: "noop"
      } as TOutput,
      messages: []
    };
  }
}

class FakeDelegatedWorkerRuntime implements WorkerRuntimePort {
  async run(input: LocalProcessRunInput): Promise<LocalProcessRunResult> {
    const worktreePath = input.args?.[2];
    if (!worktreePath) {
      throw new Error("missing worktree path");
    }

    await writeFile(join(worktreePath, "feature.txt"), "delegated change\n", "utf8");
    return {
      exitCode: 0,
      signal: null
    };
  }
}

describe("DeterministicRuntimeEngine", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it("plans, executes, verifies, and completes a leader-only run", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new FakeAgentRuntime(),
      requirePlanApproval: false
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "build phase 1"
    });

    expect(run.run_status).toBe("Completed");

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog).toContain("\"type\":\"run_planned\"");
    expect(eventLog).toContain("\"type\":\"step_started\"");
    expect(eventLog).toContain("\"type\":\"verification_judged\"");
    expect(eventLog).toContain("\"type\":\"run_completed\"");
  });

  it("retries a failed step when retry budget remains", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new RetryAgentRuntime(),
      requirePlanApproval: false
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "retry the failed step"
    });

    expect(run.run_status).toBe("Completed");

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog.match(/"type":"step_started"/g)?.length).toBe(2);
  });

  it("stops for user approval when spend crosses the approval threshold", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new BudgetGateAgentRuntime(),
      requirePlanApproval: false
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "trip the budget gate"
    });

    expect(run.run_status).toBe("AwaitingUser");
    expect(run.pending_user_request?.kind).toBe("budget_gate");
  });

  it("continues executing after the user approves the initial plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-plan-approval-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new FakeAgentRuntime(),
      requirePlanApproval: true
    });

    const awaitingApproval = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "wait for plan approval"
    });

    expect(awaitingApproval.run_status).toBe("AwaitingApproval");
    expect(awaitingApproval.pending_user_request?.kind).toBe("approval");

    const resumed = await engine.continueRunWithUserResponse("session-1", "run-1", {
      request_id: awaitingApproval.pending_user_request!.id,
      answer: "yes",
      answered_at: "2026-04-02T00:00:00.000Z",
      correlation_id: awaitingApproval.pending_user_request!.correlation_id
    });

    expect(resumed.run_status).toBe("Completed");

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog).toContain("\"type\":\"approval_response\"");
    expect(eventLog).toContain("\"type\":\"step_started\"");
    expect(eventLog).toContain("\"type\":\"run_completed\"");
  });

  it("continues the paused run after the user approves a budget gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-budget-approval-"));
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new BudgetGateAgentRuntime(),
      requirePlanApproval: false
    });

    const awaitingBudgetApproval = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "trip the budget gate"
    });

    expect(awaitingBudgetApproval.run_status).toBe("AwaitingUser");
    expect(awaitingBudgetApproval.pending_user_request?.kind).toBe("budget_gate");

    const resumed = await engine.continueRunWithUserResponse("session-1", "run-1", {
      request_id: awaitingBudgetApproval.pending_user_request!.id,
      answer: "yes",
      answered_at: "2026-04-02T00:00:00.000Z",
      correlation_id: awaitingBudgetApproval.pending_user_request!.correlation_id
    });

    expect(resumed.run_status).toBe("Completed");

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog).toContain("\"type\":\"step_execution_finished\"");
    expect(eventLog).toContain("\"type\":\"verification_judged\"");
    expect(eventLog).toContain("\"type\":\"run_completed\"");
  });

  it("requires approval before applying a delegated patch back to the leader workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-delegated-"));
    roots.push(root);

    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "routing@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Routing Tests"], { cwd: root });
    await writeFile(join(root, "feature.txt"), "base line\n", "utf8");
    await execFileAsync("git", ["add", "feature.txt"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });

    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new DelegatedWorkerAgentRuntime(),
      requirePlanApproval: false,
      workerRuntime: new FakeDelegatedWorkerRuntime(),
      worktreeManager: new GitWorktreeManager(root)
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "delegate the file change"
    });

    expect(run.run_status).toBe("AwaitingUser");
    expect(run.pending_user_request?.kind).toBe("approval");
    expect(run.budget_snapshot.reserved_usd).toBeGreaterThan(0);

    await expect(readFile(join(root, "feature.txt"), "utf8")).resolves.toBe("base line\n");

    const resumed = await engine.continueRunWithUserResponse("session-1", "run-1", {
      request_id: run.pending_user_request!.id,
      answer: "yes",
      answered_at: "2026-04-02T00:00:00.000Z",
      correlation_id: run.pending_user_request!.correlation_id
    });

    expect(resumed.run_status).toBe("Completed");

    await expect(readFile(join(root, "feature.txt"), "utf8")).resolves.toContain(
      "delegated change"
    );

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );

    expect(eventLog).toContain("\"type\":\"task_assignment\"");
    expect(eventLog).toContain("\"type\":\"task_result\"");
  });

  it("forwards teammate approval requests into user-facing runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "routing-runtime-worker-approval-"));
    roots.push(root);

    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "routing@example.com"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Routing Tests"], { cwd: root });
    await writeFile(join(root, "feature.txt"), "base line\n", "utf8");
    await execFileAsync("git", ["add", "feature.txt"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });

    const broker = new FileSystemBroker(root, "session-1", "run-1");
    const engine = new DeterministicRuntimeEngine({
      rootDir: root,
      workspaceDir: root,
      broker,
      agentRuntime: new WorkerApprovalAgentRuntime(),
      requirePlanApproval: false,
      worktreeManager: new GitWorktreeManager(root),
      workerEntryPath: join(process.cwd(), "src", "worker-entry.ts"),
      workerEnv: {
        ...process.env,
        ROUTING_WORKER_APPROVAL_JSON: JSON.stringify({
          id: "worker-approval-1",
          kind: "task_result",
          question: "Apply delegated patch to leader workspace?",
          requester_agent_id: "worker-step-1",
          target: "leader",
          related_run_id: "run-1",
          correlation_id: "corr-worker-1"
        })
      }
    });

    const run = await engine.startRun({
      sessionId: "session-1",
      runId: "run-1",
      goal: "delegate a gated change"
    });

    expect(run.run_status).toBe("AwaitingUser");
    expect(run.pending_user_request?.kind).toBe("approval");
    expect(run.pending_user_request?.source_approval_request_id).toBe("worker-approval-1");
    expect(run.pending_user_request?.correlation_id).toBe("corr-worker-1");
  });
});
