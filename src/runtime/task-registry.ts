import type { BrokerMessage } from "../domain/protocol";
import type {
  ArtifactRef,
  CollaborationTask,
  PlanStep,
  StepRuntimeState,
  TaskGraph
} from "../domain/types";

export interface TaskClaimState {
  task_id: string;
  owner_agent_id?: string;
  claimed_at?: string;
  last_result_artifact_ids: string[];
}

export interface TaskRegistrySnapshot {
  run_id: string;
  plan_version: number;
  steps: Record<string, StepRuntimeState>;
  collab_tasks: Record<string, CollaborationTask>;
  artifacts: Record<string, ArtifactRef>;
  task_claims: Record<string, TaskClaimState>;
}

export function createTaskRegistrySnapshot(
  runId: string,
  planVersion: number,
  graph: TaskGraph
): TaskRegistrySnapshot {
  return {
    run_id: runId,
    plan_version: planVersion,
    steps: Object.fromEntries(
      graph.steps.map((step: PlanStep) => [
        step.id,
        {
          step_id: step.id,
          status: "Pending",
          attempt: 0,
          produced_artifacts: []
        }
      ])
    ),
    collab_tasks: {},
    artifacts: {},
    task_claims: {}
  };
}

export function updateTaskRegistryStep(
  snapshot: TaskRegistrySnapshot,
  stepId: string,
  state: StepRuntimeState
): TaskRegistrySnapshot {
  return {
    ...snapshot,
    steps: {
      ...snapshot.steps,
      [stepId]: state
    }
  };
}

export function recordTaskRegistryArtifacts(
  snapshot: TaskRegistrySnapshot,
  artifacts: ArtifactRef[]
): TaskRegistrySnapshot {
  return {
    ...snapshot,
    artifacts: {
      ...snapshot.artifacts,
      ...Object.fromEntries(artifacts.map((artifact) => [artifact.id, artifact]))
    }
  };
}

export function registerCollaborationTask(
  snapshot: TaskRegistrySnapshot,
  task: CollaborationTask
): TaskRegistrySnapshot {
  return {
    ...snapshot,
    collab_tasks: {
      ...snapshot.collab_tasks,
      [task.id]: task
    }
  };
}

export function applyBrokerMessageToTaskRegistry(
  snapshot: TaskRegistrySnapshot,
  message: BrokerMessage
): TaskRegistrySnapshot {
  switch (message.type) {
    case "task_assignment":
      return registerCollaborationTask(snapshot, message.task);
    case "task_claim": {
      const task = snapshot.collab_tasks[message.task_id];
      return {
        ...snapshot,
        collab_tasks: task
          ? {
              ...snapshot.collab_tasks,
              [message.task_id]: {
                ...task,
                assigned_agent_id: message.from_agent_id,
                status: "Claimed"
              }
            }
          : snapshot.collab_tasks,
        task_claims: {
          ...snapshot.task_claims,
          [message.task_id]: {
            task_id: message.task_id,
            owner_agent_id: message.from_agent_id,
            claimed_at: message.created_at,
            last_result_artifact_ids: snapshot.task_claims[message.task_id]?.last_result_artifact_ids ?? []
          }
        }
      };
    }
    case "task_result": {
      const task = snapshot.collab_tasks[message.task_id];
      return {
        ...recordTaskRegistryArtifacts(snapshot, message.artifact_refs),
        collab_tasks: task
          ? {
              ...snapshot.collab_tasks,
              [message.task_id]: {
                ...task,
                status: "Completed"
              }
            }
          : snapshot.collab_tasks,
        task_claims: {
          ...snapshot.task_claims,
          [message.task_id]: {
            task_id: message.task_id,
            owner_agent_id:
              snapshot.task_claims[message.task_id]?.owner_agent_id ?? message.from_agent_id,
            claimed_at: snapshot.task_claims[message.task_id]?.claimed_at,
            last_result_artifact_ids: message.artifact_refs.map((artifact) => artifact.id)
          }
        }
      };
    }
    case "artifact_published":
      return recordTaskRegistryArtifacts(snapshot, [message.artifact]);
    case "status_update": {
      const taskClaim = Object.entries(snapshot.task_claims).find(
        ([, claim]) => claim.owner_agent_id === message.from_agent_id
      );
      if (!taskClaim) {
        return snapshot;
      }

      const [taskId] = taskClaim;
      const task = snapshot.collab_tasks[taskId];
      if (!task) {
        return snapshot;
      }

      const nextStatus =
        message.status === "Running"
          ? "Running"
          : message.status === "AwaitingApproval"
            ? "AwaitingApproval"
            : message.status === "Completed"
              ? "Completed"
              : task.status;
      return {
        ...snapshot,
        collab_tasks: {
          ...snapshot.collab_tasks,
          [taskId]: {
            ...task,
            status: nextStatus
          }
        }
      };
    }
    default:
      return snapshot;
  }
}
