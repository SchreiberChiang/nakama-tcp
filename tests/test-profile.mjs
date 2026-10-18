import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { checked } from "../scripts/process.mjs";
import { withOwnedProfile, ownProfile, userDataRoot, checkedGodot } from "../scripts/test-profile.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-profile-test-"));
let checks = 0;
let safeToClean = true;
const digest = file => fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
const pass = label => { checks++; console.log("PASS", label); };
async function rejectsAfterConfirmedExit(work, expected) {
  let failure;
  try { await work; }
  catch (error) {
    // Expected failure assertions must never consume an unconfirmed real exit:
    // the outer owner must receive that same error and preserve the directory.
    if (error?.exitConfirmed === false) throw error;
    failure = error;
  }
  await assert.rejects(failure ? Promise.reject(failure) : Promise.resolve(), expected);
}
try {
  const defaults = path.join(dir, "template-default.cfg");
  const unknown = path.join(dir, "template-test-owned-unknown.cfg");
  fs.writeFileSync(unknown, "unknown file must survive");
  const unknownHash = digest(unknown);
  for (const present of [false, true]) {
    if (present) fs.writeFileSync(defaults, "[player]\nname=\"DEFAULT_SENTINEL\"\n");
    const before = digest(defaults);
    for (const mode of ["success", "exception", "timeout", "spawn-failure"]) {
      let file;
      const work = withOwnedProfile(dir, async owner => {
        file = owner.file;
        assert.ok(fs.existsSync(file));
        const code = 'require("fs").writeFileSync(process.argv[1], "owned settings");' +
          (mode === "timeout" ? 'setInterval(()=>{}, 1000);' : mode === "exception" ? 'throw Error("deliberate child exception");' : '');
        return checked(mode === "spawn-failure" ? path.join(dir, "missing-executable") : process.execPath,
          ["-e", code, file], { timeout: mode === "timeout" ? 300 : 5000 });
      });
      if (mode === "success") await work; else await rejectsAfterConfirmedExit(work);
      assert.equal(fs.existsSync(file), false);
      assert.equal(digest(defaults), before);
      assert.equal(digest(unknown), unknownHash);
      pass(`${mode}: exact cleanup, unknown preserved, default ${present ? "hash unchanged" : "absent"}`);
    }
  }
  const owner = ownProfile(dir);
  assert.throws(() => owner.args(["--", "--profile=../../default"]));
  owner.cleanup(); owner.cleanup();
  pass("caller profile/path injection rejected; cleanup idempotent");
  let preserved;
  const unconfirmed = Object.assign(Error("direct process exit unconfirmed"), {exitConfirmed: false});
  // Synthetic error only: no process exists, so explicit cleanup below is safe.
  await assert.rejects(withOwnedProfile(dir, async owner => {
    preserved = owner;
    fs.writeFileSync(owner.file, "still owned by a possibly live process");
    throw unconfirmed;
  }), error => error === unconfirmed);
  assert.equal(fs.readFileSync(preserved.file, "utf8"), "still owned by a possibly live process");
  preserved.cleanup(); // There was no real writer in this synthetic fixture.
  pass("unconfirmed direct exit preserves profile until its owner confirms cleanup");
  const childScript = path.join(dir, "cooperative.mjs");
  const beforeDefault = digest(defaults);
  const networkScript = path.join(dir, "network.mjs");
  const events = path.join(dir, "events.json");
  const launcherUrl = JSON.stringify(new URL("../scripts/run-with-server.mjs", import.meta.url).href);
  fs.writeFileSync(networkScript, `import { withOwnedProfile } from ${JSON.stringify(new URL("../scripts/test-profile.mjs", import.meta.url).href)};
import { terminateOwned } from ${launcherUrl};
import { spawn } from 'node:child_process';
import fs from 'node:fs';
let stop; const stopping = new Promise(r => stop=r);
process.on('message', m => { if(m?.type==='test-stop') stop(); });
const events=[];
await withOwnedProfile(process.argv[2], async owner => {
  const client=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  events.push('client-start'); process.send({type:'ready'}); await stopping;
  await terminateOwned(client,'fake Godot'); events.push('client-exit');
});
events.push('profile-cleaned');
fs.writeFileSync(process.argv[3],JSON.stringify(events)); process.disconnect();`);
  fs.writeFileSync(childScript, `import { stopCooperativeTest, onceShutdown } from ${launcherUrl};
import { spawn } from 'node:child_process'; import fs from 'node:fs';
let child;
const stop=onceShutdown([()=>stopCooperativeTest(child),()=>{
const events=JSON.parse(fs.readFileSync(process.argv[3])); events.push('server-stop'); fs.writeFileSync(process.argv[3],JSON.stringify(events));
}]);
process.on('message',async m=>{if(m?.type==='test-stop'){await stop();process.disconnect();}});
child=spawn(process.execPath,[${JSON.stringify(networkScript)},process.argv[2],process.argv[3]],{stdio:['ignore','ignore','ignore','ipc']});`);
  await rejectsAfterConfirmedExit(checked(process.execPath, [childScript, dir, events], {timeout: 1500, cooperativeStop: true, cleanupGrace: 5000}), /timeout/);
  assert.deepEqual(JSON.parse(fs.readFileSync(events)), ["client-start", "client-exit", "profile-cleaned", "server-stop"]);
  assert.equal(fs.readdirSync(dir).filter(x => /^template-test-owned-/.test(x)).join(), path.basename(unknown));
  assert.equal(digest(defaults), beforeDefault);
  pass("cooperative outer timeout waits for client/profile cleanup before server stop (no backend)");
  const stubborn = path.join(dir, "stubborn.mjs");
  fs.writeFileSync(stubborn, "process.on('message',()=>{}); setInterval(()=>{},1000);");
  await rejectsAfterConfirmedExit(checked(process.execPath, [stubborn], {timeout: 200, cooperativeStop: true, cleanupGrace: 200}), /descendant cleanup unverified/);
  pass("unresponsive cooperative timeout reports cleanup unverified");
  if (process.env.GODOT) {
    const root = await userDataRoot();
    const file = path.join(root, "template-default.cfg");
    const before = digest(file);
    const output = await checkedGodot(["--headless", "--path", "client", "--script", "res://tests/profile_smoke.gd"]);
    assert.match(output, /PROFILE_SMOKE_OK/);
    assert.equal(digest(file), before);
    pass("real Godot Session uses exact owned path; existing default hash/absence unchanged");
  }
  console.log(`PROFILE_RUNNER_CHECKS ${checks} FAILURES 0`);
} catch (error) {
  safeToClean = error?.exitConfirmed !== false;
  throw error;
} finally {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(dir).startsWith("template-profile-test-"));
  if (safeToClean) fs.rmSync(dir, {recursive: true, force: true});
}
