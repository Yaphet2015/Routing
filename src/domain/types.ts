export type SessionStatus =
  | "Active"
  | "AwaitingUser"
  | "Compacting"
  | "Interrupted"
  | "Resumable"
  | "Closed";

export type RunStatus =
  | "Draft"
  | "Planned"
  | "AwaitingApproval"
  | "Ready"
  | "Executing"
  | "Paused"
  | "Recovering"
  | "AwaitingUser"
  | "Completed"
  | "Failed"
  | "Cancelled";

export type StepStatus =
  | "Pending"
  | "Ready"
  | "Executing"
  | "Verifying"
  | "Passed"
  | "Failed"
  | "Blocked"
  | "Skipped"
  | "Cancelled";

export type CollaborationTaskStatus =
  | "Pending"
  | "Claimed"
  | "Running"
  | "AwaitingApproval"
  | "Reporting"
  | "Completed"
  | "Failed"
  | "Cancelled";

export type RuntimePlacement = "in_process" | "local_process" | "remote_process";

export type IsolationMode =
  | "shared_workspace"
  | "worktree"
  | "remote_workspace";

export type PermissionMode =
  | "default"
  | "plan_required"
  | "ask"
  | "auto";

export type FilesystemWriteScope = "none" | "temp_only" | "project";

export type ToolConcurrencyClass = "read_only" | "mixed" | "side_effecting";

export interface ToolPolicy {
  allow: string[];
  deny: string[];
  read_only: boolean;
  concurrency_class: ToolConcurrencyClass;
}

export interface AgentProfile {
  id: string;
  display_name: string;
  role:
    | "leader"
    | "planner"
    | "explorer"
    | "executor"
    | "verifier"
    | "summarizer"
    | "general_purpose";
  model_profile: "strong" | "medium" | "cheap";
  reasoning_effort?: "low" | "medium" | "high";
  tool_policy: ToolPolicy;
  permission_mode: PermissionMode;
  runtime_placement: RuntimePlacement;
  default_isolation: IsolationMode;
  filesystem_write_scope: FilesystemWriteScope;
  allowed_temp_roots?: string[];
  max_turns: number;
  background_default: boolean;
  can_spawn_teammates: boolean;
  memory_scope: "session" | "project" | "local" | "none";
}

export interface DoneWhen {
  files_exist?: string[];
  files_contain?: Array<{
    path: string;
    substring: string;
  }>;
  command_success?: {
    command: string;
    cwd?: string;
  };
}

export interface PlanStep {
  id: string;
  title: string;
  type:
    | "implement"
    | "test"
    | "refactor"
    | "config"
    | "research"
    | "document"
    | "review"
    | "migrate"
    | "deploy";
  action: string;
  dependencies: string[];
  preferred_profile: AgentProfile["id"];
  execution_mode: "inline" | "delegated";
  verification_spec_id: string;
  done_when: DoneWhen;
  max_retries: number;
  timeout_ms?: number;
}

export interface PlanRevision {
  revision_id: string;
  base_plan_version: number;
  new_plan_version: number;
  reason: string;
  changed_step_ids: string[];
  change_summary: {
    goal_changed: boolean;
    budget_changed: boolean;
    verification_changed: boolean;
    dependency_changed: boolean;
    step_count_changed: boolean;
  };
  approval_required: boolean;
}

export interface TaskGraph {
  goal: string;
  assumptions: string[];
  steps: PlanStep[];
  verification_specs: VerificationSpec[];
  budget_policy: BudgetPolicy;
}

export interface ArtifactRef {
  id: string;
  kind:
    | "patch"
    | "commit"
    | "verification_report"
    | "test_log"
    | "plan_draft"
    | "summary"
    | "file_bundle"
    | "custom";
  custom_type?: string;
  producer_agent_id: string;
  produced_at: string;
  path?: string;
  commit_ref?: string;
  worktree_ref?: string;
  base_commit?: string;
  source_plan_version?: number;
  source_step_ids?: string[];
  applies_cleanly_to?: {
    isolation_mode: IsolationMode;
    workspace_ref?: string;
  };
  summary: string;
}

export interface CollaborationTask {
  id: string;
  run_id: string;
  source_step_ids: string[];
  title: string;
  objective: string;
  required_profile: AgentProfile["id"];
  owner_policy: "leader_only" | "assignable" | "fixed_agent";
  assigned_agent_id?: string;
  runtime_placement: RuntimePlacement;
  isolation_mode: IsolationMode;
  dependencies: string[];
  input_artifacts: ArtifactRef[];
  acceptance_ref: {
    verification_spec_ids: string[];
    done_when: DoneWhen;
  };
  status: CollaborationTaskStatus;
  timeout_ms?: number;
}

export interface TestScenario {
  name: string;
  given: string;
  when: string;
  then: string;
  priority: "must" | "should";
}

export interface VerificationSpec {
  id: string;
  related_step_ids: string[];
  description: string;
  invariants: string[];
  test_scenarios: TestScenario[];
  verification_approach: string;
  acceptance_criteria: string[];
  setup_instructions?: string;
  run_command?: string;
}

export interface VerifyObservation {
  verification_spec_id: string;
  commands_run: Array<{
    command: string;
    cwd?: string;
    exit_code: number;
    output_ref?: string;
  }>;
  scenario_results: Array<{
    scenario: string;
    priority: "must" | "should";
    status: "passed" | "failed" | "not_run";
    evidence?: string;
  }>;
  generated_artifacts: ArtifactRef[];
  summary: string;
}

export interface VerifyDecision {
  status: "pass" | "fail" | "inconclusive";
  must_passed: number;
  must_total: number;
  should_passed: number;
  should_total: number;
  reasons: string[];
  errors: string[];
}

export interface BudgetPolicy {
  task_budget_usd: number;
  step_budget_cap_usd: number;
  replan_budget_cap_usd: number;
  teammate_budget_cap_usd: number;
  approval_threshold_usd: number;
  hard_stop_threshold_usd: number;
}

export interface BudgetLedgerEntry {
  entry_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  collab_task_id?: string;
  agent_id?: string;
  kind: "model_call" | "tool_call" | "reservation" | "reservation_release";
  amount_usd: number;
  created_at: string;
}

export interface UserInteractionRequest {
  id: string;
  kind: "approval" | "clarification" | "scope_change" | "budget_gate" | "plan_revision";
  question: string;
  options?: string[];
  context?: string;
  timeout_policy: "wait" | "default_after_timeout";
  timeout_ms?: number;
  default_option?: string;
  source_approval_request_id?: string;
  correlation_id: string;
}

export interface UserInteractionResponse {
  request_id: string;
  answer: string;
  answered_at: string;
  correlation_id: string;
}

export interface BaselineRef {
  id: string;
  isolation_mode: IsolationMode;
  workspace_ref: string;
  commit_ref?: string;
  captured_at: string;
}

export interface StepRuntimeState {
  step_id: string;
  status: StepStatus;
  attempt: number;
  last_error?: string;
  produced_artifacts: string[];
}

export interface BudgetSnapshot {
  policy: BudgetPolicy;
  spent_usd: number;
  reserved_usd: number;
  remaining_usd: number;
  ledger: BudgetLedgerEntry[];
}

export interface RunState {
  session_id: string;
  run_id: string;
  run_status: RunStatus;
  plan_version: number;
  current_step_id?: string;
  current_step_attempt?: number;
  pending_user_request?: UserInteractionRequest;
  budget_snapshot: BudgetSnapshot;
  baseline_ref?: BaselineRef["id"];
  active_task_ids: string[];
  last_event_seq: number;
}
