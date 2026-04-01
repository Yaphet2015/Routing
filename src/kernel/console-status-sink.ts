import type { BrokerMessage, RuntimeEvent } from "../domain/protocol";
import type { StatusSink } from "../domain/ports";

export class ConsoleStatusSink implements StatusSink {
  async onEvent(event: RuntimeEvent | BrokerMessage | { type: string }): Promise<void> {
    const detail = JSON.stringify(event);
    process.stdout.write(`${detail}\n`);
  }

  async flush(): Promise<void> {
    return;
  }
}
