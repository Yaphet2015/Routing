import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSystemBroker } from "../../src/adapters/fs/file-system-broker";
import { PROTOCOL_VERSION } from "../../src/domain/protocol";
import type { BrokerMessage } from "../../src/domain/protocol";
import type { CollaborationTask } from "../../src/domain/types";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "routing-broker-"));
}

function makeTask(taskId: string): CollaborationTask {
  return {
    id: taskId,
    run_id: "run-1",
    source_step_ids: ["step-1"],
    title: "Execute step",
    objective: "Do the work",
    required_profile: "executor",
    owner_policy: "leader_only",
    runtime_placement: "in_process",
    isolation_mode: "shared_workspace",
    dependencies: [],
    input_artifacts: [],
    acceptance_ref: {
      verification_spec_ids: ["verify-1"],
      done_when: {}
    },
    status: "Pending"
  };
}

function makeAssignment(messageId: string): BrokerMessage {
  return {
    type: "task_assignment",
    message_id: messageId,
    seq: 0,
    session_id: "session-1",
    run_id: "run-1",
    from_agent_id: "leader",
    to_agent_id: "leader",
    created_at: "2026-04-02T00:00:00.000Z",
    task: makeTask("task-1")
  };
}

describe("FileSystemBroker", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true }))
    );
    roots.length = 0;
  });

  it("publishes, delivers, and polls inbox messages idempotently", async () => {
    const root = await makeTempRoot();
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");

    const message = makeAssignment("message-1");
    const publishResult = await broker.publish(message);
    expect(publishResult.seq).toBe(1);

    const eventLog = await readFile(
      join(
        root,
        ".harness",
        "sessions",
        "session-1",
        "runs",
        "run-1",
        "events",
        "events.ndjson"
      ),
      "utf8"
    );
    expect(eventLog).toContain(`"type":"protocol_header"`);
    expect(eventLog).toContain(`"protocol_version":"${PROTOCOL_VERSION}"`);

    await broker.deliver("message-1");
    await broker.deliver("message-1");

    const inbox = await broker.pollInbox("leader");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.message_id).toBe("message-1");
  });

  it("replays canonical events and rebuilds inboxes from ack position", async () => {
    const root = await makeTempRoot();
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");

    await broker.publish(makeAssignment("message-1"));
    await broker.publish({
      type: "status_update",
      message_id: "message-2",
      seq: 0,
      session_id: "session-1",
      run_id: "run-1",
      from_agent_id: "leader",
      to_agent_id: "leader",
      created_at: "2026-04-02T00:00:01.000Z",
      status: "Running"
    });

    await broker.deliver("message-1");
    await broker.deliver("message-2");
    await broker.ack("leader", 1);

    await broker.rebuildInbox("leader");

    const inbox = await broker.pollInbox("leader");
    expect(inbox.map((message: BrokerMessage) => message.message_id)).toEqual(["message-2"]);

    const replayed: Array<BrokerMessage["type"]> = [];
    for await (const event of broker.replay()) {
      if ("type" in event && typeof event.type === "string") {
        replayed.push(event.type as BrokerMessage["type"]);
      }
    }

    expect(replayed).toEqual(["task_assignment", "status_update"]);
  });

  it("rejects replay when the protocol version is incompatible", async () => {
    const root = await makeTempRoot();
    roots.push(root);
    const broker = new FileSystemBroker(root, "session-1", "run-1");

    await broker.publish(makeAssignment("message-1"));

    const eventsPath = join(
      root,
      ".harness",
      "sessions",
      "session-1",
      "runs",
      "run-1",
      "events",
      "events.ndjson"
    );
    const raw = await readFile(eventsPath, "utf8");
    await writeFile(
      eventsPath,
      raw.replace(PROTOCOL_VERSION, "routing/test-incompatible"),
      "utf8"
    );

    const replay = async () => {
      for await (const _event of broker.replay()) {
        // exhaust iterator
      }
    };

    await expect(replay()).rejects.toThrow("Unsupported protocol version");
  });
});
