import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export async function checked(
  command,
  args,
  { timeout = 90000, log, env = process.env, forbidErrors = true, cwd, cooperativeStop = false, cleanupGrace = 100000 } = {},
) {
  const child = spawn(command, args, {
    env,
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", ...(cooperativeStop ? ["ipc"] : [])],
  });
  let output = "";
  let timedOut = false;
  let cleanupTimer;
  let incompleteCleanup = false;
  let processError;
  child.on("error", error => { processError = error; });
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  const timer = setTimeout(() => {
    timedOut = true;
    if (cooperativeStop && child.connected) {
      child.send({ type: "test-stop" }, () => {});
      cleanupTimer = setTimeout(() => {
        incompleteCleanup = true;
        child.kill();
      }, cleanupGrace);
    } else {
      incompleteCleanup = cooperativeStop;
      child.kill();
    }
  }, timeout);
  const code = await new Promise(resolve => {
    // close follows exit AND stdout/stderr drain. Profile cleanup may only
    // happen once the process cannot write its settings any more.
    child.once("close", resolve);
  }).finally(() => { clearTimeout(timer); clearTimeout(cleanupTimer); });
  if (log) {
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, output);
  }
  if (
    timedOut ||
    processError ||
    code !== 0 ||
    (forbidErrors &&
      /(?:SCRIPT ERROR|^ERROR:|^WARNING:|^FAIL(?:\s|:)|\bfailures=[1-9]\d*|\bFAILURES\s+[1-9]\d*|"failed"\s*:\s*[1-9]\d*|Parse Error|Compile Error)/m.test(
        output,
      ))
  )
    throw Error(
      `Process failed (${timedOut ? "timeout" : code})${incompleteCleanup ? "; cooperative cleanup incomplete, descendant cleanup unverified" : ""}: ${log || command}\n${processError?.message || ""}\n${output.slice(-5000)}`,
    );
  return output;
}
