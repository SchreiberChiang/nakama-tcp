import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ownProfile, userDataRoot } from "../scripts/test-profile.mjs";
import { terminateOwned } from "../scripts/run-with-server.mjs";
import { networkTarget, acceptanceRounds } from "./network-target.mjs";
// Validate before creating evidence, profiles or any child process.
const target = networkTarget();
const rounds = acceptanceRounds();
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
let stopping = false;
process.on("message", message => { if (message?.type === "test-stop") stopping = true; });
const profileRoot = await userDataRoot();
const wait = async ms => {
  if (stopping) throw Error("Test stop requested");
  await new Promise(r => setTimeout(r, ms));
  if (stopping) throw Error("Test stop requested");
};
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
}
async function launch(role) {
  if (stopping) throw Error("Test stop requested before client launch");
  const dir = path.join(evidence, role);
  mkdirSync(dir);
  let output = "";
  const owner = ownProfile(profileRoot);
  const player = { role, dir, owner, child: null, id: 0, output: () => output };
  players.push(player);
  const child = player.child = spawn(
    process.env.GODOT,
    owner.args([
      ...(gui
        ? ["--position", role === "Host" ? "20,30" : "500,120"]
        : ["--headless"]),
      "--path",
      "client",
      "--script",
      "res://tests/driver.gd",
      "--",
      `--evidence=${dir}`,
      `--name=${role}`,
      `--fixture=${fixture}`,
      ...target.args,
      ...(diagnostics ? ["--diagnostics=true"] : []),
    ]),
    { windowsHide: true },
  );
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  let launchError;
  child.once("error", error => { launchError = error; });
  for (let i = 0; i < 200 && !existsSync(path.join(dir, "ready.json")); i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(output);
    await wait(50);
  }
  assert.ok(existsSync(path.join(dir, "ready.json")), "client started");
  assert.equal(path.resolve(JSON.parse(readFileSync(path.join(dir, "ready.json"))).profile_path), path.resolve(owner.file), "client uses exact owned profile");
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
  } else if (fault === "request") {
    // Actual loopback Nakama + two Godot Sessions; injected fixture failures,
    // not WAN fault evidence. No raw request/exception text is retained here.
    await command(host, "create");
    const room = await until(host, s => !!s.room && s.page === "room", "request fixture room created");
    await command(guest, "join", {room: room.room});
    await until(host, s => s.members === 2, "request fixture both clients joined");
    const select = async (p, selection, round = 1) => {
      await wait(250); // Respect Session's existing 220ms per-op control debounce.
      return command(p, "raw", {op: 5, payload: {round_id: round, selection}});
    };
    const before = await command(host), peerBefore = await command(guest);
    await command(host, "button", {button: "Ready"});
    await until(host, s => s.ready_self, "request host ready before faults");
    await select(host, {value: 3, test_error: true});
    const validation = await until(host, s => s.module_request_failures === 1, "selection validation error produces recoverable sender hint");
    check("selection validation preserves room readiness and selection", validation.room === room.room && validation.ready_self && validation.own.selected === 0 && validation.socket_instance === before.socket_instance);
    const peerAfterValidation = await until(guest, s => s.snapshot.tick > peerBefore.snapshot.tick + 3, "peer keeps receiving snapshots after selection validation error");
    check("selection validation error not broadcast to peer", peerAfterValidation.module_request_failures === 0 && peerAfterValidation.members === 2);
    await until(host, s => s.snapshot.tick >= validation.snapshot.tick + 31, "warning interval advances by simulation ticks");
    await select(host, {value: 7, throw_after: true});
    const thrown = await until(host, s => s.module_request_failures === 2, "select exception produces recoverable sender hint");
    check("nested failed candidate cannot change authority or ready", thrown.score === 0 && thrown.own.position.x === 0 && thrown.own.selected === 0 && thrown.ready_self && thrown.members === 2);
    await select(host, {value: 4, preserve_ready: true});
    const falseSelect = await until(host, s => s.own.selected === 4, "select false saves selection");
    check("select false preserves ready", falseSelect.ready_self);
    await select(guest, {value: 2});
    await until(guest, s => s.own.selected === 2, "peer legal selection after failures");
    await select(host, {value: 1, require_peer_selected: true});
    const changed = await until(host, s => s.own.selected === 1 && !s.ready_self, "select true clears ready and commits selection");
    check("request failures preserve account and room scope", changed.socket_instance === before.socket_instance && changed.presentation_scope === before.presentation_scope && !changed.module_failure && !changed.projection_failure);
    await until(host, s => s.snapshot.tick >= changed.snapshot.tick + 31, "control window advances before ready and start");
    await command(host, "button", {button: "Ready"});
    await command(guest, "button", {button: "Ready"});
    await until(host, s => s.snapshot.players.every(p => p.ready), "request round both ready");
    await command(host, "button", {button: "Start"});
    await until(host, s => s.phase === "playing" && s.active_module, "request round playing");
    await until(guest, s => s.phase === "playing" && s.active_module, "request peer playing");
    await command(host, "provider", {enabled: false});
    await wait(150);
    const playing = await command(host), peerPlaying = await command(guest);
    const rejected = await command(host, "request_error");
    const rejection = await until(host, s => s.own.command_results.some(r => r.seq === rejected.last_input_seq && r.status === "rejected_module_error"), "input validation exception has explicit terminal result");
    check("input validation failure keeps presentation and does not consume", rejection.module_request_failures === 3 && rejection.module_instance === playing.module_instance && rejection.socket_instance === playing.socket_instance && rejection.presentation_scope === playing.presentation_scope && rejection.room === room.room && rejection.own.accepted_input_seq === playing.own.accepted_input_seq && rejection.own.applied_input_seq === playing.own.applied_input_seq && !rejection.own.input_receipts.some(r => r.seq === rejected.last_input_seq) && rejection.score === 0);
    const peerAfterInput = await until(guest, s => s.snapshot.tick > peerPlaying.snapshot.tick + 4, "peer continues snapshots after input validation exception");
    check("input validation failure remains sender-only", peerAfterInput.module_request_failures === 0 && peerAfterInput.module_instance === peerPlaying.module_instance && peerAfterInput.members === 2);
    await command(host, "input");
    await until(host, s => s.score === 1, "next legal command after validation failure executes");
    await until(host, s => s.phase === "results", "request round reaches normal results", 22000);
    await command(host, "button", {button: "Rematch"});
    const replayed = await until(host, s => s.round === 2 && s.phase === "lobby" && s.module_request_failures === 4, "old selection failure recovers in next lobby");
    const replayPeer = await until(guest, s => s.round === 2 && s.own.selected === 2, "other member old selection replays successfully");
    check("failed replay restores only affected default without nested pollution", replayed.own.selected === 0 && replayed.score === 0 && replayed.own.position.x === 0 && !replayed.ready_self && replayed.members === 2 && replayPeer.module_request_failures === 0);
    await select(host, {value: 3}, 2);
    await until(host, s => s.own.selected === 3 && s.round === 2, "legal selection after failed replay works");
    check("request faults leave SDK requests drained", (await command(host)).sdk_pending === 0 && (await command(guest)).sdk_pending === 0);
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
    observations.push({ label: target.movementLabel, host: numericObservation(movingHost), guest: numericObservation(movingGuest) });
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
    if (rounds === 3) {
      await command(host, "button", {button: "Pulse"});
      await until(host, s => s.round === 2 && s.score === 1 && s.own.command_results.some(r => r.round_id === 2 && r.status === "applied"), "second round Pulse button scores authoritatively");
    }
    await until(host, s => s.phase === "results", "second round finishes", 22000);
    await command(host, "button", {button: "Rematch"});
    await until(host, s => s.phase === "lobby" && s.round === 3, "third lobby enables leave and rejoin checks");
    if (rounds === 3) {
      await command(host, "button", {button: "Ready"});
      await command(guest, "button", {button: "Ready"});
      await until(host, s => s.round === 3 && s.members === 2 && s.snapshot.players.every(p => p.ready), "third round both ready");
      await wait(250);
      await command(host, "button", {button: "Start"});
      await until(host, s => s.phase === "playing" && s.round === 3 && s.active_module, "third round host playing");
      await until(guest, s => s.phase === "playing" && s.round === 3 && s.active_module, "third round guest playing");
      const thirdNeutral = await command(host);
      check("third round resets authority and command outcomes", thirdNeutral.score === 0 && thirdNeutral.own.position.x === 0 && thirdNeutral.own.position.y === 0 && thirdNeutral.own.velocity.x === 0 && thirdNeutral.own.velocity.y === 0 && thirdNeutral.own.command_results.length === 0);
      await command(host, "move", {x: 1, y: 0});
      await command(guest, "move", {x: 0, y: 1});
      await until(host, s => s.round === 3 && s.own.position.x > 10, "third round host moves under authority");
      await until(guest, s => s.round === 3 && s.own.position.y > 10, "third round guest moves under authority");
      await command(host, "move", {x: 0, y: 0});
      await command(guest, "move", {x: 0, y: 0});
      await until(host, s => s.round === 3 && s.own.velocity.x === 0 && s.own.velocity.y === 0, "third round host release is consumed");
      await until(guest, s => s.round === 3 && s.own.velocity.x === 0 && s.own.velocity.y === 0, "third round guest release is consumed");
      const thirdPulse = await command(host, "input");
      await until(host, s => s.round === 3 && s.score === 1 && s.own.command_results.some(r => r.seq === thirdPulse.last_input_seq && r.round_id === 3 && r.status === "applied"), "third round exact pulse sequence and round applied");
      await until(host, s => s.phase === "results" && s.round === 3 && s.results === 2 && !s.active_module, "third round host authoritative results", 22000);
      await until(guest, s => s.phase === "results" && s.round === 3 && s.results === 2 && !s.active_module, "third round guest authoritative results");
      await command(host, "button", {button: "Rematch"});
      await until(host, s => s.phase === "lobby" && s.round === 4 && s.members === 2 && !s.ready_self, "fourth lobby retains members for existing cleanup checks");
    }
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
  const cleanupErrors = [];
  for (const p of players) {
    try {
      try {
        if (!stopping && p.child?.pid && p.child.exitCode === null) await command(p, "exit");
      } catch {}
      if (p.child?.pid) await terminateOwned(p.child, `test client ${p.role}`);
      p.owner.cleanup();
      for (const name of ["command.json", "response.json", "ready.json"])
        if (existsSync(path.join(p.dir, name))) unlinkSync(path.join(p.dir, name));
      writeFileSync(path.join(p.dir, "process.log"), p.output());
    } catch (error) { cleanupErrors.push(error); }
  }
  writeFileSync(
    path.join(evidence, "result.json"),
    JSON.stringify({ fixture, diagnostics, fault, acceptance_rounds_requested: rounds, remote_tls: target.remote, checks, audits,
      observations: observations.map(({label, ...values}) => ({label, ...numericOnly(values)})) }, null, 2),
  );
  if (process.connected) process.disconnect();
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Network client cleanup failed");
}
for (const p of players)
  assert.ok(
    !/(SCRIPT ERROR|^ERROR:|^WARNING:|Parse Error|PRIVATE_REQUEST_)/m.test(p.output()),
    p.output(),
  );
console.log(`PASS ${checks.length} checks; evidence ${evidence}`);
