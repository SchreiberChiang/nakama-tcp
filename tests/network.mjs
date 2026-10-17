import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { terminateOwned } from "../scripts/run-with-server.mjs";
const fixture = process.env.TEST_FIXTURE === "1";
const gui = process.env.TEST_GUI === "1";
if (!process.env.GODOT) throw Error("Set GODOT.");
const evidence = path.resolve(
  ".local",
  `network-${fixture ? "fixture" : "empty"}-${Date.now()}`,
);
mkdirSync(evidence, { recursive: true });
const players = [];
const checks = [];
const audits = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
}
async function launch(role) {
  const dir = path.join(evidence, role);
  mkdirSync(dir);
  let output = "";
  const child = spawn(
    process.env.GODOT,
    [
      ...(gui
        ? ["--position", role === "Host" ? "20,30" : "500,120"]
        : ["--headless"]),
      "--path",
      "client",
      "--script",
      "res://tests/driver.gd",
      "--",
      `--profile=test-${randomUUID()}`,
      `--evidence=${dir}`,
      `--name=${role}`,
      `--fixture=${fixture}`,
    ],
    { windowsHide: true },
  );
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  const player = { role, dir, child, id: 0, output: () => output };
  players.push(player);
  for (let i = 0; i < 200 && !existsSync(path.join(dir, "ready.json")); i++) {
    if (child.exitCode !== null) throw Error(output);
    await wait(50);
  }
  assert.ok(existsSync(path.join(dir, "ready.json")), "client started");
  return player;
}
async function command(p, action = "status", extra = {}) {
  const id = ++p.id;
  const file = path.join(p.dir, "command.json");
  writeFileSync(file, JSON.stringify({ id, action, ...extra }));
  for (let i = 0; i < 200; i++) {
    if (p.child.exitCode !== null) throw Error(p.output());
    try {
      const value = JSON.parse(readFileSync(path.join(p.dir, "response.json")));
      if (value.id === id) {
        assert.ok(value.ok, `${p.role} command ${action}`);
        return value;
      }
    } catch (e) {
      if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
    await wait(40);
  }
  throw Error(
    `${p.role} command timed out: ${action}\n${p.output().slice(-3000)}`,
  );
}
async function until(p, predicate, label, timeout = 12000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await command(p);
    if (predicate(value)) {
      check(label, true);
      return value;
    }
    await wait(100);
  }
  throw Error(`${label} timed out: ${JSON.stringify(value)}`);
}
function audit(label, status) {
  check(label + " no 3D/audio/animation", status.bad_nodes.length === 0);
  check(
    label + " no old resources",
    !status.resources.some((x) =>
      /games\/|racing|stones|tabletop|vehicle|harbor|\.ogg|\.wav|\.glb/i.test(
        x,
      ),
    ),
  );
  audits.push({ label, ...status, room: undefined });
}
try {
  const host = await launch("Host");
  const guest = await launch("Guest");
  audit("login", await command(host));
  if (gui) await command(host, "screenshot", { name: "login" });
  await command(host, "login");
  await command(host, "login");
  await until(
    host,
    (s) => s.connected && s.page === "lobby",
    "host login (duplicate click guarded)",
  );
  await command(guest, "login");
  await until(guest, (s) => s.connected && s.page === "lobby", "guest login");
  const lobby = await command(host);
  audit("lobby", lobby);
  if (gui) await command(host, "screenshot", { name: "lobby" });
  if (!fixture) {
    check(
      "empty server catalog and client registry",
      lobby.catalog === 0 && lobby.modules === 0 && lobby.empty_state,
    );
    check("no module instance in lobby", !lobby.active_module);
    await command(host, "button", { button: "Logout" });
    await until(
      host,
      (s) => s.page === "login" && !s.connected,
      "logout clears connection",
    );
    await command(host, "login");
    await command(host, "cancel_login");
    await wait(500);
    await until(
      host,
      (s) => !s.connected && s.page === "login",
      "cancelled authentication cannot navigate late",
    );
  } else {
    await command(host, "button", { button: "Create" });
    const room = await until(
      host,
      (s) => !!s.room && s.members === 1 && s.page === "room",
      "create/join room",
    );
    audit("room", room);
    check("no module instance before start", !room.active_module);
    if (gui) await command(host, "screenshot", { name: "room" });
    await command(guest, "join", { room: room.room });
    await until(guest, (s) => s.members === 2, "guest joins");
    await until(
      host,
      (s) => s.members === 2 && s.host_self,
      "server assigns creator as host",
    );
    await command(guest, "raw", { op: 3, payload: {} });
    await wait(350);
    check(
      "server rejects non-host start",
      (await command(host)).phase === "lobby",
    );
    await command(host, "button", { button: "Ready" });
    await command(guest, "button", { button: "Ready" });
    await until(host, (s) => s.ready_self, "host ready");
    await until(guest, (s) => s.ready_self, "guest ready");
    await wait(300);
    await command(host, "button", { button: "Start" });
    await until(
      host,
      (s) => s.phase === "playing" && s.active_module,
      "host starts authoritative round",
    );
    await until(guest, (s) => s.phase === "playing", "guest enters round");
    await command(host, "input");
    await until(host, (s) => s.score === 1, "server applies module input");
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: 1, round_id: 1 },
    });
    await wait(120);
    check(
      "duplicate input sequence ignored",
      (await command(host)).score === 1,
    );
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: 100, round_id: 999 },
    });
    await wait(120);
    check(
      "stale/foreign round input ignored",
      (await command(host)).score === 1,
    );
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: 101, round_id: 1, score: 999 },
    });
    await wait(120);
    check("client score injection rejected", (await command(host)).score === 1);
    const results = await until(
      host,
      (s) => s.phase === "results" && s.results === 2,
      "authoritative results",
    );
    audit("results", results);
    check("module released for results", !results.active_module);
    if (gui) await command(host, "screenshot", { name: "results" });
    await until(guest, (s) => s.phase === "results", "guest gets results");
    await command(guest, "button", { button: "Rematch" });
    await wait(300);
    check(
      "guest cannot start next round",
      (await command(host)).phase === "results",
    );
    await command(host, "button", { button: "Rematch" });
    await until(
      host,
      (s) =>
        s.phase === "lobby" &&
        s.round === 2 &&
        s.members === 2 &&
        !s.ready_self,
      "rematch preserves members and resets readiness",
    );
    await command(host, "button", { button: "Leave" });
    await until(
      host,
      (s) => !s.room && s.connected,
      "explicit leave retains account",
    );
    await until(
      guest,
      (s) => s.members === 1 && s.host_self,
      "host transfers on leave",
    );
    await command(host, "join", { room: room.room });
    await until(host, (s) => s.members === 2, "rejoin after leave");
    await command(guest, "disconnect");
    await until(
      guest,
      (s) => !s.connected && s.page === "login" && !s.room,
      "socket disconnect clears local navigation",
    );
    await until(
      host,
      (s) => s.members === 1 && s.host_self,
      "disconnect removes member and transfers host",
      18000,
    );
    await command(guest, "login");
    await until(
      guest,
      (s) => s.connected && s.page === "lobby",
      "login after disconnect",
    );
    await command(guest, "join", { room: room.room });
    await until(guest, (s) => s.members === 2, "rejoin after disconnect");
    await command(host, "button", { button: "Leave" });
    await command(guest, "button", { button: "Leave" });
    await until(host, (s) => !s.room && s.connected, "host final leave");
    await until(guest, (s) => !s.room && s.connected, "guest final leave");
    check(
      "SDK has no accumulated fire-and-forget requests",
      (await command(host)).sdk_pending === 0,
    );
  }
} finally {
  for (const p of players) {
    try {
      if (p.child.exitCode === null) await command(p, "exit");
    } catch {}
    await terminateOwned(p.child, `test client ${p.role}`);
    writeFileSync(path.join(p.dir, "process.log"), p.output());
  }
  writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify({ fixture, checks, audits }, null, 2),
  );
}
for (const p of players)
  assert.ok(
    !/(SCRIPT ERROR|^ERROR:|^WARNING:|Parse Error)/m.test(p.output()),
    p.output(),
  );
console.log(`PASS ${checks.length} checks; evidence ${evidence}`);
