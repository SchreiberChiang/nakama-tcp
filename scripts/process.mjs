import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export async function checked(
  command,
  args,
  { timeout = 90000, log, env = process.env, forbidErrors = true, cwd, cooperativeStop = false, cleanupGrace = 100000, terminationGrace = 300, drainGrace = 300 } = {},
) {
  // In addition to runtime, allow cooperative cleanup, two termination windows,
  // and a final pipe drain. These are event-loop deadlines, not OS realtime
  // guarantees. A failed termination must report unconfirmed exit to owners.
  for (const [name, value] of Object.entries({ timeout, cleanupGrace, terminationGrace, drainGrace })) {
    if (!Number.isFinite(value) || value < 0 || value > 2147483647) throw Object.assign(Error(`Invalid process ${name}`), {exitConfirmed: true});
  }
  let child;
  try { child = spawn(command, args, {
    env,
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", ...(cooperativeStop ? ["ipc"] : [])],
  }); }
  catch (error) { throw Object.assign(error, {exitConfirmed: true}); }
  let output = "";
  let timedOut = false;
  let incompleteCleanup = false;
  let incompleteDrain = false;
  let exitConfirmed = false;
  let processError;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  const code = await new Promise(resolve => {
    const timers = new Set();
    let settled = false;
    let exitCode = null;
    const later = (action, delay) => {
      const timer = setTimeout(action, delay);
      timers.add(timer);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      // Descendants can retain the pipes after the direct child exits. Closing
      // our handles bounds drain AND releases the caller's event loop. This is
      // not evidence that descendants exited or completed their cleanup.
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.connected) child.disconnect();
      child.unref();
      resolve(exitCode);
    };
    const kill = signal => {
      try { child.kill(signal); }
      catch (error) { processError ||= error; }
    };
    const terminate = () => {
      if (exitConfirmed || settled) return;
      incompleteCleanup = cooperativeStop;
      kill("SIGTERM");
      later(() => {
        if (exitConfirmed || settled) return;
        kill("SIGKILL");
        later(() => {
          if (exitConfirmed || settled) return;
          incompleteCleanup = true;
          incompleteDrain = true;
          finish();
        }, terminationGrace);
      }, terminationGrace);
    };
    child.on("error", error => {
      processError = error;
      if (!child.pid) {
        exitConfirmed = true; // Failed spawn: no direct process can write.
        finish();
      }
    });
    child.once("exit", code => {
      exitConfirmed = true;
      exitCode = code;
      if (settled) return;
      later(() => {
        incompleteDrain = true;
        finish();
      }, drainGrace);
    });
    child.once("close", code => {
      exitCode = code;
      finish();
    });
    later(() => {
      timedOut = true;
      if (exitConfirmed) return; // The separate drain deadline is already set.
      if (cooperativeStop && child.connected) {
        child.send({ type: "test-stop" }, () => {});
        later(terminate, cleanupGrace);
      } else terminate();
    }, timeout);
  });
  if (log) {
    try {
      mkdirSync(path.dirname(log), { recursive: true });
      writeFileSync(log, output);
    } catch (error) { throw Object.assign(error, { exitConfirmed }); }
  }
  if (
    timedOut ||
    incompleteDrain ||
    !exitConfirmed ||
    processError ||
    code !== 0 ||
    (forbidErrors &&
      /(?:SCRIPT ERROR|^ERROR:|^WARNING:|^FAIL(?:\s|:)|\bfailures=[1-9]\d*|\bFAILURES\s+[1-9]\d*|"failed"\s*:\s*[1-9]\d*|Parse Error|Compile Error)/m.test(
        output,
      ))
  )
    throw Object.assign(Error(
      `Process failed (${timedOut ? "timeout" : code})${incompleteCleanup ? "; cooperative cleanup incomplete, descendant cleanup unverified" : ""}${incompleteDrain ? "; output drain incomplete, descendant cleanup unverified" : ""}${!exitConfirmed ? "; direct process exit unconfirmed" : ""}: ${log || command}\n${processError?.message || ""}\n${output.slice(-5000)}`,
    ), { exitConfirmed });
  return output;
}
