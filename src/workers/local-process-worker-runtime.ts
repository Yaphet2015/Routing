import { spawn } from "node:child_process";

import type {
  LocalProcessRunInput,
  LocalProcessRunResult,
  WorkerRuntimePort
} from "../domain/ports";

export class LocalProcessWorkerRuntime implements WorkerRuntimePort {
  async run(input: LocalProcessRunInput): Promise<LocalProcessRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args ?? [], {
        cwd: input.cwd,
        env: input.env,
        stdio: "ignore"
      });

      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({
          exitCode: code ?? 1,
          signal
        });
      });
    });
  }
}
