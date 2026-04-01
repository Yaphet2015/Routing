import { randomUUID } from "node:crypto";

import type { ApprovalRequest, BrokerMessage } from "../domain/protocol";
import type { AgentRuntimePort, BrokerPort } from "../domain/ports";
import { z } from "zod";

const executionSchema = z.object({
  summary: z.string(),
  artifact_refs: z.array(
    z.object({
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
    })
  ),
  approval_request: z
    .object({
      id: z.string(),
      kind: z.enum(["plan", "plan_revision", "budget", "task_result", "permission"]),
      question: z.string(),
      context: z.string().optional(),
      requester_agent_id: z.string(),
      target: z.enum(["leader", "user"]),
      related_run_id: z.string(),
      correlation_id: z.string(),
      deadline: z.string().optional()
    })
    .optional()
});

interface WorkerHostOptions {
  agentId: string;
  workspaceDir: string;
  broker: BrokerPort;
  agentRuntime: AgentRuntimePort;
}

function isTaskAssignment(message: BrokerMessage): message is Extract<BrokerMessage, { type: "task_assignment" }> {
  return message.type === "task_assignment";
}

export class WorkerHost {
  constructor(private readonly options: WorkerHostOptions) {}

  async runOnce(): Promise<boolean> {
    const inbox = await this.options.broker.pollInbox(this.options.agentId);
    const assignment = inbox.find(isTaskAssignment);
    if (!assignment) {
      return false;
    }

    await this.options.broker.publish({
      type: "task_claim",
      message_id: `${assignment.task.id}-claim-${randomUUID()}`,
      seq: 0,
      session_id: assignment.session_id,
      run_id: assignment.run_id,
      from_agent_id: this.options.agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      task_id: assignment.task.id
    });

    await this.options.broker.publish({
      type: "status_update",
      message_id: `${assignment.task.id}-running-${randomUUID()}`,
      seq: 0,
      session_id: assignment.session_id,
      run_id: assignment.run_id,
      from_agent_id: this.options.agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      status: "Running",
      detail: assignment.task.title
    });

    const execution = await this.options.agentRuntime.invoke<z.infer<typeof executionSchema>>({
      role: "executor",
      prompt: `${assignment.task.title}\n${assignment.task.objective}`,
      schema: executionSchema
    });

    for (const artifact of execution.output.artifact_refs) {
      await this.options.broker.publish({
        type: "artifact_published",
        message_id: `${artifact.id}-published-${randomUUID()}`,
        seq: 0,
        session_id: assignment.session_id,
        run_id: assignment.run_id,
        from_agent_id: this.options.agentId,
        to_agent_id: "leader",
        created_at: new Date().toISOString(),
        artifact
      });
    }

    if (execution.output.approval_request) {
      await this.options.broker.publish({
        type: "approval_request",
        message_id: `${assignment.task.id}-approval-${randomUUID()}`,
        seq: 0,
        session_id: assignment.session_id,
        run_id: assignment.run_id,
        from_agent_id: this.options.agentId,
        to_agent_id: "leader",
        created_at: new Date().toISOString(),
        request: execution.output.approval_request as ApprovalRequest
      });
      await this.options.broker.publish({
        type: "status_update",
        message_id: `${assignment.task.id}-awaiting-approval-${randomUUID()}`,
        seq: 0,
        session_id: assignment.session_id,
        run_id: assignment.run_id,
        from_agent_id: this.options.agentId,
        to_agent_id: "leader",
        created_at: new Date().toISOString(),
        status: "AwaitingApproval",
        detail: assignment.task.title
      });
      await this.options.broker.ack(this.options.agentId, assignment.seq);
      return true;
    }

    await this.options.broker.publish({
      type: "task_result",
      message_id: `${assignment.task.id}-result-${randomUUID()}`,
      seq: 0,
      session_id: assignment.session_id,
      run_id: assignment.run_id,
      from_agent_id: this.options.agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      task_id: assignment.task.id,
      artifact_refs: execution.output.artifact_refs,
      summary: execution.output.summary
    });

    await this.options.broker.publish({
      type: "status_update",
      message_id: `${assignment.task.id}-completed-${randomUUID()}`,
      seq: 0,
      session_id: assignment.session_id,
      run_id: assignment.run_id,
      from_agent_id: this.options.agentId,
      to_agent_id: "leader",
      created_at: new Date().toISOString(),
      status: "Completed",
      detail: assignment.task.title
    });

    await this.options.broker.ack(this.options.agentId, assignment.seq);
    return true;
  }
}
