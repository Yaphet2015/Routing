import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { FileSystemRunStateStore } from "../adapters/fs/state-store";
import { writeJsonAtomic } from "../adapters/fs/file-utils";
import type { ApprovalRequest, RuntimeEvent } from "../domain/protocol";
import type {
  AgentRuntimePort,
  BrokerPort,
  WorktreeManagerPort,
  WorkerRuntimePort,
  RuntimeEnginePort,
  RuntimeStartInput
} from "../domain/ports";
import type {
  ArtifactRef,
  CollaborationTask,
  PlanStep,
  RunState,
  TaskGraph,
  UserInteractionRequest,
  UserInteractionResponse,
  VerifyObservation
} from "../domain/types";
import { reserveBudget, debitBudget } from "./budget";
import {
  beginRunExecution,
  createEmptyStepState,
  createRunState,
  markStepFailed,
  markStepPassed,
  selectNextExecutableStep
} from "./state-machine";
import {
  applyBrokerMessageToTaskRegistry,
  createTaskRegistrySnapshot,
  recordTaskRegistryArtifacts,
  registerCollaborationTask,
  updateTaskRegistryStep
} from "./task-registry";
import { judgeVerification } from "./verification";
import { LocalProcessWorkerRuntime } from "../workers/local-process-worker-runtime";
import { GitWorktreeManager } from "../workers/worktree-manager";

const execFileAsync = promisify(execFile);

const planStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum([
    "implement",
    "test",
    "refactor",
    "config",
    "research",
    "document",
    "review",
    "migrate",
    "deploy"
  ]),
  action: z.string(),
  dependencies: z.array(z.string()),
  preferred_profile: z.string(),
  execution_mode: z.enum(["inline", "delegated"]),
  verification_spec_id: z.string(),
  done_when: z.object({}).passthrough(),
  max_retries: z.number(),
  timeout_ms: z.number().optional()
});

const verificationSpecSchema = z.object({
  id: z.string(),
  related_step_ids: z.array(z.string()),
  description: z.string(),
  invariants: z.array(z.string()),
  test_scenarios: z.array(
    z.object({
      name: z.string(),
      given: z.string(),
      when: z.string(),
      then: z.string(),
      priority: z.enum(["must", "should"])
    })
  ),
  verification_approach: z.string(),
  acceptance_criteria: z.array(z.string()),
  setup_instructions: z.string().optional(),
  run_command: z.string().optional()
});

const taskGraphSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string()),
  steps: z.array(planStepSchema),
  verification_specs: z.array(verificationSpecSchema),
  budget_policy: z.object({
    task_budget_usd: z.number(),
    step_budget_cap_usd: z.number(),
    replan_budget_cap_usd: z.number(),
    teammate_budget_cap_usd: z.number(),
    approval_threshold_usd: z.number(),
    hard_stop_threshold_usd: z.number()
  })
});

const artifactSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "patch",
    "commit",
    "verification_report",
    "test_log",
    "plan_draft",
    "summary",
    "file_bundle",
    "custom"
  ]),
  custom_type: z.string().optional(),
  producer_agent_id: z.string(),
  produced_at: z.string(),
  path: z.string().optional(),
  commit_ref: z.string().optional(),
  worktree_ref: z.string().optional(),
  base_commit: z.string().optional(),
  source_plan_version: z.number().optional(),
  source_step_ids: z.array(z.string()).optional(),
  applies_cleanly_to: z
    .object({
      isolation_mode: z.enum(["shared_workspace", "worktree", "remote_workspace"]),
      workspace_ref: z.string().optional()
    })
    .optional(),
  summary: z.string()
});

const executionSchema = z.object({
  summary: z.string(),
  artifact_refs: z.array(artifactSchema).default([])
});

const verificationSchema = z.object({
  verification_spec_id: z.string(),
  commands_run: z.array(
    z.object({
      command: z.string(),
      cwd: z.string().optional(),
      exit_code: z.number(),
      output_ref: z.string().optional()
    })
  ),
  scenario_results: z.array(
    z.object({
      scenario: z.string(),
      priority: z.enum(["must", "should"]),
      status: z.enum(["passed", "failed", "not_run"]),
      evidence: z.string().optional()
    })
  ),
  generated_artifacts: z.array(artifactSchema),
  summary: z.string()
});

type RuntimeEventDraft = {
  type: RuntimeEvent["type"];
} & Record<string, unknown>;

interface RuntimeEngineOptions {
  rootDir: string;
  workspaceDir: string;
  broker: BrokerPort;
  agentRuntime: AgentRuntimePort;
  requirePlanApproval: boolean;
  workerRuntime?: WorkerRuntimePort;
  worktreeManager?: WorktreeManagerPort;
  workerEnv?: NodeJS.ProcessEnv;
  workerEntryPath?: string;
}

export class DeterministicRuntimeEngine implements RuntimeEnginePort {
  constructor(private readonly options: RuntimeEngineOptions) {}

  async startRun(input: RuntimeStartInput): Promise<RunState> {
    const planned = await this.options.agentRuntime.invoke<TaskGraph>({
      role: "planner",
      prompt: input.goal,
      schema: taskGraphSchema
    });

    let run = createRunState(
      input.sessionId,
      input.runId,
      planned.output.budget_policy
    );
    run = await this.applyBudgetDebit(run, planned.totalCostUsd);

    await this.publishRuntimeEvent(run, {
      type: "run_planned",
      summary: planned.output.goal
    } satisfies RuntimeEventDraft);

    if (this.options.requirePlanApproval) {
      run = {
        ...run,
        run_status: "AwaitingApproval",
        pending_user_request: this.createApprovalInteraction(input.runId, {
          id: `${input.runId}-plan-approval`,
          kind: "plan",
          question: `Approve plan for: ${planned.output.goal}?`,
          requester_agent_id: "leader",
          target: "user",
          related_run_id: input.runId,
          correlation_id: `${input.runId}-plan-approval`
        })
      };
      await this.saveRunState(run);
      return run;
    }

    return this.executePlannedRun(run, planned.output);
  }

  async continueRunWithUserResponse(
    sessionId: string,
    runId: string,
    response: UserInteractionResponse
  ): Promise<RunState> {
    const store = new FileSystemRunStateStore(this.options.rootDir, sessionId, runId);
    const loaded = await store.load();
    const run = loaded as RunState;
    if (!run.pending_user_request) {
      return run;
    }

    if (run.pending_user_request.kind === "approval") {
      await this.options.broker.publish({
        type: "approval_response",
        message_id: `${response.request_id}-response`,
        seq: 0,
        session_id: sessionId,
        run_id: runId,
        from_agent_id: "user",
        to_agent_id: "leader",
        created_at: response.answered_at,
        response: {
          request_id: run.pending_user_request.source_approval_request_id ?? response.request_id,
          approved: /^y|approve|yes$/i.test(response.answer),
          answer: response.answer,
          approver_agent_id: "user",
          answered_at: response.answered_at,
          correlation_id: response.correlation_id
        }
      });
      const nextRun: RunState = {
        ...run,
        pending_user_request: undefined,
        run_status: /^y|approve|yes$/i.test(response.answer) ? "Completed" : "Cancelled"
      };
      await this.saveRunState(nextRun);
      return nextRun;
    }

    return run;
  }

  async registerApprovalRequest(
    sessionId: string,
    runId: string,
    request: ApprovalRequest
  ): Promise<UserInteractionRequest> {
    const store = new FileSystemRunStateStore(this.options.rootDir, sessionId, runId);
    const loaded = (await store.load()) as RunState;
    const interaction = this.createApprovalInteraction(runId, request);
    const nextRun: RunState = {
      ...loaded,
      run_status: "AwaitingUser",
      pending_user_request: interaction
    };
    await this.saveRunState(nextRun);
    return interaction;
  }

  private async executePlannedRun(run: RunState, graph: TaskGraph): Promise<RunState> {
    const stepStates: Record<string, ReturnType<typeof createEmptyStepState>> =
      Object.fromEntries(
        graph.steps.map((step: PlanStep) => [step.id, createEmptyStepState(step.id)])
      );
    let registry = createTaskRegistrySnapshot(run.run_id, run.plan_version, graph);
    await this.saveTaskRegistry(run, registry);
    let currentRun = run;

    while (true) {
      const step = selectNextExecutableStep(graph.steps, stepStates);
      if (!step) {
        if (Object.values(stepStates).some((state) => state.status === "Failed")) {
          currentRun = {
            ...currentRun,
            run_status: "Failed"
          };
          await this.publishRuntimeEvent(currentRun, {
            type: "run_failed",
            reason: "No executable step remains"
          } satisfies RuntimeEventDraft);
          await this.saveRunState(currentRun);
          await this.saveTaskRegistry(currentRun, registry);
          return currentRun;
        }

        currentRun = {
          ...currentRun,
          run_status: "Completed",
          current_step_id: undefined,
          current_step_attempt: undefined
        };
        await this.publishRuntimeEvent(currentRun, {
          type: "run_completed",
          summary: graph.goal
        } satisfies RuntimeEventDraft);
        await this.saveRunState(currentRun);
        await this.saveTaskRegistry(currentRun, registry);
        return currentRun;
      }

      currentRun = beginRunExecution(currentRun, step.id);
      registry = updateTaskRegistryStep(registry, step.id, {
        ...stepStates[step.id],
        status: "Executing",
        attempt: currentRun.current_step_attempt ?? 1
      });
      await this.saveTaskRegistry(currentRun, registry);
      await this.publishRuntimeEvent(currentRun, {
        type: "step_started",
        step_id: step.id,
        title: step.title
      } satisfies RuntimeEventDraft);

      let execution: {
        summary: string;
        artifact_refs: ArtifactRef[];
      };
      if (step.execution_mode === "delegated") {
        const delegated = await this.executeDelegatedStep(currentRun, step, registry);
        currentRun = delegated.run;
        execution = delegated.execution;
        registry = delegated.registry;
      } else {
        const inlineExecution = await this.options.agentRuntime.invoke<{
          summary: string;
          artifact_refs: ArtifactRef[];
        }>({
          role: "executor",
          prompt: `${step.title}\n${step.action}`,
          schema: executionSchema,
          sessionId: currentRun.run_id
        });
        currentRun = await this.applyBudgetDebit(
          currentRun,
          inlineExecution.totalCostUsd,
          `executing ${step.id}`
        );
        execution = inlineExecution.output;
      }

      registry = recordTaskRegistryArtifacts(registry, execution.artifact_refs);
      await this.saveTaskRegistry(currentRun, registry);
      if (currentRun.run_status === "AwaitingUser" || currentRun.run_status === "Failed") {
        await this.saveRunState(currentRun);
        return currentRun;
      }

      await this.publishRuntimeEvent(currentRun, {
        type: "step_execution_finished",
        step_id: step.id,
        summary: execution.summary
      } satisfies RuntimeEventDraft);

      const verification = await this.options.agentRuntime.invoke<VerifyObservation>({
        role: "verifier",
        prompt: `Verify step ${step.id}: ${step.title}`,
        schema: verificationSchema,
        sessionId: currentRun.run_id
      });
      currentRun = await this.applyBudgetDebit(
        currentRun,
        verification.totalCostUsd,
        `verifying ${step.id}`
      );
      if (currentRun.run_status === "AwaitingUser" || currentRun.run_status === "Failed") {
        await this.saveRunState(currentRun);
        await this.saveTaskRegistry(currentRun, registry);
        return currentRun;
      }

      await this.publishRuntimeEvent(currentRun, {
        type: "verification_observed",
        step_id: step.id,
        summary: verification.output.summary
      } satisfies RuntimeEventDraft);

      const decision = judgeVerification(verification.output);
      await this.publishRuntimeEvent(currentRun, {
        type: "verification_judged",
        step_id: step.id,
        status: decision.status
      } satisfies RuntimeEventDraft);

      if (decision.status === "pass") {
        const artifactIds = execution.artifact_refs.map((artifact) => artifact.id);
        stepStates[step.id] = markStepPassed(stepStates[step.id], artifactIds);
        registry = updateTaskRegistryStep(registry, step.id, stepStates[step.id]);
        await this.saveTaskRegistry(currentRun, registry);
      } else {
        const failedState = markStepFailed(
          stepStates[step.id],
          [...decision.reasons, ...decision.errors].join("; ")
        );
        if (failedState.attempt < step.max_retries) {
          stepStates[step.id] = {
            ...failedState,
            status: "Pending"
          };
          registry = updateTaskRegistryStep(registry, step.id, stepStates[step.id]);
          await this.saveTaskRegistry(currentRun, registry);
          continue;
        }

        stepStates[step.id] = failedState;
        registry = updateTaskRegistryStep(registry, step.id, stepStates[step.id]);
        currentRun = {
          ...currentRun,
          run_status: decision.status === "inconclusive" ? "AwaitingUser" : "Failed",
          pending_user_request:
            decision.status === "inconclusive"
              ? {
                  id: `${currentRun.run_id}-${step.id}-verification`,
                  kind: "clarification",
                  question: `Verification for ${step.id} was inconclusive. Decide how to continue.`,
                  context: decision.errors.join("; "),
                  timeout_policy: "wait",
                  correlation_id: `${currentRun.run_id}-${step.id}-verification`
                }
              : undefined
        };
        await this.publishRuntimeEvent(currentRun, {
          type: "run_failed",
          reason: [...decision.reasons, ...decision.errors].join("; ")
        } satisfies RuntimeEventDraft);
        await this.saveRunState(currentRun);
        await this.saveTaskRegistry(currentRun, registry);
        return currentRun;
      }
    }
  }

  private async executeDelegatedStep(
    run: RunState,
    step: PlanStep,
    registry: ReturnType<typeof createTaskRegistrySnapshot>
  ): Promise<{
    run: RunState;
    registry: ReturnType<typeof createTaskRegistrySnapshot>;
    execution: {
      summary: string;
      artifact_refs: ArtifactRef[];
    };
  }> {
    const taskId = `${run.run_id}-${step.id}-delegated`;
    const agentId = `worker-${step.id}`;
    const task: CollaborationTask = {
      id: taskId,
      run_id: run.run_id,
      source_step_ids: [step.id],
      title: step.title,
      objective: step.action,
      required_profile: step.preferred_profile,
      owner_policy: "assignable",
      assigned_agent_id: agentId,
      runtime_placement: "local_process",
      isolation_mode: "worktree",
      dependencies: [...step.dependencies],
      input_artifacts: [],
      acceptance_ref: {
        verification_spec_ids: [step.verification_spec_id],
        done_when: step.done_when
      },
      status: "Pending",
      timeout_ms: step.timeout_ms
    };

    const worktreeManager =
      this.options.worktreeManager ?? new GitWorktreeManager(this.options.workspaceDir);
    const workerRuntime =
      this.options.workerRuntime ?? new LocalProcessWorkerRuntime();
    const worktree = await worktreeManager.create(run.run_id, taskId);
    const reserved = reserveBudget(run.budget_snapshot, run.budget_snapshot.policy.teammate_budget_cap_usd, {
      entry_id: `${run.run_id}-${run.budget_snapshot.ledger.length + 1}`,
      session_id: run.session_id,
      run_id: run.run_id,
      step_id: step.id,
      collab_task_id: taskId,
      kind: "reservation",
      amount_usd: run.budget_snapshot.policy.teammate_budget_cap_usd,
      created_at: new Date().toISOString()
    });
    let nextRun: RunState = {
      ...run,
      active_task_ids: [...run.active_task_ids, taskId],
      budget_snapshot: reserved.snapshot
    };

    let nextRegistry = registerCollaborationTask(registry, task);
    await this.publishRuntimeEvent(nextRun, {
      type: "collab_task_created",
      task_id: taskId
    } satisfies RuntimeEventDraft);

    const assignmentMessage = {
      type: "task_assignment" as const,
      message_id: `${taskId}-assignment`,
      seq: 0,
      session_id: run.session_id,
      run_id: run.run_id,
      from_agent_id: "leader",
      to_agent_id: agentId,
      created_at: new Date().toISOString(),
      task
    };
    await this.options.broker.publish(assignmentMessage);
    nextRegistry = applyBrokerMessageToTaskRegistry(nextRegistry, assignmentMessage);
    await this.options.broker.deliver(assignmentMessage.message_id);
    await this.options.broker.publish({
      type: "status_update",
      message_id: `${taskId}-running`,
      seq: 0,
      session_id: run.session_id,
      run_id: run.run_id,
      from_agent_id: agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      status: "Running",
      detail: step.title
    });
    await this.saveTaskRegistry(nextRun, nextRegistry);

    const result = await workerRuntime.run({
      command: process.execPath,
      args: [
        this.options.workerEntryPath ??
          join(this.options.rootDir, "src", "worker-entry.ts"),
        this.options.rootDir,
        worktree.path,
        run.session_id,
        run.run_id,
        agentId
      ],
      cwd: this.options.rootDir,
      env: this.options.workerEnv ?? process.env
    });

    if (result.exitCode !== 0) {
      await worktreeManager.remove(worktree.path).catch(() => undefined);
      nextRun = {
        ...nextRun,
        run_status: "Failed"
      };
      await this.publishRuntimeEvent(nextRun, {
        type: "run_failed",
        reason: `Delegated worker failed for ${step.id}`
      } satisfies RuntimeEventDraft);
      return {
        run: nextRun,
        registry: nextRegistry,
        execution: {
          summary: `Delegated worker failed for ${step.id}`,
          artifact_refs: []
        }
      };
    }

    const workerMessages = await this.collectWorkerMessages(agentId);
    for (const message of workerMessages) {
      nextRegistry = applyBrokerMessageToTaskRegistry(nextRegistry, message);
    }
    const approvalRequest = workerMessages.find(
      (
        message
      ): message is Extract<typeof workerMessages[number], { type: "approval_request" }> =>
        message.type === "approval_request"
    );
    if (approvalRequest) {
      await worktreeManager.remove(worktree.path).catch(() => undefined);
      nextRun = {
        ...nextRun,
        run_status: "AwaitingUser",
        pending_user_request: this.createApprovalInteraction(run.run_id, approvalRequest.request)
      };
      return {
        run: nextRun,
        registry: nextRegistry,
        execution: {
          summary: approvalRequest.request.question,
          artifact_refs: []
        }
      };
    }

    const patch = await this.captureWorktreePatch(worktree.path);
    const artifactRefs: ArtifactRef[] = [];
    if (patch.trim()) {
      const patchPath = join(
        this.options.rootDir,
        ".harness",
        "sessions",
        run.session_id,
        "runs",
        run.run_id,
        "artifacts",
        `${taskId}.patch`
      );
      await writeFile(patchPath, patch, "utf8");
      await execFileAsync("git", ["apply", patchPath], {
        cwd: this.options.workspaceDir
      });
      const patchArtifact: ArtifactRef = {
        id: `${taskId}-patch`,
        kind: "patch",
        producer_agent_id: agentId,
        produced_at: new Date().toISOString(),
        path: patchPath,
        worktree_ref: worktree.path,
        base_commit: worktree.baseCommit,
        source_step_ids: [step.id],
        summary: `Patch generated for ${step.id}`
      };
      artifactRefs.push(patchArtifact);
      await this.options.broker.publish({
        type: "artifact_published",
        message_id: `${patchArtifact.id}-published`,
        seq: 0,
        session_id: run.session_id,
        run_id: run.run_id,
        from_agent_id: agentId,
        to_agent_id: "leader",
        created_at: new Date().toISOString(),
        artifact: patchArtifact
      });
      nextRegistry = applyBrokerMessageToTaskRegistry(nextRegistry, {
        type: "artifact_published",
        message_id: `${patchArtifact.id}-synthetic`,
        seq: 0,
        session_id: run.session_id,
        run_id: run.run_id,
        from_agent_id: agentId,
        to_agent_id: "leader",
        created_at: new Date().toISOString(),
        artifact: patchArtifact
      });
    }

    const resultMessage = {
      type: "task_result",
      message_id: `${taskId}-result`,
      seq: 0,
      session_id: run.session_id,
      run_id: run.run_id,
      from_agent_id: agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      task_id: taskId,
      artifact_refs: artifactRefs,
      summary: `Delegated task ${taskId} completed`
    } as const;
    await this.options.broker.publish(resultMessage);
    nextRegistry = applyBrokerMessageToTaskRegistry(nextRegistry, resultMessage);
    const completedMessage = {
      type: "status_update",
      message_id: `${taskId}-completed`,
      seq: 0,
      session_id: run.session_id,
      run_id: run.run_id,
      from_agent_id: agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      status: "Completed",
      detail: step.title
    } as const;
    await this.options.broker.publish(completedMessage);
    nextRegistry = applyBrokerMessageToTaskRegistry(nextRegistry, completedMessage);

    await worktreeManager.remove(worktree.path).catch(() => undefined);
    return {
      run: nextRun,
      registry: nextRegistry,
      execution: {
        summary: `Delegated task ${taskId} completed`,
        artifact_refs: artifactRefs
      }
    };
  }

  private async applyBudgetDebit(
    run: RunState,
    amountUsd: number,
    reason = "processing the run"
  ): Promise<RunState> {
    const debit = debitBudget(run.budget_snapshot, amountUsd, {
      entry_id: `${run.run_id}-${run.budget_snapshot.ledger.length + 1}`,
      session_id: run.session_id,
      run_id: run.run_id,
      kind: "model_call",
      amount_usd: amountUsd,
      created_at: new Date().toISOString()
    });

    await Promise.all(
      debit.events.map((event) =>
        this.publishRuntimeEvent(
          run,
          event as unknown as RuntimeEventDraft
        )
      )
    );

    let nextRun: RunState = {
      ...run,
      budget_snapshot: debit.snapshot
    };

    if (debit.events.some((event) => event.type === "budget_hard_stopped")) {
      nextRun = {
        ...nextRun,
        run_status: "Failed"
      };
      await this.publishRuntimeEvent(nextRun, {
        type: "run_failed",
        reason: "Budget hard stop reached"
      } satisfies RuntimeEventDraft);
    } else if (
      debit.events.some((event) => event.type === "budget_threshold_reached") &&
      !run.pending_user_request
    ) {
      const request: UserInteractionRequest = {
        id: `${run.run_id}-budget-gate-${run.budget_snapshot.ledger.length + 1}`,
        kind: "budget_gate",
        question: `Budget threshold reached while ${reason}. Continue?`,
        context: `spent_usd=${debit.snapshot.spent_usd.toFixed(2)}`,
        timeout_policy: "wait",
        correlation_id: `${run.run_id}-budget-gate`
      };
      nextRun = {
        ...nextRun,
        run_status: "AwaitingUser",
        pending_user_request: request
      };
      await this.publishRuntimeEvent(nextRun, {
        type: "approval_requested",
        request
      } satisfies RuntimeEventDraft);
    }

    return nextRun;
  }

  private async publishRuntimeEvent(
    run: RunState,
    event: RuntimeEventDraft
  ): Promise<void> {
    await this.options.broker.publish({
      ...event,
      event_id: `${run.run_id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      seq: 0,
      session_id: run.session_id,
      run_id: run.run_id,
      timestamp: new Date().toISOString(),
      actor: "runtime"
    } as RuntimeEvent);
  }

  private createApprovalInteraction(
    runId: string,
    request: ApprovalRequest
  ): UserInteractionRequest {
    return {
      id: `${runId}-${request.id}`,
      kind: "approval",
      question: request.question,
      context: request.context,
      timeout_policy: "wait",
      timeout_ms: request.deadline
        ? Math.max(new Date(request.deadline).getTime() - Date.now(), 0)
        : undefined,
      source_approval_request_id: request.id,
      correlation_id: request.correlation_id
    };
  }

  private async saveRunState(run: RunState): Promise<void> {
    const store = new FileSystemRunStateStore(
      this.options.rootDir,
      run.session_id,
      run.run_id
    );
    await store.save(run);
  }

  private async saveTaskRegistry(
    run: RunState,
    registry: ReturnType<typeof createTaskRegistrySnapshot>
  ): Promise<void> {
    await writeJsonAtomic(
      join(
        this.options.rootDir,
        ".harness",
        "sessions",
        run.session_id,
        "runs",
        run.run_id,
        "projections",
        "task-registry.json"
      ),
      registry
    );
  }

  private async captureWorktreePatch(worktreePath: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["diff", "--binary"], {
      cwd: worktreePath,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  }

  private async collectWorkerMessages(agentId: string) {
    const messages: Array<
      Extract<Awaited<ReturnType<BrokerPort["pollInbox"]>>[number], { from_agent_id: string }>
    > = [];
    for await (const event of this.options.broker.replay()) {
      if ("from_agent_id" in event && event.from_agent_id === agentId) {
        messages.push(event as typeof messages[number]);
      }
    }
    return messages;
  }
}
