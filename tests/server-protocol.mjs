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
const kicks = [];
const d = {
  broadcastMessage: (op, data, recipients) =>
    out.push({ op, data, recipients }),
  matchKick: (p) => kicks.push(...p),
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
  return c.matchLoop({}, {}, nk, d, tick, s, []);
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
    { protocol_version: "1", module_version: "1" },
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
      protocol_version: "2",
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
test("stale round/session/time and out-of-schema sequence do not advance acceptance", () => {
  const s = room();
  send(s, 0, { round_id: 2 });
  send(s, 0, {}, 10, { ...users[0], sessionId: "old" });
  send(s, 0, { client_tick: 0 }, 40);
  send(s, 0, { client_tick: 50 }, 10);
  send(s, Number.MAX_SAFE_INTEGER);
  assert.equal(s.members.alice.seq, -1);
  send(s, 1);
  assert.equal(s.members.alice.seq, 1);
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
  assert.equal(out.filter(p => p.op === 10).length, 0);
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
  assert.equal(out.filter(p => p.op === 10).length, 0);
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
  assert.equal(loop(s, 10), null);
  assert.equal(s.game.players.alice.score, 1);
  assert.ok(out.some(p => p.op === 11 && JSON.parse(p.data).error === "Module failure"));
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

const stateInput = { kind: "state", pulse: undefined, direction: { x: 1, y: 0 } };
test("command outcome survives later state and reports exact expiry", () => {
  const s = room();
  send(s, 5, {client_tick: 0}, 29);
  send(s, 6, stateInput, 31);
  loop(s, 31);
  assert.equal(s.game.players.alice.score, 0);
  assert.equal(s.members.alice.appliedSeq, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(s.members.alice.commandResults)), [{seq:5,round_id:1,tick:31,status:"expired"}]);
  for(let t=32;t<70;t++) {send(s,t,stateInput,t);loop(s,t);}
  assert.equal(s.members.alice.commandResults[0].status,"expired");
});
test("full queue refusal stays immutable after state advances shared sequence", () => {
  const s=room();
  for(let i=0;i<9;i++)send(s,i);
  send(s,10,stateInput);
  send(s,8);
  loop(s,10);
  const result=s.members.alice.commandResults.find(r=>r.seq===8);
  assert.equal(result.status,"rejected_full");
  assert.equal(s.members.alice.seq,10);
  send(s,9);
  assert.equal(s.members.alice.commandResults.find(r=>r.seq===9).status,"rejected_old_seq");
  send(s,0);loop(s,11);
  assert.equal(s.members.alice.commandResults.filter(r=>r.seq===0).length,1);
  assert.equal(s.members.alice.commandResults.find(r=>r.seq===0).status,"applied");
  for(let t=12;t<40;t++){send(s,t+100,stateInput,t);loop(s,t);}
  assert.equal(s.members.alice.commandResults.find(r=>r.seq===8).status,"rejected_full");
});
test("seventy valid states in one tick drop excess without strikes or kicks", () => {
  const s=room(), before=kicks.length;
  for(let i=0;i<70;i++)send(s,i,stateInput);
  assert.equal(s.members.alice.strikes,0);
  assert.equal(kicks.length,before);
  assert.equal(s.members.alice.diagnostics.rate_dropped,10);
  assert.equal(s.members.alice.seq,59);
});
test("tick edges reject future plus three and late minus thirty one", () => {
  const s=room();
  send(s,0,{client_tick:42},40);
  send(s,1,{client_tick:43},40);
  send(s,2,{client_tick:10},40);
  send(s,3,{client_tick:9},40);
  assert.equal(s.members.alice.seq,2);
  assert.equal(s.members.alice.diagnostics.future,1);
  assert.equal(s.members.alice.diagnostics.late,1);
  loop(s,41);
  assert.equal(s.members.alice.commandResults.find(r=>r.seq===2).status,"expired");
});
test("eight old queued commands expire with exact bounded reason counts", () => {
  const s=room();for(let i=0;i<8;i++)send(s,i,{client_tick:0},30);
  loop(s,31);
  assert.equal(s.members.alice.diagnostics.command_expired,8);
  assert.equal(s.members.alice.diagnostics.state_timeout,0);
  assert.equal(s.members.alice.commandResults.length,8);
  assert.ok(s.members.alice.commandResults.every(r=>r.status==="expired"));
});
test("command results bounded at thirty two and invisible to other recipient", () => {
  const s=room();for(let i=0;i<40;i++){send(s,i,{},i+10);loop(s,i+10);}
  assert.equal(s.members.alice.commandResults.length,32);
  assert.equal(c.snapshot(s,"bob").players.find(p=>p.user_id==="alice").command_results,undefined);
});
test("full authoritative state unchanged when projection returns live player refs", () => {
  const s=room(),old=c.LifecycleFixture.snapshot;
  const before=JSON.stringify(s.game);
  c.LifecycleFixture.snapshot=()=>({players:Object.values(s.game.players)});
  c.broadcast(d,s);
  assert.equal(JSON.stringify(s.game),before);
  c.LifecycleFixture.snapshot=old;
});
test("one recipient projection failure notifies and evicts after three consecutive errors", () => {
  const s=room(),old=c.LifecycleFixture.snapshot,before=kicks.length;
  c.LifecycleFixture.snapshot=(g,id)=>{if(id==="bob")throw Error("SECRET");return old(g,id);};
  out.length=0;c.broadcast(d,s);c.broadcast(d,s);c.broadcast(d,s);
  assert.equal(out.filter(p=>p.op===11).length,1);
  assert.equal(out.filter(p=>p.op===10).length,3);
  assert.equal(kicks.length,before+1);
  assert.equal(s.members.bob,undefined);
  assert.ok(out.every(p=>!p.data.includes("SECRET")));
  c.LifecycleFixture.snapshot=old;
});
test("successful projection resets consecutive failure streak", () => {
 const s=room(),old=c.LifecycleFixture.snapshot;
 c.LifecycleFixture.snapshot=()=>{throw Error("secret")};c.broadcast(d,s);
 c.LifecycleFixture.snapshot=old;c.broadcast(d,s);
 assert.equal(s.members.alice.projectionFailures,0);
});
test("input and neutral callback failures close whole room after actual mutation", () => {
 for(const fault of ["input","inputExpired"]){
  const s=room(),before=kicks.length;
  s.game.test_failure=fault;
  if(fault==="input") send(s,0);
  else {send(s,0,stateInput);loop(s,10);}
  out.length=0;
  assert.equal(loop(s,fault==="input"?10:25),null);
  assert.equal(kicks.length,before+2);
  assert.equal(s.game.players.alice[fault==="input"?"score":"dx"],fault==="input"?1:0);
  assert.equal(out.filter(p=>p.op===10).length,0);
  assert.ok(out.some(p=>p.op===11&&JSON.parse(p.data).error==="Module failure"));
  assert.ok(out.every(p=>!p.data.includes("PRIVATE_MODULE_FAILURE")));
 }
});
test("legal maximum seq blocks smaller seq until actual round reset", () => {
 const s=room();send(s,2147483647,stateInput);send(s,1);
 assert.equal(s.members.alice.seq,2147483647);
 assert.equal(s.members.alice.commandResults[0].status,"rejected_old_seq");
});
function control(s,op,body,tick=10,user=users[0]){c.handleMessage(nk,d,s,tick,{sender:user,opCode:op,data:Buffer.from(JSON.stringify(body))});}
function startRound(s,tick){for(const u of users)control(s,2,{ready:true,round_id:s.round_id},tick,u);control(s,3,{round_id:s.round_id},tick);assert.equal(s.phase,"countdown");for(let t=tick+1;t<=tick+90;t++)loop(s,t);assert.equal(s.phase,"playing");}
test("real countdown and second round clear pending input score receipts and direction", () => {
 const s=room();s.phase="lobby";
 send(s,1);assert.equal(s.members.alice.seq,-1);
 startRound(s,100);
 send(s,1,stateInput,190);send(s,2,{},190);loop(s,190);
 send(s,3,{},191);send(s,4,stateInput,191);
 const old=c.LifecycleFixture.finished;c.LifecycleFixture.finished=()=>true;loop(s,191);c.LifecycleFixture.finished=old;
 // Inputs queued at the results boundary must not cross rematch.
 s.members.alice.commands.push({payload:{seq:9,round_id:1,kind:"command",pulse:true,client_tick:191},tick:191});
 control(s,4,{round_id:1},192);
 assert.equal(s.phase,"lobby");assert.equal(s.round_id,2);
 const m=s.members.alice;
 assert.equal(m.seq,-1);assert.equal(m.commands.length,0);assert.equal(m.receipts.length,0);assert.equal(m.commandResults.length,0);assert.equal(m.continuous,null);
 assert.equal(s.game.players.alice.score,0);assert.equal(s.game.players.alice.x,0);assert.equal(s.game.players.alice.dx,0);
 startRound(s,200);
 assert.equal(s.game.players.alice.x,0);
 send(s,0,{...stateInput,round_id:2},290);loop(s,290);
 assert.ok(s.game.players.alice.x>0);
});
test("nonplaying lobby countdown results never advance accepted seq", () => {
 for(const phase of ["lobby","countdown","results"]){const s=room();s.phase=phase;send(s,123);assert.equal(s.members.alice.seq,-1);assert.equal(s.members.alice.diagnostics.not_playing,1);}
});
test("bounded input window configuration and absent env default diagnostics off", () => {
 const args=[{},nk,{game_id:"fixture",name:"test",host_id:"alice",capacity:2}];
 const defaults=c.matchInit({},...args).state;
 assert.equal(defaults.diagnosticsEnabled,false);assert.equal(defaults.inputWindow,30);assert.equal(defaults.stateTimeout,15);
 const custom=c.matchInit({env:{GAME_INPUT_WINDOW_TICKS:"90",GAME_STATE_TIMEOUT_TICKS:"40"}},...args).state;
 assert.equal(custom.inputWindow,90);assert.equal(custom.stateTimeout,40);
 const invalid=c.matchInit({env:{GAME_INPUT_WINDOW_TICKS:"301",GAME_STATE_TIMEOUT_TICKS:"0"}},...args).state;
 assert.equal(invalid.inputWindow,30);assert.equal(invalid.stateTimeout,15);
});
test("normal results cancels all remaining queued commands with exact outcomes", () => {
 const s=room(),old=c.LifecycleFixture.finished;
 for(let i=0;i<8;i++)send(s,i);
 c.LifecycleFixture.finished=()=>true;loop(s,10);c.LifecycleFixture.finished=old;
 assert.equal(s.phase,"results");assert.equal(s.members.alice.commands.length,0);
 assert.equal(s.members.alice.commandResults.filter(r=>r.status==="applied").length,2);
 assert.equal(s.members.alice.commandResults.filter(r=>r.status==="cancelled_round").length,6);
});
test("projection eviction cancels countdown below minimum membership", () => {
 const s=room(),old=c.LifecycleFixture.snapshot;
 s.phase="countdown";s.countdown=50;
 c.LifecycleFixture.snapshot=(g,id)=>{if(id==="bob")throw Error("secret");return old(g,id)};
 c.broadcast(d,s);c.broadcast(d,s);c.broadcast(d,s);c.LifecycleFixture.snapshot=old;
 assert.equal(s.phase,"lobby");assert.equal(s.countdown,0);assert.equal(s.members.alice.ready,false);
});
test("refused seq stays refused while known but may be accepted after bounded result eviction", () => {
 const s=room();
 send(s,100,{client_tick:13},10);
 assert.equal(s.members.alice.commandResults[0].status,"rejected_future");
 assert.equal(s.members.alice.seq,-1);
 // Its timestamp is now legal, but the exact refusal is still retained.
 send(s,100,{client_tick:13},11);
 assert.equal(s.members.alice.seq,-1);
 assert.equal(s.members.alice.commands.length,0);
 for(let i=0;i<32;i++)send(s,200+i,{client_tick:100},11);
 assert.equal(s.members.alice.commandResults.length,32);
 assert.equal(s.members.alice.commandResults.some(r=>r.seq===100),false);
 assert.equal(s.members.alice.seq,-1);
 // Rejections never advanced the accepted watermark; no infinite tombstone exists.
 send(s,100,{client_tick:13},11);
 assert.equal(s.members.alice.seq,100);
 assert.equal(s.members.alice.commands.length,1);
 assert.equal(s.members.alice.diagnostics.rate_dropped,0);
 loop(s,11);
 assert.equal(s.members.alice.commandResults.find(r=>r.seq===100).status,"applied");
 assert.equal(s.game.players.alice.score,1);
});
console.log(`${passes} pure server protocol tests passed`);
