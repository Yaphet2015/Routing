# Changelog

## Unreleased

- Hardened the protocol model with `protocol_header` version checks, `Paused` run state, timeout/deadline fields, and expanded step/artifact types.
- Made verification verdicts capable of reporting `inconclusive` outcomes and explicit verification errors.
- Removed array-order dependence from step scheduling and documented single-active-run plus default worktree isolation expectations.
- Added a testable REPL host shell with `/status`, `/runs`, `/attach`, `/pause`, `/resume`, and `/approve` commands backed by session-kernel lifecycle methods.
- Made session resume reject incompatible event-log protocol versions before restoring the active run.
- Added runtime retries, budget-gate user stops, and persisted task-registry projection updates for step/artifact state.
- Added local worker foundations: git worktree isolation, local process launching, broker-driven worker host execution, and a standalone worker entrypoint.
- Wired delegated runtime steps through isolated worktrees with patch artifact capture and leader-side patch apply back into the main workspace.

## 0.1.0

- Bootstrapped the Phase 1 leader-only, protocol-ready MVP on Bun and TypeScript.
- Added deterministic runtime state, budget accounting, verification judgment, filesystem broker/state store, and a Claude Agent SDK adapter.
- Added a minimal REPL shell with session resume support plus initial architecture and storage documentation.
