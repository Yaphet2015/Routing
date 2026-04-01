import type { SessionKernelPort } from "../domain/ports";

function requireArgument(command: string, value: string | undefined, usage: string): string {
  if (!value) {
    throw new Error(`Missing argument for ${command}. Usage: ${usage}`);
  }

  return value;
}

export async function executeShellCommand(
  kernel: SessionKernelPort,
  sessionId: string,
  line: string
): Promise<string> {
  const [command, ...rest] = line.trim().split(/\s+/);

  switch (command) {
    case "/help":
      return [
        "Commands:",
        "/help",
        "/status",
        "/runs",
        "/attach <run-id>",
        "/pause [run-id]",
        "/resume [run-id]",
        "/approve <answer>",
        "/exit"
      ].join("\n");
    case "/status": {
      const overview = await kernel.getSessionOverview(sessionId);
      return [
        `session=${overview.session_id}`,
        `status=${overview.session_status}`,
        `active_run=${overview.active_run_id ?? "none"}`,
        `pending=${overview.pending_user_interactions.length}`
      ].join(" ");
    }
    case "/runs": {
      const overview = await kernel.getSessionOverview(sessionId);
      return overview.runs
        .map((run) => `${run.run_id}: ${run.run_status}`)
        .join("\n");
    }
    case "/attach": {
      const runId = requireArgument(command, rest[0], "/attach <run-id>");
      await kernel.attachRun(sessionId, runId);
      return `attached ${runId}`;
    }
    case "/pause": {
      const run = await kernel.pauseRun(sessionId, rest[0]);
      return `paused ${run.run_id}`;
    }
    case "/resume": {
      const run = await kernel.resumeRun(sessionId, rest[0]);
      return `resumed ${run.run_id}`;
    }
    case "/approve": {
      const answer = requireArgument(command, rest.join(" "), "/approve <answer>");
      const overview = await kernel.getSessionOverview(sessionId);
      if (!overview.active_run_id) {
        throw new Error("No active run to approve");
      }

      await kernel.submitUserInput({
        session_id: sessionId,
        text: answer,
        target_run_id: overview.active_run_id
      });
      return `submitted approval for ${overview.active_run_id}`;
    }
    default:
      throw new Error(`Unsupported shell command: ${command}`);
  }
}
