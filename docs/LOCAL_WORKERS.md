# Local Worker Runtime

Phase 2 introduces a local-process teammate foundation without enabling delegated orchestration yet.

## Components

- `GitWorktreeManager`
  Creates isolated git worktrees under `.harness/worktrees/<run>-<task>` from the current `HEAD`.
- `LocalProcessWorkerRuntime`
  Launches a local worker process and waits for exit.
- `WorkerHost`
  Polls a worker inbox, claims a task, runs executor work, publishes artifacts, and reports task results back to the broker.
- `src/worker-entry.ts`
  Minimal process entrypoint that wires filesystem broker plus Claude Agent SDK into `WorkerHost`.

## Current limits

- Worker execution exists, but the leader runtime does not yet materialize delegated steps into worker tasks.
- Worktree lifecycle is available, but the main runtime does not yet apply worker artifacts back into the leader workspace.
- Approval escalation from teammate to leader/user is not wired yet.
