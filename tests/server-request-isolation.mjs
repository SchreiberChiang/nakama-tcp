// Pure exported matchLoop regressions. No backend, sockets, accounts, or services.
// SERVER_REQUEST_RUNTIME optionally selects another checkout's fixture build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const runtime = readFileSync(process.env.SERVER_REQUEST_RUNTIME ||
  new URL("../.local/test-runtime/index.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const users = ["alice", "bob"].map(userId => ({userId, username:userId, sessionId:`session_${userId}`}));
const secret = "PRIVATE_REQUEST_EXCEPTION_TOKEN password=secret session_alice";
function harness(phase = "playing", diagnostics = true) {
  const c = vm.createContext({});
  vm.runInContext(runtime, c);
  const packets = [], kicks = [], logs = [];
  const nk = {binaryToString:b=>Buffer.from(b).toString(), usersGetId:()=>[]};
  const d = {broadcastMessage:(op,data,recipients)=>packets.push({op,data,recipients}),
    matchKick:p=>kicks.push(...p), matchLabelUpdate:()=>{}};
  const logger = Object.fromEntries(["debug","info","warn","error"].map(k=>[k,(...args)=>logs.push({level:k,args})]));
  const s = c.matchInit({env:{GAME_DIAGNOSTICS:diagnostics?"1":"0",GAME_SNAPSHOT_RATE:"30"}}, logger, nk,
    {game_id:"fixture",name:"request isolation",host_id:"alice",capacity:2}).state;
  c.matchJoin({},logger,nk,d,0,s,users);
  s.phase=phase; s.roundStart=0;
  packets.length=0;
  const module=c.LifecycleFixture;
  module.validateSelection=()=>true;
  module.select=(g,id,p)=>{g.players[id].choice=p;return true;};
  const loop=(tick=10,messages=[])=>c.matchLoop({},logger,nk,d,tick,s,messages);
  return {c,s,module,packets,kicks,logs,loop};
}
const message=(op,body,user=users[0])=>({sender:user,opCode:op,data:Buffer.from(JSON.stringify(body))});
const input=(seq=0,extra={},user=users[0],tick=10)=>message(1,{seq,round_id:1,kind:"command",client_tick:tick,pulse:true,...extra},user);
const selection=(value={colour:"red"},user=users[0],round=1)=>message(5,{round_id:round,selection:value},user);
function alive(h,result) {
  assert.ok(result,"matchLoop must keep the room alive");
  assert.equal(result.state,h.s);
  assert.deepEqual(Object.keys(h.s.members).sort(),["alice","bob"]);
  assert.equal(h.kicks.length,0);
  assert.equal(h.packets.filter(p=>p.op===10).length,2,"both recipients receive snapshots");
}
const outcome=(h,seq)=>h.s.members.alice.commandResults.find(r=>r.seq===seq);
function unchangedInput(h) {
  const m=h.s.members.alice;
  assert.equal(m.seq,-1);assert.equal(m.appliedSeq,-1);assert.equal(m.acceptedTick,-1);
  assert.equal(m.appliedTick,-1);assert.equal(m.commands.length,0);assert.equal(m.continuous,null);
  assert.equal(m.receipts.length,0);assert.equal(m.diagnostics.accepted,0);
  assert.equal(m.strikes,0);
}
function sanitized(h) {
  for(const p of h.packets) assert.ok(!p.data.includes(secret));
  assert.ok(!JSON.stringify(h.logs).includes(secret));
}
let passes=0,failures=0;
const filter=process.argv.find(a=>a.startsWith("--filter="))?.slice(9);
function test(name,fn) {
  if(filter&&!name.includes(filter))return;
  try{fn();passes++;console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}\n${e.stack}`);}
}

for(const callback of ["validateInput","validateSelection","select"]) {
  for(const mode of ["throw","undefined","object","number","string"]) test(`${callback} ${mode} stays request-local through matchLoop`,()=>{
    const h=harness(callback==="validateInput"?"playing":"lobby");
    h.s.members.alice.ready=true;h.s.members.alice.selection=vm.runInContext('({colour:"old"})',h.c);
    const game=h.s.game,before=JSON.stringify(game),stored=h.s.members.alice.selection;
    h.module[callback]=()=>{if(mode==="throw")throw Error(secret);return ({undefined:undefined,object:{},number:1,string:"true"})[mode];};
    alive(h,h.loop(10,[callback==="validateInput"?input():selection()]));
    assert.equal(h.s.game,game);assert.equal(JSON.stringify(h.s.game),before);
    assert.equal(h.s.members.alice.selection,stored);assert.equal(h.s.members.alice.ready,true);
    unchangedInput(h);assert.equal(h.s.members.alice.diagnostics.module_request_error,1);
    if(callback==="validateInput")assert.equal(outcome(h,0).status,"rejected_module_error");
    assert.equal(h.packets.filter(p=>p.op===11).length,1);
    assert.equal(JSON.parse(h.packets.find(p=>p.op===11).data).error,"Module request failure");
    sanitized(h);
  });
}
test("select nested mutation before exception cannot touch real game selection or ready",()=>{
  const h=harness("lobby"),m=h.s.members.alice;
  m.ready=true;m.selection=vm.runInContext('({nested:{colour:"old"}})',h.c);
  h.s.game.shared=vm.runInContext('({items:[{value:1}]})',h.c);
  const game=h.s.game,before=JSON.stringify(game),stored=m.selection;
  let called=0;
  h.module.select=(candidate,id,p)=>{called++;candidate.shared.items[0].value=99;candidate.players.bob.score=999;p.nested.colour="bad";throw Error(secret);};
  alive(h,h.loop(10,[selection({nested:{colour:"new"}})]));
  assert.equal(called,1);assert.equal(h.s.game,game);assert.equal(JSON.stringify(game),before);
  assert.equal(m.selection,stored);assert.deepEqual(plain(m.selection),{nested:{colour:"old"}});assert.equal(m.ready,true);
});
test("later message in same tick and next legal request survive validator exception",()=>{
  const h=harness(),old=h.module.validateInput;
  h.module.validateInput=p=>{if(p.seq===0)throw Error(secret);return old(p);};
  alive(h,h.loop(10,[input(0),input(1,{},users[1])]));
  assert.equal(h.s.game.players.bob.score,1);assert.equal(h.s.game.players.alice.score,0);
  h.packets.length=0;alive(h,h.loop(11,[input(2,{},users[0],11)]));
  assert.equal(h.s.game.players.alice.score,1);assert.equal(outcome(h,0).status,"rejected_module_error");
  assert.equal(outcome(h,2).status,"applied");
});
for(const callback of ["validateSelection","select"])test(`${callback} fault permits later selection and next legal request`,()=>{
  const h=harness("lobby"),old=h.module[callback];
  h.module[callback]=(...args)=>{const p=args[callback==="select"?2:0];if(p.colour==="bad")throw Error(secret);return old(...args);};
  alive(h,h.loop(10,[selection({colour:"bad"}),selection({colour:"blue"},users[1])]));
  assert.equal(h.s.members.alice.selection,null);assert.deepEqual(plain(h.s.members.bob.selection),{colour:"blue"});
  h.packets.length=0;alive(h,h.loop(11,[selection({colour:"red"})]));
  assert.deepEqual(plain(h.s.members.alice.selection),{colour:"red"});
});
for(const callback of ["validateInput","validateSelection"])test(`${callback} false is normal rejection without strikes`,()=>{
  const h=harness(callback==="validateInput"?"playing":"lobby");h.module[callback]=()=>false;
  alive(h,h.loop(10,[callback==="validateInput"?input():selection()]));unchangedInput(h);
  assert.equal(h.s.members.alice.diagnostics.module_request_error,0);
  assert.ok(h.packets.some(p=>p.op===11&&JSON.parse(p.data).error===
    (callback==="validateInput"?"Invalid input schema":"Invalid player selection")));
});
test("fixture missing or null state direction is ordinary boolean rejection",()=>{
  for (const direction of [undefined, null]) {
    const h=harness();
    alive(h,h.loop(10,[input(0,{kind:"state",pulse:undefined,direction})]));
    unchangedInput(h);
    assert.equal(h.s.members.alice.diagnostics.module_request_error,0);
    assert.equal(h.s.members.alice.commandResults.length,0);
  }
});

const rejectionPackets=h=>h.packets.filter(p=>p.op===11&&JSON.parse(p.data).message==="Request rejected");
test("39 score injections emit one rejection without strikes or command outcomes",()=>{
  const h=harness(),old=h.module.validateInput;let calls=0;
  h.module.validateInput=p=>{calls++;return old(p);};
  alive(h,h.loop(10,Array.from({length:39},(_,seq)=>input(seq,{score:999}))));
  unchangedInput(h);assert.equal(calls,39);assert.equal(rejectionPackets(h).length,1);
  assert.equal(h.s.members.alice.commandResults.length,0);
  assert.equal(h.s.members.alice.diagnostics.module_request_error,0);assert.equal(h.logs.length,0);
  assert.ok(h.loop(11,[input(0,{},users[0],11)]));
  assert.equal(h.s.game.players.alice.score,1);assert.equal(outcome(h,0).status,"applied");
});
test("business rejection first tick and exact 30 tick boundary only limit prompts",()=>{
  const h=harness();let calls=0;h.module.validateInput=()=>{calls++;return false;};
  for(const [tick,expected] of [[0,1],[29,1],[30,2],[59,2],[60,3]]) {
    assert.ok(h.loop(tick,[input(0,{},users[0],tick)]));
    assert.equal(rejectionPackets(h).length,expected);unchangedInput(h);
  }
  assert.equal(calls,5);assert.equal(h.s.members.alice.commandResults.length,0);
});
test("business rejection prompt budgets are isolated by member",()=>{
  const h=harness();h.module.validateInput=()=>false;
  alive(h,h.loop(10,[input(),input(0,{},users[1]),input(1),input(1,{},users[1])]));
  assert.deepEqual(rejectionPackets(h).map(p=>p.recipients[0].userId),["alice","bob"]);
  assert.equal(h.s.members.alice.strikes,0);assert.equal(h.s.members.bob.strikes,0);
});
for(const first of ["input","selection"])test(`${first} and other business rejection share a prompt budget`,()=>{
  const h=harness(first==="input"?"playing":"lobby");let inputs=0,selections=0;
  h.module.validateInput=()=>{inputs++;return false;};
  h.module.validateSelection=()=>{selections++;return false;};
  const send=(kind,tick)=>{h.s.phase=kind==="input"?"playing":"lobby";assert.ok(h.loop(tick,[kind==="input"?input(0,{},users[0],tick):selection()]));};
  const other=first==="input"?"selection":"input";
  send(first,10);send(other,39);assert.equal(rejectionPackets(h).length,1);
  send(other,40);assert.equal(rejectionPackets(h).length,2);
  assert.equal(inputs+selections,3);unchangedInput(h);
  assert.equal(h.s.members.alice.selection,null);assert.equal(h.s.members.alice.commandResults.length,0);
});
for(const first of ["business","module"])test(`${first} rejection does not spend other failure prompt budget`,()=>{
  const h=harness();h.module.validateInput=p=>{if(p.seq===1)throw Error(secret);return false;};
  assert.ok(h.loop(10,(first==="business"?[0,1,2,3]:[1,0,3,2]).map(seq=>input(seq))));
  assert.equal(rejectionPackets(h).length,1);
  assert.equal(h.packets.filter(p=>p.op===11&&JSON.parse(p.data).error==="Module request failure").length,1);
  assert.equal(h.logs.length,1);unchangedInput(h);
  assert.equal(outcome(h,1).status,"rejected_module_error");assert.equal(h.s.members.alice.commandResults.length,1);
});
test("suppressed business prompt preserves queued command and continuous control",()=>{
  const h=harness(),old=h.module.validateInput;
  h.module.validateInput=p=>p.score===undefined?old(p):false;
  assert.ok(h.loop(10,[input(0),input(1),input(2),input(3,{kind:"state",pulse:undefined,direction:{x:1,y:0}}),input(4,{score:999}),input(5,{score:999})]));
  const m=h.s.members.alice;
  assert.equal(rejectionPackets(h).length,1);assert.equal(m.seq,3);assert.equal(m.acceptedTick,10);
  assert.deepEqual(plain(m.commands.map(q=>q.payload.seq)),[2]);assert.equal(m.continuous.payload.seq,3);
  assert.equal(outcome(h,4),undefined);assert.equal(outcome(h,5),undefined);assert.equal(m.diagnostics.accepted,4);
  assert.ok(h.loop(11));assert.equal(outcome(h,2).status,"applied");assert.equal(h.s.game.players.alice.score,3);
});

for(const op of [1,5])for(const key of ["__proto__","constructor","prototype"])for(const shape of ["root","nested","array"])test(`client op${op} ${shape} ${key} is a core violation before module calls`,()=>{
  const h=harness(op===1?"playing":"lobby"),m=h.s.members.alice;let calls=0;
  h.module.validateInput=h.module.validateSelection=h.module.select=()=>{calls++;throw Error(secret);};
  const dangerous=JSON.parse(`{"${key}":true}`);
  const value=shape==="root"?dangerous:shape==="nested"?{nested:dangerous}:{nested:[{deep:dangerous}]};
  const msg=op===1?input(0,value):selection(value);
  alive(h,h.loop(10,[msg]));assert.equal(calls,0);assert.equal(m.strikes,1);
  assert.equal(m.seq,-1);assert.equal(m.acceptedTick,-1);assert.equal(m.appliedSeq,-1);
  assert.equal(m.commands.length,0);assert.equal(m.continuous,null);assert.equal(m.receipts.length,0);
  assert.equal(m.commandResults.length,0);assert.equal(m.diagnostics.accepted,0);
  assert.equal(m.selection,null);assert.equal(m.diagnostics.module_request_error,0);
  assert.equal(m.diagnostics.request_clone_error,0);assert.equal(h.logs.length,0);
  assert.ok(h.packets.some(p=>p.op===11&&JSON.parse(p.data).error===(op===1?"Invalid input schema":"Invalid player selection")));
});
for(const op of [1,5])test(`client op${op} reserved keys retain strike kick and healthy peer progress`,()=>{
  const h=harness(op===1?"playing":"lobby"),m=h.s.members.alice;let calls=0;
  const callback=op===1?"validateInput":"validateSelection",old=h.module[callback];
  h.module[callback]=p=>{calls++;return old(p);};
  const dangerous=JSON.parse('{"nested":[{"constructor":true}]}');
  const bad=()=>op===1?input(0,dangerous):selection(dangerous);
  assert.ok(h.loop(10,Array.from({length:7},bad)));assert.equal(m.strikes,7);assert.equal(h.kicks.length,0);
  assert.ok(h.loop(11,[bad(),op===1?input(0,{},users[1],11):selection({colour:"blue"},users[1])]));
  assert.equal(m.strikes,8);assert.deepEqual(h.kicks.map(p=>p.userId),["alice"]);assert.equal(calls,1);
  assert.equal(m.commandResults.length,0);assert.equal(m.diagnostics.accepted,0);assert.equal(m.diagnostics.module_request_error,0);
  assert.equal(h.logs.length,0);
  if(op===1)assert.equal(h.s.game.players.bob.score,1);
  else assert.deepEqual(plain(h.s.members.bob.selection),{colour:"blue"});
});
for(const changed of [false,true])test(`select ${changed} commits candidate and ${changed?"clears":"retains"} ready`,()=>{
  const h=harness("lobby"),m=h.s.members.alice;m.ready=true;const game=h.s.game;
  h.module.select=(candidate,id,p)=>{candidate.players[id].choice=p;return changed;};
  alive(h,h.loop(10,[selection()]));assert.notEqual(h.s.game,game);
  assert.deepEqual(plain(m.selection),{colour:"red"});assert.deepEqual(plain(h.s.game.players.alice.choice),{colour:"red"});
  assert.equal(m.ready,!changed);
});
test("validator mutation cannot alter consumed input envelope or body",()=>{
  const h=harness();h.module.validateInput=p=>{p.pulse=false;p.seq=999;p.round_id=999;p.kind="state";return true;};
  alive(h,h.loop(10,[input(4)]));assert.equal(h.s.game.players.alice.score,1);
  assert.equal(h.s.members.alice.seq,4);assert.equal(h.s.members.alice.appliedSeq,4);assert.equal(outcome(h,4).status,"applied");
});
test("selection validator mutation cannot alter selection stored or passed to select",()=>{
  const h=harness("lobby");h.module.validateSelection=p=>{p.nested.colour="bad";return true;};
  alive(h,h.loop(10,[selection({nested:{colour:"red"}})]));
  assert.deepEqual(plain(h.s.members.alice.selection),{nested:{colour:"red"}});
  assert.deepEqual(plain(h.s.game.players.alice.choice),{nested:{colour:"red"}});
});
for(const gate of ["phase","round","session","envelope","oldseq","future","stale","rate","queue"])test(`input ${gate} gate runs before module validator`,()=>{
  const h=harness();let calls=0;h.module.validateInput=()=>{calls++;throw Error(secret);};
  let msg=input();const m=h.s.members.alice;
  if(gate==="phase")h.s.phase="lobby";
  if(gate==="round")msg=input(0,{round_id:2});
  if(gate==="session")msg=input(0,{}, {...users[0],sessionId:"old_session"});
  if(gate==="envelope")msg=input(-1);
  if(gate==="oldseq")m.seq=1;
  if(gate==="future")msg=input(0,{client_tick:13});
  if(gate==="stale")msg=input(0,{client_tick:0});
  if(gate==="rate"){m.window=0;m.inputs=60;}
  if(gate==="queue")for(let n=0;n<8;n++)m.commands.push({payload:{seq:20+n,round_id:1,kind:"command",client_tick:10,pulse:true},tick:10});
  const tick=gate==="stale"?40:10;
  alive(h,h.loop(tick,[msg]));assert.equal(calls,0);assert.equal(m.diagnostics.module_request_error,0);
});
for(const gate of ["phase","round","session","envelope","rate"])test(`selection ${gate} gate runs before module callbacks`,()=>{
  const h=harness("lobby");let calls=0;
  h.module.validateSelection=h.module.select=()=>{calls++;throw Error(secret);};
  let msg=selection();
  if(gate==="phase")h.s.phase="playing";
  if(gate==="round")msg=selection({},users[0],2);
  if(gate==="session")msg=selection({}, {...users[0],sessionId:"old"});
  if(gate==="envelope")msg=message(5,{round_id:1,selection:[]});
  if(gate==="rate"){h.s.members.alice.window=0;h.s.members.alice.controls=6;}
  alive(h,h.loop(10,[msg]));assert.equal(calls,0);
});
test("module-error command outcomes are bounded and duplicates never re-enter validator",()=>{
  const h=harness();let calls=0;h.module.validateInput=()=>{calls++;throw Error(secret);};
  for(let seq=0;seq<40;seq++)assert.ok(h.loop(10,[input(seq)]));
  const m=h.s.members.alice;assert.equal(m.commandResults.length,32);assert.equal(m.commandResults[0].seq,8);
  const before=JSON.stringify(m.commandResults);assert.ok(h.loop(11,[input(39,{},users[0],11)]));
  assert.equal(calls,40);assert.equal(JSON.stringify(m.commandResults),before);unchangedInput(h);
});
test("duplicate queued and applied commands cannot overwrite outcomes or invoke faulty validator",()=>{
  const h=harness();assert.ok(h.loop(10,[input(0),input(1),input(2)]));
  assert.equal(h.s.members.alice.commands.length,1);let calls=0;
  h.module.validateInput=()=>{calls++;throw Error(secret);};
  assert.ok(h.loop(11,[input(0,{},users[0],11),input(2,{},users[0],11)]));
  assert.equal(calls,0);assert.equal(outcome(h,0).status,"applied");assert.equal(outcome(h,2).status,"applied");
  assert.equal(h.s.game.players.alice.score,3);
});
test("state validator error has no command outcome and retains previous queued control",()=>{
  const h=harness();const state={kind:"state",pulse:undefined,direction:{x:1,y:0}};
  assert.ok(h.loop(10,[input(0,state)]));const original=h.s.members.alice.continuous;
  h.module.validateInput=()=>{throw Error(secret);};assert.ok(h.loop(11,[input(1,state,users[0],11)]));
  assert.equal(h.s.members.alice.continuous,original);assert.equal(h.s.members.alice.seq,0);
  assert.equal(h.s.members.alice.appliedSeq,0);assert.equal(h.s.members.alice.commandResults.length,0);
});
test("validator fault does not replace accepted queue or consume rejected command",()=>{
  const h=harness(),old=h.module.validateInput;
  h.module.validateInput=p=>{if(p.seq===3)throw Error(secret);return old(p);};
  const game=h.s.game;
  alive(h,h.loop(10,[input(0),input(1),input(2),input(3)]));
  const m=h.s.members.alice;
  assert.equal(h.s.game,game);assert.equal(m.seq,2);assert.equal(m.appliedSeq,1);
  assert.equal(m.diagnostics.accepted,3);assert.equal(m.receipts.length,2);
  assert.deepEqual(plain(m.commands.map(q=>q.payload.seq)),[2]);assert.equal(outcome(h,3).status,"rejected_module_error");
  h.packets.length=0;alive(h,h.loop(11));assert.equal(h.s.game.players.alice.score,3);
  assert.equal(m.appliedSeq,2);assert.equal(outcome(h,3).status,"rejected_module_error");
});
test("warning and callback logs are bounded and sanitize exceptions",()=>{
  const h=harness();h.module.validateInput=()=>{throw Error(secret);};
  for(let i=0;i<8;i++)assert.ok(h.loop(10,[input(i)]));
  assert.equal(h.packets.filter(p=>p.op===11).length,1);assert.equal(h.logs.length,1);
  assert.ok(h.loop(40,[input(8,{},users[0],40)]));
  assert.equal(h.packets.filter(p=>p.op===11).length,2);assert.equal(h.logs.length,2);sanitized(h);
  assert.equal(h.s.members.alice.diagnostics.module_request_error,9);
});
test("diagnostics disabled still isolates faults without private logs",()=>{
  const h=harness("playing",false);h.module.validateInput=()=>{throw Error(secret);};
  alive(h,h.loop(10,[input()]));sanitized(h);assert.equal(outcome(h,0).status,"rejected_module_error");
});
test("rematch selection replay drops only offending selection and preserves all other members",()=>{
  const h=harness("results");h.s.members.alice.selection=vm.runInContext('({colour:"bad"})',h.c);h.s.members.bob.selection=vm.runInContext('({colour:"blue"})',h.c);
  h.module.select=(g,id,p)=>{g.players[id].choice=p;if(id==="alice"){g.players[id].score=1000;throw Error(secret);}return true;};
  alive(h,h.loop(10,[message(4,{round_id:1})]));assert.equal(h.s.phase,"lobby");assert.equal(h.s.round_id,2);
  assert.equal(h.s.members.alice.selection,null);assert.equal(h.s.game.players.alice.choice,undefined);
  assert.equal(h.s.game.players.alice.score,0);assert.deepEqual(plain(h.s.game.players.bob.choice),{colour:"blue"});
  assert.deepEqual(plain(h.s.members.bob.selection),{colour:"blue"});sanitized(h);
});
for(const fault of ["cycle","function","date","accessor","nonfinite","depth","nodes","size"])test(`selection clone ${fault} failure never uses real-state fallback`,()=>{
  const h=harness("lobby");let calls=0;const game=h.s.game;
  const bad=vm.runInContext(`({cycle:()=>{var x={};x.self=x;return x;},function:()=>function(){},date:()=>new Date(),accessor:()=>Object.defineProperty({},"secret",{enumerable:true,get:function(){throw Error("GETTER_MUST_NOT_RUN");}}),nonfinite:()=>Infinity,depth:()=>{var x={},r=x;for(var i=0;i<40;i++){x.next={};x=x.next;}return r;},nodes:()=>new Array(10001).fill(0),size:()=>new Array(70000).join("x")})`,h.c)[fault]();
  game.unsupported=bad;h.module.select=()=>{calls++;return true;};
  alive(h,h.loop(10,[selection()]));assert.equal(calls,0);assert.equal(h.s.game,game);
  assert.equal(h.s.members.alice.selection,null);assert.equal(h.s.members.alice.diagnostics.module_request_error,1);
});
for(const callback of ["input","step"])test(`authoritative ${callback} remains fatal to entire room`,()=>{
  const h=harness();h.module[callback]=g=>{g.players.alice.score=99;throw Error(secret);};
  assert.equal(h.loop(10,[input()]),null);assert.equal(h.kicks.length,2);
  assert.equal(h.s.game.players.alice.score,99);assert.equal(h.s.members.alice.appliedSeq,-1);
  assert.equal(h.packets.filter(p=>p.op===10).length,0);
  assert.ok(h.packets.some(p=>p.op===11&&JSON.parse(p.data).error==="Module failure"));sanitized(h);
});
for(const fault of ["cycle","special","oversize"])test(`invalid select candidate output ${fault} cannot commit`,()=>{
  const h=harness("lobby"),game=h.s.game,m=h.s.members.alice,before=JSON.stringify(game);
  m.ready=true;let calls=0;
  h.module.select=(candidate,id,p)=>{calls++;candidate.players[id].score=999;
    if(fault==="cycle")candidate.bad=candidate;
    if(fault==="special")candidate.bad=vm.runInContext("new Date()",h.c);
    if(fault==="oversize")candidate.bad="x".repeat(65537);
    return true;};
  alive(h,h.loop(10,[selection()]));assert.equal(calls,1);assert.equal(h.s.game,game);
  assert.equal(JSON.stringify(game),before);assert.equal(m.selection,null);assert.equal(m.ready,true);
  assert.equal(m.diagnostics.request_clone_error,1);
});
test("retained successful callback references cannot mutate committed game or stored selection",()=>{
  const h=harness("lobby");let candidateRef,requestRef,validatorRef;
  h.module.validateSelection=p=>{validatorRef=p;return true;};
  h.module.select=(candidate,id,p)=>{candidateRef=candidate;requestRef=p;candidate.players[id].choice=p;return true;};
  alive(h,h.loop(10,[selection({nested:{colour:"red"}})]));
  const before=JSON.stringify(h.s.game),stored=JSON.stringify(h.s.members.alice.selection);
  candidateRef.players.alice.score=999;candidateRef.players.alice.choice.nested.colour="candidate";
  requestRef.nested.colour="request";validatorRef.nested.colour="validator";
  assert.equal(JSON.stringify(h.s.game),before);assert.equal(JSON.stringify(h.s.members.alice.selection),stored);
  h.packets.length=0;alive(h,h.loop(11));assert.equal(JSON.stringify(h.s.game),before);
});
for(const offender of ["alice","bob"])for(const mode of ["throw","false","illegal"])test(`rematch validation ${mode} isolates ${offender} and targets only offender`,()=>{
  const other=offender==="alice"?"bob":"alice",h=harness("results");
  h.s.members[offender].selection=vm.runInContext('({colour:"bad"})',h.c);
  h.s.members[other].selection=vm.runInContext('({colour:"blue"})',h.c);
  const selected=[];
  h.module.validateSelection=p=>{if(p.colour!=="bad")return true;if(mode==="throw")throw Error(secret);return mode==="false"?false:"true";};
  h.module.select=(g,id,p)=>{selected.push(id);g.players[id].choice=p;return true;};
  alive(h,h.loop(10,[message(4,{round_id:1})]));
  assert.equal(h.s.round_id,2);assert.equal(h.s.phase,"lobby");assert.deepEqual(selected,[other]);
  assert.equal(h.s.members[offender].selection,null);assert.equal(h.s.game.players[offender].choice,undefined);
  assert.deepEqual(plain(h.s.game.players[other].choice),{colour:"blue"});
  const errors=h.packets.filter(p=>p.op===11);assert.equal(errors.length,1);
  assert.deepEqual(plain(errors[0].recipients.map(p=>p.userId)),[offender]);
  assert.equal(JSON.parse(errors[0].data).error,mode==="false"?"Invalid player selection":"Module request failure");sanitized(h);
});
for(const valid of ["nullprototype","densearrays","depth32","bytes65536"])test(`valid candidate ${valid} commits at plain-data boundary`,()=>{
  const h=harness("lobby");let calls=0;
  if(valid==="nullprototype")h.s.game.extra=vm.runInContext('Object.assign(Object.create(null),{yes:true,no:null,n:2.5,text:"中文"})',h.c);
  if(valid==="densearrays")h.s.game.extra=vm.runInContext('[null,true,false,12,"text",{nested:[1,2]}]',h.c);
  if(valid==="depth32")h.s.game.extra=vm.runInContext('(()=>{var x="leaf";for(var i=0;i<31;i++)x={next:x};return x;})()',h.c);
  if(valid==="bytes65536"){h.s.game.pad="";h.s.game.pad="x".repeat(65536-Buffer.byteLength(JSON.stringify(h.s.game)));assert.equal(Buffer.byteLength(JSON.stringify(h.s.game)),65536);}
  const before=JSON.stringify(h.s.game),old=h.s.game;
  h.module.select=()=>{calls++;return false;};alive(h,h.loop(10,[selection()]));
  assert.equal(calls,1);assert.notEqual(h.s.game,old);assert.equal(JSON.stringify(h.s.game),before);
  assert.deepEqual(plain(h.s.members.alice.selection),{colour:"red"});assert.equal(h.s.members.alice.diagnostics.module_request_error,0);
});
for(const fault of ["symbol","sparse","nonenumerable","sharedalias","__proto__","constructor","prototype","getter"])test(`clone rejects ${fault} without invoking getter or select`,()=>{
  const h=harness("lobby"),game=h.s.game;let calls=0;
  h.c.getterSideEffects=0;
  game.bad=vm.runInContext(`(()=>{var x={};
    switch(${JSON.stringify(fault)}) {
      case "symbol":x[Symbol("hidden")]=1;break;
      case "sparse":return new Array(2);
      case "nonenumerable":Object.defineProperty(x,"hidden",{value:1});break;
      case "sharedalias":var shared={value:1};return {a:shared,b:shared};
      case "getter":Object.defineProperty(x,"hidden",{enumerable:true,get:function(){getterSideEffects++;return 1;}});break;
      default:Object.defineProperty(x,${JSON.stringify(fault)},{value:1,enumerable:true});
    }return x;})()`,h.c);
  h.module.select=()=>{calls++;return true;};alive(h,h.loop(10,[selection()]));
  assert.equal(calls,0);assert.equal(h.c.getterSideEffects,0);assert.equal(h.s.game,game);
  assert.equal(h.s.members.alice.selection,null);assert.equal(h.s.members.alice.diagnostics.request_clone_error,1);
});
console.log(`${passes} request isolation regressions passed; ${failures} failed`);
if(!passes&&!failures)throw Error("No tests selected");
if(failures)process.exitCode=1;
