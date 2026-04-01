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
