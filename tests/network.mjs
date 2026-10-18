import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { terminateOwned } from "../scripts/run-with-server.mjs";
const fixture = process.env.TEST_FIXTURE === "1";
const gui = process.env.TEST_GUI === "1";
const diagnostics = process.env.TEST_DIAGNOSTICS === "1";
const fault = process.env.TEST_FAULT || "";
if (!process.env.GODOT) throw Error("Set GODOT.");
const evidence = path.resolve(
  ".local",
  `network-${fixture ? "fixture" : "empty"}-${Date.now()}`,
);
mkdirSync(evidence, { recursive: true });
const players = [];
const checks = [];
const audits = [];
const observations = [];
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
      ...(diagnostics ? ["--diagnostics=true"] : []),
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
  player.profilePath = JSON.parse(readFileSync(path.join(dir, "ready.json"))).profile_path;
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
  throw Error(`${label} timed out: ${JSON.stringify(value && {page: value.page, phase: value.phase, connected: value.connected, round: value.round, score: value.score, tick: value.snapshot?.tick})}`);
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
  audits.push({label, page: status.page, members: status.members, active_module: status.active_module, bad_nodes: status.bad_nodes, nodes: status.nodes, resources: status.resources});
}
function numericObservation(status) {
  return {authority_position: status.own.position, score: status.score, snapshot_tick: status.snapshot.tick,
    accepted_input_seq: status.own.accepted_input_seq, applied_input_seq: status.own.applied_input_seq,
    receipt_count: status.own.input_receipts?.length, command_result_count: status.own.command_results?.length, server_diagnostics: status.snapshot.diagnostics,
    client_diagnostics: status.diagnostics, presentation_diagnostics: status.timeline,
    presentation_pose_count: Object.keys(status.presentation).length};
}
function numericOnly(value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(numericOnly).filter(x => x !== undefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numericOnly(item)]).filter(([, item]) => item !== undefined));
  return undefined;
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
  if (fixture && !fault && !diagnostics) {
    for (const player of [host, guest]) {
      await until(player, s => s.rooms_state === "ready", `${player.role} initial room list loaded`);
      await command(player, "lobby_draft");
      await command(player, "button", {button: "Refresh"});
      const refreshed = await until(player, s => s.rooms_state === "ready", `${player.role} real room-list refresh completed`);
      check(`${player.role} real refresh preserves room draft`, refreshed.lobby_draft_valid && refreshed.room_count === 0);
    }
  }
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
  } else if (fault) {
    const options = fault === "input" ? {test_failure: "input"} : {test_projection_user: "Guest"};
    await command(host, "create", {options});
    const room = await until(host, s => !!s.room && s.page === "room", "fault fixture room created");
    await command(guest, "join", {room: room.room});
    await until(host, s => s.members === 2, "fault fixture both clients joined");
    await command(host, "button", {button: "Ready"});
    await command(guest, "button", {button: "Ready"});
    await until(host, s => s.snapshot.players.every(p => p.ready), "fault fixture both clients ready");
    await wait(250);
    await command(host, "button", {button: "Start"});
    if (fault === "input") {
      await until(host, s => s.module_failure && !s.room && !s.active_module && s.page === "lobby", "module input exception sends fixed error and exits host");
      await until(guest, s => s.module_failure && !s.room && !s.active_module && s.page === "lobby", "module input exception sends fixed error and exits guest");
    } else {
      await until(guest, s => s.projection_failure && !s.room && !s.active_module && s.page === "lobby", "single recipient projection failure exits affected guest");
      const unaffected = await until(host, s => s.phase === "playing" && s.active_module && !s.projection_failure, "unaffected recipient continues playing");
      await until(host, s => s.snapshot.tick > unaffected.snapshot.tick + 5 && !s.projection_failure, "unaffected recipient continues receiving fresh snapshots");
      await command(host, "button", {button: "Leave"});
    }
    check("fault path leaves SDK requests drained", (await command(guest)).sdk_pending === 0);
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
    await command(guest, "raw", { op: 3, payload: { round_id: room.round } });
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
    await command(host, "move", { x: 1, y: 0 });
    await command(guest, "move", { x: 0, y: 1 });
    await wait(650);
    const movingHost = await command(host), movingGuest = await command(guest);
    observations.push({ label: "loopback_movement", host: numericObservation(movingHost), guest: numericObservation(movingGuest) });
    check("authoritative continuous movement for two clients", movingHost.own.position.x > 10 && movingGuest.own.position.y > 10);
    check("both clients render two presentation poses", Object.keys(movingHost.presentation).length === 2 && Object.keys(movingGuest.presentation).length === 2);
    check("presentation advances from buffered authority", movingHost.presentation[movingHost.user_id].x > 0 && movingGuest.presentation[movingGuest.user_id].y > 0);
    check("private snapshot sentinel isolated on both recipients", !JSON.stringify(movingHost.snapshot).includes("PRIVATE_" + movingGuest.user_id) && !JSON.stringify(movingGuest.snapshot).includes("PRIVATE_" + movingHost.user_id));
    await command(host, "move", { x: 0, y: 0 });
    await command(guest, "move", { x: 0, y: 0 });
    if (gui) await command(host, "screenshot", { name: "playing" });
    await command(host, "input");
    await until(host, (s) => s.score === 1, "server applies module input");
    const applied = await command(host);
    const commandSeq = applied.last_input_seq;
    observations.push({ label: "command_applied", host: numericObservation(applied) });
    check("applied command receipt matches actual submitted sequence and tick", applied.own.input_receipts.some(r => r.seq === commandSeq && r.kind === "command" && Number.isInteger(r.tick)));
    if (diagnostics) {
    check("server diagnostics record received accepted consumed and sent", applied.snapshot.diagnostics.received > 0 && applied.snapshot.diagnostics.accepted > 0 && applied.snapshot.diagnostics.consumed > 0 && applied.snapshot.diagnostics.sent > 0);
    check("client diagnostics record actual snapshot consumption", applied.diagnostics.snapshot_consumed.count > 0);
    check("client consumed and completed byte counters measure actual UTF8 bytes", applied.diagnostics.snapshot_consumed.window_bytes > 0 && applied.diagnostics.send_completed.window_bytes > 0);
    await command(host, "diagnostics", {enabled: false});
    check("disabled client diagnostics clear numeric observations", Object.keys((await command(host)).diagnostics).join() === "enabled");
    } else {
      check("server diagnostics absent without environment flag", !Object.hasOwn(applied.snapshot, "diagnostics"));
      check("client diagnostics disabled without launch flag", applied.diagnostics.enabled === false && Object.keys(applied.diagnostics).length === 1);
    }
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: commandSeq, round_id: 1, kind: "command", client_tick: applied.snapshot.tick },
    });
    await wait(120);
    check(
      "exact applied command sequence replay does not score twice",
      (await command(host)).score === 1,
    );
    const stale = await command(host, "stale_command");
    await until(host, s => s.own.command_results.some(r => r.seq === stale.last_input_seq && r.status === "rejected_stale"), "stale command has explicit terminal rejection");
    await wait(1100);
    const retained = await command(host);
    check("state traffic does not evict command terminal results", retained.own.accepted_input_seq > stale.last_input_seq && !retained.own.input_receipts.some(r => r.seq === commandSeq) && retained.own.command_results.some(r => r.seq === commandSeq && r.status === "applied") && retained.own.command_results.some(r => r.seq === stale.last_input_seq && r.status === "rejected_stale") && retained.score === 1);
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: 10000, round_id: 999, kind: "command", client_tick: applied.snapshot.tick },
    });
    await wait(120);
    check(
      "stale/foreign round input ignored",
      (await command(host)).score === 1,
    );
    await command(host, "raw", {
      op: 1,
      payload: { pulse: true, seq: 10001, round_id: 1, kind: "command", client_tick: applied.snapshot.tick, score: 999 },
    });
    await wait(120);
    check("client score injection rejected", (await command(host)).score === 1);
    const results = await until(
      host,
      (s) => s.phase === "results" && s.results === 2,
      "authoritative results",
      22000,
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
    await command(host, "raw", {op: 2, payload: {ready: true, round_id: 1}});
    await wait(150);
    check("old-round control cannot ready the next round", !(await command(host)).ready_self);
    const reset = await command(host);
    check("rematch clears score position receipts and command results", reset.score === 0 && reset.own.position.x === 0 && reset.own.position.y === 0 && reset.own.input_receipts.length === 0 && reset.own.command_results.length === 0);
    await command(host, "button", {button: "Ready"});
    await command(guest, "button", {button: "Ready"});
    await until(host, s => s.ready_self && s.snapshot.players.every(p => p.ready), "second round both ready");
    await wait(250);
    await command(host, "button", {button: "Start"});
    await until(host, s => s.phase === "playing" && s.round === 2, "second round enters playing through countdown");
    await until(guest, s => s.phase === "playing" && s.round === 2, "guest enters second round");
    await wait(350);
    const neutral = await command(host);
    check("second round starts with neutral direction and zero score", neutral.score === 0 && neutral.own.position.x === 0 && neutral.own.position.y === 0 && neutral.own.velocity.x === 0 && neutral.own.velocity.y === 0 && neutral.own.command_results.length === 0);
    await command(host, "move", {x: 1, y: 0});
    await until(host, s => s.own.position.x > 10 && s.score === 0, "second round genuinely moves under new input");
    await command(host, "move", {x: 0, y: 0});
    await until(host, s => s.phase === "results", "second round finishes", 22000);
    await command(host, "button", {button: "Rematch"});
    await until(host, s => s.phase === "lobby" && s.round === 3, "third lobby enables leave and rejoin checks");
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
    if (p.profilePath && path.basename(p.profilePath).startsWith("template-test-")) {
      if (existsSync(p.profilePath)) unlinkSync(p.profilePath);
    }
    for (const name of ["command.json", "response.json", "ready.json"])
      if (existsSync(path.join(p.dir, name))) unlinkSync(path.join(p.dir, name));
    writeFileSync(path.join(p.dir, "process.log"), p.output());
  }
  writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify({ fixture, diagnostics, fault, checks, audits,
      observations: observations.map(({label, ...values}) => ({label, ...numericOnly(values)})) }, null, 2),
  );
}
for (const p of players)
  assert.ok(
    !/(SCRIPT ERROR|^ERROR:|^WARNING:|Parse Error)/m.test(p.output()),
    p.output(),
  );
console.log(`PASS ${checks.length} checks; evidence ${evidence}`);
