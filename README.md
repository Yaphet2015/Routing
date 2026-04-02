# Routing

A session-oriented REPL CLI coding agent with:

- a `SessionKernel` for long-lived sessions and resume
- a deterministic runtime for planning, execution, verification, retries, and budget gates
- a filesystem-backed collaboration broker and event log
- delegated local workers running in isolated git worktrees
- Claude Agent SDK as the only LLM runtime

## Requirements

- [Bun](https://bun.sh/)
- `git`
- `ANTHROPIC_API_KEY`

## Install

```bash
bun install
```

## Environment

Required:

```bash
export ANTHROPIC_API_KEY=...
```

Optional:

```bash
export ROUTING_MODEL=claude-sonnet-4-6
export ROUTING_AGENT_RUNTIME=mock
```

Set `ROUTING_AGENT_RUNTIME=mock` to run the REPL smoke path without Claude credentials. In that mode the planner, executor, and verifier are deterministic fixtures that exercise the full approval and completion flow.

## Start The REPL

From the repository root:

```bash
bun src/cli.ts
```

The CLI prints a new session id on startup. Session state, runs, projections, inboxes, and event logs are stored under:

```text
.harness/sessions/<session-id>/
```

To resume an existing session:

```bash
bun src/cli.ts resume <session-id>
```

## REPL Commands

- `/help`
- `/status`
- `/runs`
- `/attach <run-id>`
- `/pause [run-id]`
- `/resume [run-id]`
- `/approve <answer>`
- `/exit`

Plain text input creates or continues the active run.

## Typical Usage

1. Start the REPL with `bun src/cli.ts`
2. Enter a task in plain text
3. Review plan approvals when the runtime pauses
4. Use `/status` and `/runs` to inspect progress
5. Use `/approve yes` or another answer when approval is required
6. Resume later with `bun src/cli.ts resume <session-id>`

## Verification

Run the default test suite:

```bash
bun test
```

Run type checking:

```bash
bun run build
```

Run the gated live Claude SDK smoke test:

```bash
bun test --config vitest.live.config.ts tests/live/claude-sdk.smoke.test.ts
```

If `ANTHROPIC_API_KEY` is not set, the live smoke test is skipped.

Run the deterministic CLI smoke test:

```bash
bun test tests/integration/cli.test.ts
```

Run the REPL manually in mock mode:

```bash
ROUTING_AGENT_RUNTIME=mock bun src/cli.ts
```

## How It Works

- The canonical source of truth is the append-only event log in `events.ndjson`
- `task-registry.json` is a rebuildable projection over the event stream
- Only one run is active per session, but older runs remain attachable
- Delegated workers default to `local_process + worktree`
- Event replay rejects incompatible protocol versions before resume

## Current Limits

- Remote teammates and IM transport are not implemented
- Orphan worker recovery is still incomplete
- Late approval-response reconciliation is minimal

## More Docs

- [REPL agent guide](docs/REPL_AGENT.md)
- [Local worker runtime](docs/LOCAL_WORKERS.md)
- [Protocol and storage](docs/PROTOCOL_STORAGE.md)
- [Phase 1 architecture background](docs/PHASE1_ARCHITECTURE.md)
