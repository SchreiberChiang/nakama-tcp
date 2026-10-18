import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { checked } from "../scripts/process.mjs";
import { withOwnedProfile } from "../scripts/test-profile.mjs";

const self = fileURLToPath(import.meta.url);
const [mode, dir] = process.argv.slice(2);
if (mode === "descendant") {
  // A detached, explicitly owned fixture retains the inherited output handles
  // on Windows too. The outer test owns its PID and always stops it.
  fs.writeFileSync(path.join(dir, "descendant.pid"), String(process.pid));
  setTimeout(() => {
    process.stdout.write("DESCENDANT_TAIL\n");
  }, 10000);
} else if (mode === "launcher") {
  const descendant = spawn(process.execPath, [self, "descendant", dir], {
    detached: true, windowsHide: true, stdio: ["ignore", 1, 2],
  });
  descendant.unref();
  // Ensure the PID reservation exists before this launcher exits.
  const ready = setInterval(() => {
    if (!fs.existsSync(path.join(dir, "descendant.pid"))) return;
    clearInterval(ready);
    process.stdout.write("LAUNCHER_TAIL\n");
  }, 5);
} else if (mode === "inherited") {
  const started = performance.now();
  await assert.rejects(checked(process.execPath, [self, "launcher", dir], {
    timeout: 300, cleanupGrace: 300, drainGrace: 300, cooperativeStop: true,
    log: path.join(dir, "inherited.log"),
  }), error => {
    assert.equal(error.exitConfirmed, true);
    assert.match(error.message, /output drain incomplete, descendant cleanup unverified/);
    return true;
  });
  assert.match(fs.readFileSync(path.join(dir, "inherited.log"), "utf8"), /LAUNCHER_TAIL\n/);
  console.log("INHERITED_ELAPSED_MS", Math.round(performance.now() - started));
  // Natural process exit proves checked released all of its loop handles.
} else if (mode === "unconfirmed") {
  const originalSpawn = childProcess.spawn;
  let ownedChild, realKill, owner;
  // Fault injection models an OS refusing termination. Only this isolated
  // process's next explicitly owned child is affected; no external PID lookup.
  childProcess.spawn = (...args) => {
    ownedChild = originalSpawn(...args);
    realKill = ownedChild.kill.bind(ownedChild);
    ownedChild.kill = () => false;
    return ownedChild;
  };
  syncBuiltinESMExports();
  try {
    const started = performance.now();
    await assert.rejects(withOwnedProfile(dir, async profile => {
      owner = profile;
      return checked(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeout: 100, terminationGrace: 100,
      });
    }), error => {
      assert.equal(error.exitConfirmed, false);
      assert.match(error.message, /direct process exit unconfirmed/);
      return true;
    });
    assert.ok(performance.now() - started < 1500);
    process.kill(ownedChild.pid, 0);
    assert.ok(fs.existsSync(owner.file), "profile must survive while direct process is alive");
    console.log("UNCONFIRMED_PROFILE_PRESERVED");
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    if (ownedChild) {
      const exited = once(ownedChild, "exit");
      ownedChild.ref();
      realKill("SIGKILL");
      await exited;
    }
    owner?.cleanup();
  }
} else if (mode === "cooperative") {
  process.on("message", message => {
    if (message?.type !== "test-stop") return;
    setTimeout(() => {
      process.stdout.write("COOPERATIVE_TAIL\n");
      process.stderr.write("CLEANUP_TAIL\n");
      process.disconnect();
    }, 30);
  });
} else if (mode === "stubborn") {
  process.on("SIGTERM", () => {});
  process.on("message", () => {});
  console.log("STUBBORN_READY");
  setInterval(() => {}, 1000);
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-process-timeout-"));
  let checks = 0;
  const pass = label => { checks++; console.log("PASS", label); };
  try {
    const tail = "尾行-" + "x".repeat(200000) + "-END\n";
    const log = path.join(root, "success.log");
    const output = await checked(process.execPath, ["-e", `process.stdout.write('尾行-' + 'x'.repeat(200000) + '-END\\n'); process.stderr.write('STDERR_TAIL\\n');`], {log});
    assert.ok(output.includes(tail));
    assert.match(output, /STDERR_TAIL\n/);
    assert.equal(fs.readFileSync(log, "utf8"), output);
    pass("success drains large stdout/stderr including complete UTF-8 tail and log");
    for (const [source, pattern] of [
      ["process.exit(7)", /Process failed \(7\)/],
      ["console.log('ERROR: fixture')", /ERROR: fixture/],
    ]) {
      await assert.rejects(checked(process.execPath, ["-e", source]), error => {
        assert.equal(error.exitConfirmed, true);
        assert.match(error.message, pattern);
        return true;
      });
    }
    pass("nonzero exit and error output reject after confirmed exit");
    await assert.rejects(checked(path.join(root, "missing-executable"), []), error => {
      assert.equal(error.exitConfirmed, true);
      assert.match(error.message, /ENOENT/);
      return true;
    });
    pass("spawn failure has no live direct process");
    const cooperativeLog = path.join(root, "cooperative.log");
    await assert.rejects(checked(process.execPath, [self, "cooperative"], {
      timeout: 300, cleanupGrace: 1000, cooperativeStop: true, log: cooperativeLog,
    }), error => {
      assert.equal(error.exitConfirmed, true);
      assert.match(error.message, /timeout/);
      assert.doesNotMatch(error.message, /cleanup incomplete|drain incomplete/);
      return true;
    });
    assert.match(fs.readFileSync(cooperativeLog, "utf8"), /COOPERATIVE_TAIL\n/);
    assert.match(fs.readFileSync(cooperativeLog, "utf8"), /CLEANUP_TAIL\n/);
    pass("cooperative timeout waits for cleanup and preserves both final lines");
    const started = performance.now();
    await assert.rejects(checked(process.execPath, [self, "stubborn"], {
      timeout: 300, cleanupGrace: 300, terminationGrace: 100, cooperativeStop: true,
    }), error => {
      assert.equal(error.exitConfirmed, true);
      assert.match(error.message, /timeout.*descendant cleanup unverified/);
      return true;
    });
    assert.ok(performance.now() - started < 1800);
    pass("unresponsive cooperative child stops within grace and escalation bounds");
    const forcedStart = performance.now();
    await assert.rejects(checked(process.execPath, [self, "stubborn"], {
      timeout: 300, terminationGrace: 100,
    }), error => {
      assert.equal(error.exitConfirmed, true);
      assert.match(error.message, /timeout/);
      return true;
    });
    assert.ok(performance.now() - forcedStart < 1500);
    pass("noncooperative timeout confirms direct exit (SIGKILL escalation if SIGTERM is ignored)");
    const unconfirmed = spawnSync(process.execPath, [self, "unconfirmed", root], {
      encoding: "utf8", windowsHide: true, timeout: 2500,
    });
    assert.ifError(unconfirmed.error);
    assert.equal(unconfirmed.status, 0, `${unconfirmed.stdout}\n${unconfirmed.stderr}`);
    assert.match(unconfirmed.stdout, /UNCONFIRMED_PROFILE_PRESERVED/);
    pass("failed termination returns boundedly with exitConfirmed=false and preserves a live writer's profile");
    const probe = spawnSync(process.execPath, [self, "inherited", root], {
      encoding: "utf8", windowsHide: true, timeout: 2500,
    });
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
    assert.match(probe.stdout, /INHERITED_ELAPSED_MS/);
    console.log(probe.stdout.trim());
    const pid = Number(fs.readFileSync(path.join(root, "descendant.pid"), "utf8"));
    process.kill(pid, 0); // Bounded return is explicitly NOT descendant cleanup.
    pass("inherited pipes return boundedly, release caller handles, and report unverified descendant");
    console.log(`PROCESS_TIMEOUT_CHECKS ${checks} FAILURES 0`);
  } finally {
    const pidFile = path.join(root, "descendant.pid");
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      try { process.kill(pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
      let alive = true;
      for (let attempt = 0; attempt < 40 && alive; attempt++) {
        try { process.kill(pid, 0); }
        catch (error) {
          if (error.code !== "ESRCH") throw error;
          alive = false;
        }
        if (alive) await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(alive, false, "owned descendant must be confirmed stopped before fixture removal");
    }
    assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("template-process-timeout-"));
    fs.rmSync(root, {recursive: true, force: true});
  }
}
