import type { z } from "zod";

import type {
  ApprovalRequest,
  BrokerEvent,
  BrokerMessage,
  RunStateStoreRecord,
  RuntimeEvent,
  SessionStateStoreRecord
} from "./protocol";
import type {
  RunState,
  TaskGraph,
  UserInteractionRequest,
  UserInteractionResponse,
  VerifyObservation
} from "./types";

export interface KernelTurnResult {
  session_status: SessionStateStoreRecord["session_status"];
  active_run_id?: string;
  emitted_event_ids: string[];
  user_interaction_request?: UserInteractionRequest;
}

export interface ResumeResult {
  session_status: SessionStateStoreRecord["session_status"];
  restored_run_ids: string[];
  active_run_id?: string;
  pending_user_interactions: UserInteractionRequest[];
}

export interface UserTurnInput {
  session_id: string;
  text: string;
  attachments?: unknown[];
  target_run_id?: string;
}

export interface SessionKernelPort {
  submitUserInput(input: UserTurnInput): Promise<KernelTurnResult>;
  attachRun(runId: string): Promise<void>;
  interruptCurrentTurn(reason: string): Promise<void>;
  resumeSession(sessionId: string): Promise<ResumeResult>;
  closeSession(): Promise<void>;
}

export interface BrokerPort {
  publish(event: BrokerEvent): Promise<{ seq: number }>;
  deliver(messageId: string): Promise<void>;
  pollInbox(agentId: string, afterSeq?: number): Promise<BrokerMessage[]>;
  ack(agentId: string, uptoSeq: number): Promise<void>;
  replay(afterSeq?: number): AsyncIterable<BrokerEvent>;
}

export interface StatusSink {
  onEvent(event: RuntimeEvent | BrokerMessage | { type: string }): Promise<void>;
  flush(): Promise<void>;
}

export interface UserInteractionPort {
  request(input: UserInteractionRequest): Promise<UserInteractionResponse>;
}

export type AgentRole = "leader" | "planner" | "executor" | "verifier";

export interface AgentRuntimeInvocation<TOutput> {
  role: AgentRole;
  prompt: string;
  schema: z.ZodType<TOutput>;
  sessionId?: string;
}

export interface AgentRuntimeInvocationResult<TOutput> {
  sessionId: string;
  totalCostUsd: number;
  output: TOutput;
  messages: unknown[];
}

export interface AgentRuntimePort {
  invoke<TOutput>(
    invocation: AgentRuntimeInvocation<TOutput>
  ): Promise<AgentRuntimeInvocationResult<TOutput>>;
}

export interface SessionStateStore {
  save(record: SessionStateStoreRecord): Promise<void>;
  load(): Promise<SessionStateStoreRecord>;
}

export interface RunStateStore {
  save(record: RunState | RunStateStoreRecord): Promise<void>;
  load(): Promise<RunState | RunStateStoreRecord>;
}

export interface ContextManager {
  assemblePrompt(input: {
    systemPrompt: string;
    userPrompt: string;
    traces?: string[];
  }): Promise<string>;
}

export interface RuntimeStartInput {
  sessionId: string;
  runId: string;
  goal: string;
}

export interface RuntimeEnginePort {
  startRun(input: RuntimeStartInput): Promise<RunState>;
  continueRunWithUserResponse(
    sessionId: string,
    runId: string,
    response: UserInteractionResponse
  ): Promise<RunState>;
  registerApprovalRequest(
    sessionId: string,
    runId: string,
    request: ApprovalRequest
  ): Promise<UserInteractionRequest>;
}
