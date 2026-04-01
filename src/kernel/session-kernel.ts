import { randomUUID } from "node:crypto";

import { FileSystemBroker } from "../adapters/fs/file-system-broker";
import {
  FileSystemRunStateStore,
  FileSystemSessionStateStore
} from "../adapters/fs/state-store";
import type { ApprovalRequest, SessionStateStoreRecord } from "../domain/protocol";
import type {
  KernelTurnResult,
  ResumeResult,
  SessionOverview,
  SessionKernelPort,
  StatusSink,
  UserTurnInput
} from "../domain/ports";
import type { AgentRuntimePort, RuntimeEnginePort } from "../domain/ports";
import type { RunState, UserInteractionResponse } from "../domain/types";
import { pauseRun, resumeRun } from "../runtime/state-machine";
import { DeterministicRuntimeEngine } from "../runtime/runtime-engine";

interface SessionKernelOptions {
  rootDir: string;
  workspaceDir: string;
  statusSink: StatusSink;
  agentRuntime: AgentRuntimePort;
  requirePlanApproval: boolean;
}

export class SessionKernel implements SessionKernelPort {
  constructor(private readonly options: SessionKernelOptions) {}

  async submitUserInput(input: UserTurnInput): Promise<KernelTurnResult> {
    const sessionStore = new FileSystemSessionStateStore(
      this.options.rootDir,
      input.session_id
    );
    const existingSession = await this.loadSessionState(sessionStore, input.session_id);
    const runId =
      input.target_run_id ??
      existingSession.active_run_id ??
      `run-${existingSession.run_ids.length + 1}`;

    const runStore = new FileSystemRunStateStore(
      this.options.rootDir,
      input.session_id,
      runId
    );

    const existingRun = await this.tryLoadRun(runStore);
    const engine = this.createRuntimeEngine(input.session_id, runId);

    let run: RunState;
    if (existingRun?.pending_user_request) {
      const response: UserInteractionResponse = {
        request_id: existingRun.pending_user_request.id,
        answer: input.text,
        answered_at: new Date().toISOString(),
        correlation_id: existingRun.pending_user_request.correlation_id
      };
      run = await engine.continueRunWithUserResponse(
        input.session_id,
        runId,
        response
      );
    } else {
      run = await engine.startRun({
        sessionId: input.session_id,
        runId,
        goal: input.text
      });
    }

    await runStore.save(run);
    const sessionState: SessionStateStoreRecord = {
      session_id: input.session_id,
      session_status: run.pending_user_request ? "AwaitingUser" : "Active",
      active_run_id: run.run_id,
      run_ids: Array.from(new Set([...existingSession.run_ids, run.run_id])),
      compact_boundary_seq: existingSession.compact_boundary_seq
    };
    await sessionStore.save(sessionState);

    return {
      session_status: sessionState.session_status,
      active_run_id: sessionState.active_run_id,
      emitted_event_ids: [],
      user_interaction_request: run.pending_user_request
    };
  }

  async registerApprovalRequest(
    sessionId: string,
    runId: string,
    request: ApprovalRequest
  ) {
    const engine = this.createRuntimeEngine(sessionId, runId);
    const interaction = await engine.registerApprovalRequest(sessionId, runId, request);
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);
    await sessionStore.save({
      ...session,
      active_run_id: runId,
      session_status: "AwaitingUser"
    });
    return interaction;
  }

  async attachRun(sessionId: string, runId: string): Promise<void> {
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);

    if (!session.run_ids.includes(runId)) {
      throw new Error(`Run not found in session: ${runId}`);
    }

    await sessionStore.save({
      ...session,
      active_run_id: runId
    });
  }

  async getSessionOverview(sessionId: string): Promise<SessionOverview> {
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);
    const runs = await Promise.all(
      session.run_ids.map(async (runId) => {
        const runStore = new FileSystemRunStateStore(this.options.rootDir, sessionId, runId);
        const run = await this.tryLoadRun(runStore);
        return {
          run_id: runId,
          run_status: run?.run_status ?? "Draft"
        };
      })
    );

    const pending = await Promise.all(
      session.run_ids.map(async (runId) => {
        const runStore = new FileSystemRunStateStore(this.options.rootDir, sessionId, runId);
        const run = await this.tryLoadRun(runStore);
        return run?.pending_user_request?.question;
      })
    );

    return {
      session_id: sessionId,
      session_status: session.session_status,
      active_run_id: session.active_run_id,
      run_ids: session.run_ids,
      runs,
      pending_user_interactions: pending.filter(
        (question): question is string => Boolean(question)
      )
    };
  }

  async pauseRun(sessionId: string, runId?: string): Promise<RunState> {
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);
    const targetRunId = runId ?? session.active_run_id;
    if (!targetRunId) {
      throw new Error("No active run to pause");
    }

    const runStore = new FileSystemRunStateStore(this.options.rootDir, sessionId, targetRunId);
    const run = await this.tryLoadRun(runStore);
    if (!run) {
      throw new Error(`Run not found: ${targetRunId}`);
    }

    const paused = pauseRun(run);
    await runStore.save(paused);
    await sessionStore.save({
      ...session,
      active_run_id: targetRunId,
      session_status: paused.run_status === "Paused" ? "Resumable" : session.session_status
    });
    return paused;
  }

  async resumeRun(sessionId: string, runId?: string): Promise<RunState> {
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);
    const targetRunId = runId ?? session.active_run_id;
    if (!targetRunId) {
      throw new Error("No active run to resume");
    }

    const runStore = new FileSystemRunStateStore(this.options.rootDir, sessionId, targetRunId);
    const run = await this.tryLoadRun(runStore);
    if (!run) {
      throw new Error(`Run not found: ${targetRunId}`);
    }

    const resumed = resumeRun(run);
    await runStore.save(resumed);
    await sessionStore.save({
      ...session,
      active_run_id: targetRunId,
      session_status: resumed.pending_user_request ? "AwaitingUser" : "Active"
    });
    return resumed;
  }

  async interruptCurrentTurn(reason: string): Promise<void> {
    await this.options.statusSink.onEvent({ type: `interrupted:${reason}` });
  }

  async resumeSession(sessionId: string): Promise<ResumeResult> {
    const sessionStore = new FileSystemSessionStateStore(this.options.rootDir, sessionId);
    const session = await this.loadSessionState(sessionStore, sessionId);
    const pending: ResumeResult["pending_user_interactions"] = [];

    if (session.active_run_id) {
      const broker = new FileSystemBroker(
        this.options.rootDir,
        sessionId,
        session.active_run_id
      );
      for await (const _event of broker.replay()) {
        break;
      }

      const runStore = new FileSystemRunStateStore(
        this.options.rootDir,
        sessionId,
        session.active_run_id
      );
      const run = (await this.tryLoadRun(runStore)) as RunState | undefined;
      if (run?.pending_user_request) {
        pending.push(run.pending_user_request);
      }
    }

    return {
      session_status: session.session_status,
      restored_run_ids: session.run_ids,
      active_run_id: session.active_run_id,
      pending_user_interactions: pending
    };
  }

  async closeSession(): Promise<void> {
    await this.options.statusSink.flush();
  }

  private createRuntimeEngine(sessionId: string, runId: string): RuntimeEnginePort {
    const broker = new FileSystemBroker(this.options.rootDir, sessionId, runId);
    return new DeterministicRuntimeEngine({
      rootDir: this.options.rootDir,
      workspaceDir: this.options.workspaceDir,
      broker,
      agentRuntime: this.options.agentRuntime,
      requirePlanApproval: this.options.requirePlanApproval
    });
  }

  private async loadSessionState(
    store: FileSystemSessionStateStore,
    sessionId: string
  ): Promise<SessionStateStoreRecord> {
    try {
      return await store.load();
    } catch {
      return {
        session_id: sessionId,
        session_status: "Active",
        run_ids: []
      };
    }
  }

  private async tryLoadRun(
    store: FileSystemRunStateStore
  ): Promise<RunState | undefined> {
    try {
      return (await store.load()) as RunState;
    } catch {
      return undefined;
    }
  }
}
