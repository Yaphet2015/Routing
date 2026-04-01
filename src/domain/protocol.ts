import type {
  ArtifactRef,
  CollaborationTask,
  PlanRevision,
  RunStatus,
  SessionStatus,
  UserInteractionRequest
} from "./types";

export interface BrokerEnvelope {
  message_id: string;
  seq: number;
  session_id: string;
  run_id: string;
  from_agent_id: string;
  to_agent_id?: string;
  correlation_id?: string;
  created_at: string;
}

export const PROTOCOL_VERSION = "routing/v9.1";

export interface ProtocolHeader {
  type: "protocol_header";
  seq: 0;
  session_id: string;
  run_id: string;
  created_at: string;
  protocol_version: string;
}

export type ApprovalRequest = {
  id: string;
  kind: "plan" | "plan_revision" | "budget" | "task_result" | "permission";
  question: string;
  context?: string;
  requester_agent_id: string;
  target: "leader" | "user";
  related_run_id: string;
  correlation_id: string;
  deadline?: string;
};

export type ApprovalResponse = {
  request_id: string;
  approved: boolean;
  answer?: string;
  approver_agent_id: string;
  answered_at: string;
  correlation_id: string;
};

export type BrokerMessage =
  | (BrokerEnvelope & { type: "task_assignment"; task: CollaborationTask })
  | (BrokerEnvelope & { type: "task_claim"; task_id: string })
  | (BrokerEnvelope & {
      type: "task_result";
      task_id: string;
      artifact_refs: ArtifactRef[];
      summary: string;
    })
  | (BrokerEnvelope & { type: "status_update"; status: string; detail?: string })
  | (BrokerEnvelope & { type: "artifact_published"; artifact: ArtifactRef })
  | (BrokerEnvelope & { type: "approval_request"; request: ApprovalRequest })
  | (BrokerEnvelope & { type: "approval_response"; response: ApprovalResponse })
  | (BrokerEnvelope & { type: "shutdown_request"; reason?: string })
  | (BrokerEnvelope & { type: "shutdown_ack" });

export interface RuntimeEventEnvelope {
  event_id: string;
  seq: number;
  session_id: string;
  run_id: string;
  timestamp: string;
  actor: "kernel" | "leader" | "runtime" | "broker" | "teammate";
  plan_version?: number;
  step_id?: string;
  task_id?: string;
  attempt?: number;
  correlation_id?: string;
}

export type RuntimeEvent =
  | (RuntimeEventEnvelope & { type: "run_planned"; summary: string })
  | (RuntimeEventEnvelope & {
      type: "approval_requested";
      request: UserInteractionRequest;
    })
  | (RuntimeEventEnvelope & {
      type: "broker_message_published";
      message_id: string;
      message_type: BrokerMessage["type"];
    })
  | (RuntimeEventEnvelope & {
      type: "broker_message_delivered";
      message_id: string;
      to_agent_id: string;
    })
  | (RuntimeEventEnvelope & {
      type: "broker_message_acked";
      agent_id: string;
      upto_seq: number;
    })
  | (RuntimeEventEnvelope & { type: "budget_debited"; amount_usd: number })
  | (RuntimeEventEnvelope & {
      type: "budget_threshold_reached";
      spent_usd: number;
    })
  | (RuntimeEventEnvelope & {
      type: "budget_hard_stopped";
      spent_usd: number;
    })
  | (RuntimeEventEnvelope & { type: "step_started"; title: string })
  | (RuntimeEventEnvelope & {
      type: "step_execution_finished";
      summary: string;
    })
  | (RuntimeEventEnvelope & {
      type: "verification_observed";
      summary: string;
    })
  | (RuntimeEventEnvelope & {
      type: "verification_judged";
      status: "pass" | "fail" | "inconclusive";
    })
  | (RuntimeEventEnvelope & { type: "plan_revised"; revision: PlanRevision })
  | (RuntimeEventEnvelope & { type: "collab_task_created"; task_id: string })
  | (RuntimeEventEnvelope & { type: "artifact_published"; artifact_id: string })
  | (RuntimeEventEnvelope & { type: "run_completed"; summary: string })
  | (RuntimeEventEnvelope & { type: "run_failed"; reason: string });

export type BrokerEvent = BrokerMessage | RuntimeEvent;
export type EventLogEntry = ProtocolHeader | BrokerEvent;

export interface SessionStateStoreRecord {
  session_id: string;
  session_status: SessionStatus;
  active_run_id?: string;
  run_ids: string[];
  compact_boundary_seq?: number;
  last_user_interaction_id?: string;
}

export interface RunStateStoreRecord {
  session_id: string;
  run_id: string;
  run_status: RunStatus;
  plan_version: number;
  current_step_id?: string;
  current_step_attempt?: number;
  pending_user_request?: UserInteractionRequest;
  budget_snapshot: {
    spent_usd: number;
    remaining_usd: number;
  };
  baseline_ref?: string;
  active_task_ids: string[];
  last_event_seq: number;
}
