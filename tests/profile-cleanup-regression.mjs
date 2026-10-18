import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalSpawn = childProcess.spawn;
const OriginalError = globalThis.Error;
let child, realKill, file, originalFailure, observedFailure;
// Observe the actual runner error's identity without replacing checked() or
// shortening the outer test: import executes test-profile.mjs's real finally.
globalThis.Error = new Proxy(OriginalError, {
  apply(target, receiver, args) {
    const error = Reflect.apply(target, receiver, args);
    if (String(args[0]).includes("direct process exit unconfirmed")) originalFailure = error;
    return error;
  },
});
childProcess.spawn = (...args) => {
  const spawned = originalSpawn(...args);
  const fixtureArgs = args[1];
  if (!child && args[0] === process.execPath && fixtureArgs?.[0] === "-e" &&
      fixtureArgs[1].includes('writeFileSync(process.argv[1], "owned settings")') &&
      fixtureArgs[1].includes("setInterval")) {
    child = spawned;
    file = fixtureArgs[2];
    realKill = child.kill.bind(child);
    child.kill = () => false;
  }
  return spawned;
};
syncBuiltinESMExports();
try {
  try { await import("./test-profile.mjs?profile-cleanup-regression"); }
  catch (error) { observedFailure = error; }
  assert.ok(child, "must inject into the first real timeout fixture");
  process.kill(child.pid, 0);
  const dir = path.dirname(file);
  console.log("FAULT_OBSERVATION", JSON.stringify({
    originalErrorPropagated: observedFailure === originalFailure,
    exitConfirmed: observedFailure?.exitConfirmed ?? null,
    childAlive: true,
    directoryPreserved: fs.existsSync(dir),
    profilePreserved: fs.existsSync(file),
  }));
  assert.ok(originalFailure, "checked must produce its unconfirmed-exit error");
  assert.equal(observedFailure, originalFailure, "outer script must propagate the original error");
  assert.equal(observedFailure.exitConfirmed, false);
  assert.ok(fs.existsSync(dir), "outer finally must preserve the live writer's directory");
  assert.equal(fs.readFileSync(file, "utf8"), "owned settings");
} finally {
  childProcess.spawn = originalSpawn;
  globalThis.Error = OriginalError;
  syncBuiltinESMExports();
  if (child) {
    // Restore this explicitly owned child's real kill and confirm exit before
    // removing its fixture. No timeout wrapper may kill this test mid-cleanup.
    child.kill = realKill;
    let timer;
    try {
      const exited = new Promise((resolve, reject) => {
        child.once("exit", resolve);
        timer = setTimeout(() => reject(new OriginalError("Owned fixture exit unconfirmed; directory preserved")), 5000);
      });
      child.ref();
      realKill("SIGKILL");
      await exited;
    } finally { clearTimeout(timer); child.unref(); }
    const dir = path.resolve(path.dirname(file));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("template-profile-test-"));
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
console.log("PROFILE_CLEANUP_REGRESSION_CHECKS 1 FAILURES 0 (owned child exit confirmed before cleanup)");
