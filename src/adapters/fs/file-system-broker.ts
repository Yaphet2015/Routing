import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BrokerEvent, BrokerMessage, EventLogEntry, ProtocolHeader } from "../../domain/protocol";
import { PROTOCOL_VERSION } from "../../domain/protocol";
import {
  appendNdjsonLine,
  ensureDir,
  fileExists,
  joinHarnessPath,
  readJsonFile,
  readNdjsonFile,
  writeJsonAtomic
} from "./file-utils";

interface AckState {
  upto_seq: number;
}

function isBrokerMessage(event: BrokerEvent): event is BrokerMessage {
  return "created_at" in event && "message_id" in event;
}

export class FileSystemBroker {
  private readonly eventsPath: string;
  private readonly projectionsDir: string;
  private readonly agentsDir: string;

  constructor(
    private readonly root: string,
    private readonly sessionId: string,
    private readonly runId: string
  ) {
    this.eventsPath = joinHarnessPath(
      root,
      "sessions",
      sessionId,
      "runs",
      runId,
      "events",
      "events.ndjson"
    );
    this.projectionsDir = joinHarnessPath(
      root,
      "sessions",
      sessionId,
      "runs",
      runId,
      "projections"
    );
    this.agentsDir = joinHarnessPath(
      root,
      "sessions",
      sessionId,
      "runs",
      runId,
      "agents"
    );
  }

  async publish(event: BrokerEvent): Promise<{ seq: number }> {
    const entries = await readNdjsonFile<EventLogEntry>(this.eventsPath);
    if (entries.length === 0) {
      await appendNdjsonLine(this.eventsPath, this.createProtocolHeader());
    } else {
      this.assertProtocolCompatible(entries[0]);
    }

    const events = entries.filter(
      (entry): entry is BrokerEvent => entry.type !== "protocol_header"
    );
    const seq = events.length + 1;
    const nextEvent = { ...event, seq } as BrokerEvent;
    await appendNdjsonLine(this.eventsPath, nextEvent);
    return { seq };
  }

  async deliver(messageId: string): Promise<void> {
    const events = await this.readBrokerEvents();
    const message = events.find(
      (event): event is BrokerMessage =>
        isBrokerMessage(event) && event.message_id === messageId
    );
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const agentId = message.to_agent_id ?? "leader";
    const inboxPath = this.getInboxPath(agentId);
    const inbox = await readNdjsonFile<BrokerMessage>(inboxPath);
    if (inbox.some((entry) => entry.message_id === messageId)) {
      return;
    }

    await appendNdjsonLine(inboxPath, message);
  }

  async pollInbox(agentId: string, afterSeq = 0): Promise<BrokerMessage[]> {
    const inbox = await readNdjsonFile<BrokerMessage>(this.getInboxPath(agentId));
    return inbox.filter((message) => message.seq > afterSeq);
  }

  async ack(agentId: string, uptoSeq: number): Promise<void> {
    const ackPath = this.getAckPath(agentId);
    const current = (await this.readAck(agentId)) ?? { upto_seq: 0 };
    await writeJsonAtomic(ackPath, {
      upto_seq: Math.max(current.upto_seq, uptoSeq)
    } satisfies AckState);
  }

  async *replay(afterSeq = 0): AsyncIterable<BrokerEvent> {
    const events = await this.readBrokerEvents();
    for (const event of events) {
      if (event.seq > afterSeq) {
        yield event;
      }
    }
  }

  async rebuildInbox(agentId: string): Promise<void> {
    const ack = (await this.readAck(agentId)) ?? { upto_seq: 0 };
    const events = await this.readBrokerEvents();
    const inbox = events.filter(
      (event): event is BrokerMessage =>
        isBrokerMessage(event) &&
        (event.to_agent_id ?? "leader") === agentId &&
        event.seq > ack.upto_seq
    );
    await ensureDir(join(this.agentsDir, agentId));
    const inboxPath = this.getInboxPath(agentId);
    await writeJsonAtomic(
      join(this.projectionsDir, `${agentId}-inbox.json`),
      inbox.map((message) => message.message_id)
    );
    const tempAsLines = inbox.map((message: BrokerMessage) => JSON.stringify(message)).join("\n");
    await ensureDir(join(this.agentsDir, agentId));
    await writeFile(inboxPath, tempAsLines.length > 0 ? `${tempAsLines}\n` : "", "utf8");
  }

  private async readAck(agentId: string): Promise<AckState | undefined> {
    const ackPath = this.getAckPath(agentId);
    if (!(await fileExists(ackPath))) {
      return undefined;
    }
    return readJsonFile<AckState>(ackPath);
  }

  private getInboxPath(agentId: string): string {
    return join(this.agentsDir, agentId, "inbox.ndjson");
  }

  private getAckPath(agentId: string): string {
    return join(this.agentsDir, agentId, "ack.json");
  }

  private async readBrokerEvents(): Promise<BrokerEvent[]> {
    const entries = await readNdjsonFile<EventLogEntry>(this.eventsPath);
    if (entries.length === 0) {
      return [];
    }

    this.assertProtocolCompatible(entries[0]);
    return entries.filter(
      (entry): entry is BrokerEvent => entry.type !== "protocol_header"
    );
  }

  private createProtocolHeader(): ProtocolHeader {
    return {
      type: "protocol_header",
      seq: 0,
      session_id: this.sessionId,
      run_id: this.runId,
      created_at: new Date().toISOString(),
      protocol_version: PROTOCOL_VERSION
    };
  }

  private assertProtocolCompatible(entry: EventLogEntry | undefined): void {
    if (!entry) {
      return;
    }

    if (entry.type !== "protocol_header") {
      throw new Error("Missing protocol header");
    }

    if (entry.protocol_version !== PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported protocol version: ${entry.protocol_version}`
      );
    }
  }
}
