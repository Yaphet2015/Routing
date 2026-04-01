# Protocol and Storage

The file system is only the transport. The canonical truth is the append-only event log.

## Layout

```text
.harness/
  sessions/<session_id>/
    session.json
    runs/<run_id>/
      run.json
      events/events.ndjson
      projections/
      agents/<agent_id>/
        inbox.ndjson
        ack.json
```

## Rules

- `events.ndjson` starts with a `protocol_header` entry and replay must reject incompatible versions.
- `events.ndjson` is the source of truth for broker and runtime events.
- `deliver(message_id)` materializes inbox state without mutating the canonical event log.
- `ack.json` stores only the highest consumed sequence for an agent.
- Projections and inboxes are rebuildable from `events.ndjson` plus `ack.json`.
- State files are written via atomic rename and event append uses a lock file.
- A session may keep multiple historical runs, but only one run is active at a time.
- Future teammates default to `worktree` isolation unless a stricter placement requires something else.

## Phase 1 Limits

- No teammate spawning yet.
- Approval requests can still be promoted to user interactions and translated back to protocol responses.
- Artifact and collaboration task models exist, but only leader-only flows execute.
- Pause/resume, delegated work, mailbox ownership, and remote transports are not implemented in Phase 1.
