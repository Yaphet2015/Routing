import { join } from "node:path";

import type { RunState } from "../../domain/types";
import type {
  RunStateStoreRecord,
  SessionStateStoreRecord
} from "../../domain/protocol";
import { readJsonFile, writeJsonAtomic } from "./file-utils";

export class FileSystemSessionStateStore {
  private readonly path: string;

  constructor(root: string, sessionId: string) {
    this.path = join(root, ".harness", "sessions", sessionId, "session.json");
  }

  async save(record: SessionStateStoreRecord): Promise<void> {
    await writeJsonAtomic(this.path, record);
  }

  async load(): Promise<SessionStateStoreRecord> {
    return readJsonFile<SessionStateStoreRecord>(this.path);
  }
}

export class FileSystemRunStateStore {
  private readonly path: string;

  constructor(root: string, sessionId: string, runId: string) {
    this.path = join(
      root,
      ".harness",
      "sessions",
      sessionId,
      "runs",
      runId,
      "run.json"
    );
  }

  async save(record: RunState | RunStateStoreRecord): Promise<void> {
    await writeJsonAtomic(this.path, record);
  }

  async load(): Promise<RunState | RunStateStoreRecord> {
    return readJsonFile<RunState | RunStateStoreRecord>(this.path);
  }
}
