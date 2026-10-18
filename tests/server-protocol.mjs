// Pure Nakama callback tests. No sockets, backend processes, or account credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const c = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL("../.local/test-runtime/index.js", import.meta.url),
    "utf8",
  ),
  c,
);
let passes = 0;
function test(name, fn) {
  fn();
  passes++;
  console.log(`PASS ${name}`);
}
const users = ["alice", "bob"].map((userId) => ({
  userId,
  username: userId,
  sessionId: `session_${userId}`,
}));
const nk = {
  binaryToString: (b) => Buffer.from(b).toString(),
  usersGetId: () => [],
};
const out = [];
const d = {
  broadcastMessage: (op, data, recipients) =>
    out.push({ op, data, recipients }),
  matchKick: () => {},
  matchLabelUpdate: () => {},
};
function room(diagnostics = true) {
  const s = c.matchInit(
    { env: { GAME_DIAGNOSTICS: diagnostics ? "1" : "0" } },
    {},
    nk,
    { game_id: "fixture", name: "test", host_id: "alice", capacity: 2 },
  ).state;
  c.matchJoin({}, {}, nk, d, 0, s, users);
  s.phase = "playing";
  s.roundStart = 0;
  return s;
}
function send(s, seq, fields = {}, tick = 10, user = users[0]) {
  const body = {
    seq,
    round_id: 1,
    kind: "command",
    client_tick: tick,
    pulse: true,
    ...fields,
  };
  c.handleMessage(nk, d, s, tick, {
    sender: user,
    opCode: 1,
    data: Buffer.from(JSON.stringify(body)),
  });
}
function loop(s, tick) {
  c.matchLoop({}, {}, nk, d, tick, s, []);
}
test("version mismatch rejects before reserving seat", () => {
  const s = room();
  s.members = {};
  s.order = [];
  s.phase = "lobby";
  assert.equal(
    c.matchJoinAttempt({}, {}, nk, d, 1, s, users[0], {
      room_phase_version: "2",
    }).accept,
    false,
  );
  assert.equal(Object.keys(s.pending).length, 0);
  for (const mismatch of [
    { protocol_version: "2", module_version: "1" },
    { protocol_version: "1", module_version: "2" },
  ]) {
    assert.equal(
      c.matchJoinAttempt({}, {}, nk, d, 1, s, users[0], {
        room_phase_version: "2",
        ...mismatch,
      }).accept,
      false,
    );
    assert.equal(Object.keys(s.pending).length, 0);
  }
  assert.equal(
    c.matchJoinAttempt({}, {}, nk, d, 1, s, users[0], {
      room_phase_version: "2",
      protocol_version: "1",
      module_version: "1",
    }).accept,
    true,
  );
});
test("accepted precedes applied; duplicate command consumed once", () => {
  const s = room();
  send(s, 0);
  send(s, 0);
  assert.equal(s.members.alice.seq, 0);
  assert.equal(s.members.alice.appliedSeq, -1);
  loop(s, 10);
  assert.equal(s.game.players.alice.score, 1);
  assert.equal(s.members.alice.appliedSeq, 0);
  assert.equal(s.members.alice.receipts.length, 1);
  loop(s, 11);
  assert.equal(s.game.players.alice.score, 1);
});
test("state coalesces, integrates held direction, then neutral timeout", () => {
  const s = room();
  send(s, 0, { kind: "state", pulse: undefined, direction: { x: 1, y: 0 } });
  send(s, 1, { kind: "state", pulse: undefined, direction: { x: 0, y: 1 } });
  loop(s, 10);
  assert.equal(s.game.players.alice.x, 0);
  assert.equal(s.game.players.alice.y, 2);
  for (let t = 11; t <= 25; t++) loop(s, t);
  assert.equal(s.game.players.alice.y, 30);
  assert.equal(s.game.players.alice.dy, 0);
  assert.equal(s.members.alice.receipts.length, 1);
  assert.equal(s.members.alice.diagnostics.coalesced, 1);
});
test("bounded queue and two commands per simulation tick", () => {
  const s = room();
  for (let i = 0; i < 12; i++) send(s, i);
  assert.equal(s.members.alice.commands.length, 8);
  assert.equal(s.members.alice.seq, 7);
  loop(s, 10);
  assert.equal(s.game.players.alice.score, 2);
  assert.equal(s.members.alice.commands.length, 6);
});
test("stale round/session/time and giant sequence cannot poison acceptance", () => {
  const s = room();
  send(s, 0, { round_id: 2 });
  send(s, 0, {}, 10, { ...users[0], sessionId: "old" });
  send(s, 0, { client_tick: 0 }, 40);
  send(s, 0, { client_tick: 50 }, 10);
  send(s, Number.MAX_SAFE_INTEGER);
  assert.equal(s.members.alice.seq, -1);
  send(s, 0);
  assert.equal(s.members.alice.seq, 0);
});
test("expired queued commands are never applied", () => {
  const s = room();
  send(s, 0);
  loop(s, 41);
  assert.equal(s.game.players.alice.score, 0);
  assert.equal(s.members.alice.appliedSeq, -1);
});
test("exact receipts preserve late smaller command after larger state", () => {
  const s = room();
  for (let i = 0; i < 5; i++) send(s, i);
  send(s, 5, { kind: "state", pulse: undefined, direction: { x: 1, y: 0 } });
  loop(s, 10);
  loop(s, 11);
  loop(s, 12);
  assert.equal(s.members.alice.appliedSeq, 5);
  assert.ok(
    s.members.alice.receipts.some(
      (r) => r.seq === 4 && r.kind === "command" && r.tick === 12,
    ),
  );
});
test("receipts and diagnostics are bounded and opt out", () => {
  const s = room();
  for (let i = 0; i < 30; i++) {
    send(s, i, {}, 10 + i);
    loop(s, 10 + i);
  }
  assert.equal(s.members.alice.receipts.length, 16);
  c.bump(s.members.alice.diagnostics, "received", Number.MAX_SAFE_INTEGER);
  assert.equal(s.members.alice.diagnostics.received, 2147483647);
  const off = room(false);
  send(off, 0);
  loop(off, 10);
  assert.equal(c.snapshot(off, "alice").diagnostics, undefined);
});
test("per-recipient actual snapshot and result bytes hide other private state", () => {
  const s = room();
  out.length = 0;
  c.broadcast(d, s);
  s.phase = "results";
  s.results = c.LifecycleFixture.results(s.game, 10);
  c.broadcast(d, s);
  assert.equal(out.length, 4);
  for (const packet of out) {
    assert.equal(packet.recipients.length, 1);
    const self = packet.recipients[0].userId,
      other = self === "alice" ? "bob" : "alice";
    assert.ok(packet.data.includes(`PRIVATE_${self}`));
    assert.ok(!packet.data.includes(`PRIVATE_${other}`));
    assert.ok(!packet.data.includes("session_"));
  }
});
test("projection failure sends no raw fallback", () => {
  const s = room(),
    old = c.LifecycleFixture.projectResults;
  s.phase = "results";
  c.LifecycleFixture.projectResults = () => {
    throw Error("private failure");
  };
  out.length = 0;
  c.broadcast(d, s);
  assert.equal(out.length, 0);
  c.LifecycleFixture.projectResults = old;
});
test("shared module projection objects never accumulate core recipient fields", () => {
  const s = room(),
    old = c.LifecycleFixture.snapshot;
  send(s, 0);
  loop(s, 10);
  const shared = {
    players: [
      { user_id: "alice", username: "a" },
      { user_id: "bob", username: "b" },
    ],
    diagnostics: { secret: "sentinel" },
  };
  c.LifecycleFixture.snapshot = () => shared;
  out.length = 0;
  c.broadcast(d, s);
  const a = JSON.parse(out[0].data),
    b = JSON.parse(out[1].data);
  assert.equal(a.players[0].input_receipts.length, 1);
  assert.equal(b.players[0].input_receipts, undefined);
  assert.equal(shared.players[0].input_receipts, undefined);
  assert.equal(a.diagnostics.secret, undefined);
  c.LifecycleFixture.snapshot = old;
});
test("state capability requires neutral callback and unknown kind is rejected", () => {
  const old = c.LifecycleFixture.inputExpired;
  delete c.LifecycleFixture.inputExpired;
  assert.throws(() => room());
  c.LifecycleFixture.inputExpired = old;
  const s = room();
  send(s, 0, { kind: "invalid" });
  assert.equal(s.members.alice.seq, -1);
  const oldKinds = c.LifecycleFixture.inputKinds;
  c.LifecycleFixture.inputKinds = ["command"];
  send(s, 0, {
    kind: "state",
    pulse: undefined,
    direction: { x: 1, y: 0 },
  });
  assert.equal(s.members.alice.seq, -1);
  assert.equal(s.members.alice.continuous, null);
  assert.equal(s.members.alice.commands.length, 0);
  c.LifecycleFixture.inputKinds = oldKinds;
});
test("old round start cannot trigger new countdown", () => {
  const s = room();
  s.phase = "lobby";
  s.round_id = 2;
  for (const m of Object.values(s.members)) m.ready = true;
  c.handleMessage(nk, d, s, 10, {
    sender: users[0],
    opCode: 3,
    data: Buffer.from('{"round_id":1}'),
  });
  assert.equal(s.phase, "lobby");
});
test("oversized projection is dropped with bounded fixed error counter", () => {
  const s = room(),
    old = c.LifecycleFixture.snapshot;
  c.LifecycleFixture.snapshot = () => ({
    players: [],
    blob: "a".repeat(65537),
  });
  out.length = 0;
  c.broadcast(d, s);
  assert.equal(out.length, 0);
  assert.equal(s.members.alice.diagnostics.projection_error, 1);
  c.LifecycleFixture.snapshot = old;
});
test("failed module step publishes no application receipt", () => {
  const s = room(),
    old = c.LifecycleFixture.step;
  send(s, 0);
  c.LifecycleFixture.step = () => {
    throw Error("fail");
  };
  assert.throws(() => loop(s, 10));
  c.LifecycleFixture.step = old;
  assert.equal(s.members.alice.appliedSeq, -1);
  assert.equal(s.members.alice.receipts.length, 0);
});
test("30Hz simulation retains exactly twenty snapshots per second", () => {
  const s = room();
  out.length = 0;
  for (let t = 1; t <= 30; t++) loop(s, t);
  assert.equal(out.length, 40);
  assert.equal(s.tick, 30);
});
console.log(`${passes} pure server protocol tests passed`);
