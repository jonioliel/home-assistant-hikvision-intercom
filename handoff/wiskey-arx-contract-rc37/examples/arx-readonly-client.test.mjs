import test from "node:test";
import assert from "node:assert/strict";
import { WisKeyReadOnlyClient } from "./arx-readonly-client.mjs";

const summary = {
  api: { version: 1, min_client: 0, commands: ["overview/summary"] },
  access: { allowed: true }, stations: [], users: [], users_complete: false,
};

test("starts with operator session, summary and subscription", async () => {
  const calls = [];
  let listener;
  let cleaned = false;
  const transport = {
    async call(type) {
      calls.push(type);
      return type.endsWith("authorization/session") ? { allowed: true } : summary;
    },
    async subscribe(type, callback) { calls.push(type); listener = callback; return () => { cleaned = true; }; },
  };
  const events = [];
  const client = new WisKeyReadOnlyClient(transport, (event) => events.push(event));
  await client.start();
  assert.deepEqual(calls, [
    "hikvision_intercom/authorization/session",
    "hikvision_intercom/overview/summary",
    "hikvision_intercom/subscribe",
  ]);
  listener({ kind: "refresh" });
  assert.deepEqual(events, [{ kind: "refresh" }]);
  listener({ kind: "access_revoked" });
  assert.equal(client.summary, null);
  assert.equal(cleaned, true);
});

test("denies absent operator grant before subscribing", async () => {
  let subscribed = false;
  const client = new WisKeyReadOnlyClient({
    async call() { return { allowed: false }; },
    async subscribe() { subscribed = true; },
  });
  await assert.rejects(client.start(), /wiskey_access_denied/);
  assert.equal(subscribed, false);
});

test("cleans subscription even when access is revoked during registration", async () => {
  let cleaned = false;
  const client = new WisKeyReadOnlyClient({
    async call(type) { return type.endsWith("authorization/session") ? { allowed: true } : summary; },
    async subscribe(_type, onEvent) {
      onEvent({ kind: "access_revoked" });
      return () => { cleaned = true; };
    },
  });
  await client.start();
  assert.equal(client.closed, true);
  assert.equal(cleaned, true);
});
