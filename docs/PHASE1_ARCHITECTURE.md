# Phase 1 Architecture

Phase 1 delivers a leader-only runtime with protocol-ready persistence and broker boundaries.

## Modules

- `src/kernel`
  Session kernel, REPL shell, context assembly, and host-facing status output.
- `src/runtime`
  Deterministic state transitions, budget accounting, verification judgment, runtime orchestration, and task-registry projection.
- `src/adapters`
  File-system persistence/broker and Claude Agent SDK integration.

## Flow

1. The REPL submits a user turn to `SessionKernel`.
2. `SessionKernel` resolves or creates the active run and delegates execution to `DeterministicRuntimeEngine`.
3. The runtime uses the Claude Agent SDK for planning, execution, and verification, but state transitions, retries, budget gates, and verification verdicts remain in local code.
4. Runtime and broker events append to `.harness/.../events/events.ndjson`.
5. Session and run state snapshots persist in `session.json` and `run.json` for resume, while task-registry projection persists in `projections/task-registry.json`.

## Current Boundaries

- Single active run per session.
- Leader-only orchestration; teammate runtime is not implemented.
- Approval, artifact, and broker protocol shapes already exist so later phases can add teammate execution without replacing persistence.
- The REPL host now exposes session-level commands for status, run attachment, pause/resume, and approval routing.
- Session resume validates the active run event log protocol header before restoring interactive state.
- The runtime can now retry failed inline steps, stop on budget gates, and persist step/artifact state into the task-registry projection.
