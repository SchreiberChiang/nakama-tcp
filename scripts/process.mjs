import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export async function checked(
  command,
  args,
  { timeout = 90000, log, env = process.env, forbidErrors = true, cwd } = {},
) {
  const child = spawn(command, args, {
    env,
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timedOut = false;
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeout);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(timer));
  if (log) {
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, output);
  }
  if (
    timedOut ||
    code !== 0 ||
    (forbidErrors &&
      /(?:SCRIPT ERROR|^ERROR:|^WARNING:|^FAIL(?:\s|:)|\bfailures=[1-9]\d*|\bFAILURES\s+[1-9]\d*|"failed"\s*:\s*[1-9]\d*|Parse Error|Compile Error)/m.test(
        output,
      ))
  )
    throw Error(
      `Process failed (${timedOut ? "timeout" : code}): ${log || command}\n${output.slice(-5000)}`,
    );
  return output;
}
