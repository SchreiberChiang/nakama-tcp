// Run only against the server this wrapper owns. A random HTTP200 is not readiness.
import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortsFree, waitForOwnedHealth } from "./dev-ports.mjs";
// Keep the same promise (including its rejection) for every shutdown caller.
export function onceShutdown(actions) {
  let pending;
  return () =>
    (pending ||= (async () => {
      const failures = [];
      for (const action of actions) {
        try {
          await action();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          failures.map((error) => error.message || String(error)).join("; "),
        );
    })());
}

export function waitForExit(child, label, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child?.exitCode);
  return new Promise((resolve, reject) => {
    const done = (code) => {
      clearTimeout(timer);
      child.removeListener("exit", done);
      resolve(code);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", done);
      reject(Error(`${label} shutdown timed out (owned PID ${child.pid})`));
    }, timeoutMs);
    child.once("exit", done);
  });
}

export async function terminateOwned(child, label, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, label, timeoutMs);
  } catch {
    // Only the ChildProcess we spawned, never a process discovered by its port.
    child.kill("SIGKILL");
    await waitForExit(child, label, timeoutMs);
  }
}

// Only opt-in automated tests implement this protocol. A hard kill is a
// reported cleanup failure, never evidence that descendants were cleaned.
export async function stopCooperativeTest(child, timeoutMs = 40000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.connected) throw Error("Test IPC unavailable; descendant cleanup unverified");
  child.send({ type: "test-stop" }, () => {});
  try { await waitForExit(child, "Cooperative test cleanup", timeoutMs); }
  catch (error) {
    await terminateOwned(child, "Unresponsive test");
    throw Error(`${error.message}; descendant cleanup unverified`);
  }
}

export async function stopLauncher(
  server,
  { timeoutMs = 45000, log = "logs/integration-server.log" } = {},
) {
  if (!server) return;
  if (server.exitCode === null && server.signalCode === null) {
    // A Windows kill would bypass the launcher's database cleanup.
    if (server.connected) server.send({ type: "nakama-stop" }, () => {});
  }
  const code = await waitForExit(
    server,
    `Local launcher; inspect ${log}`,
    timeoutMs,
  );
  if (code !== 0)
    throw Error(
      `Local launcher cleanup failed (owned PID ${server.pid}, exit ${code}, signal ${server.signalCode}); inspect ${log}`,
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(root);
  const commandArgs = process.argv.slice(2);
  const cooperativeTest = commandArgs[0] === "--test-cooperative-stop" || process.env.TEST_COOPERATIVE_STOP === "1";
  if (commandArgs[0] === "--test-cooperative-stop") commandArgs.shift();
  let server;
  let child;
  let stopping = false;
  let ownedStopped = false;
  const stop = onceShutdown([
    () => {
      stopping = true;
      return cooperativeTest ? stopCooperativeTest(child) : terminateOwned(child, "Test process");
    },
    () =>
      stopLauncher(server, {
        log: process.env.NAKAMA_LOG || "logs/integration-server.log",
      }),
  ]);
  async function finish(code) {
    try {
      await stop();
    } catch (error) {
      console.error("CLEANUP FAILED:", error.message);
      code = 1;
    }
    process.exit(code);
  }
  process.on("SIGINT", async () => {
    await finish(130);
  });
  process.on("SIGTERM", async () => {
    await finish(143);
  });
  if (cooperativeTest) process.on("message", message => {
    if (message?.type === "test-stop") void finish(124);
  });
  try {
    await assertPortsFree();
    mkdirSync("logs", { recursive: true });
    const out = openSync(
      process.env.NAKAMA_LOG || "logs/integration-server.log",
      "w",
    );
    if (stopping) throw Error("Stopped before server launch");
    server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
      stdio: ["ignore", out, out, "ipc"],
      env: { ...process.env, NAKAMA_TELEMETRY: "0" },
    });
    server.on("message", (message) => {
      if (message?.type === "nakama-stopped") ownedStopped = true;
    });
    // The child sends this only after its own Nakama process logs Startup done.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            Error("Owned server readiness timeout; see integration-server.log"),
          ),
        30000,
      );
      server.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timeout);
        reject(
          Error(
            `Owned server exited before readiness (${code}); see integration-server.log`,
          ),
        );
      });
      server.on("message", (message) => {
        if (
          message?.type === "nakama-ready" &&
          Number.isInteger(message.pid) &&
          server.exitCode === null
        ) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    if (stopping) throw Error("Stopped during server readiness");
    if (server.exitCode !== null) throw Error("Owned server already exited");
    await waitForOwnedHealth({
      isAlive: () =>
        server.exitCode === null && server.signalCode === null && !ownedStopped,
    });
    const args = commandArgs,
      command = args.shift() || process.execPath;
    if (stopping) throw Error("Stopped before test launch");
    child = spawn(command, args.length ? args : ["tests/e2e.mjs"], {
      stdio: cooperativeTest ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
      env: process.env,
    });
    server.once("exit", () => {
      if (!stopping && child?.exitCode === null) void finish(1);
    });
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    await finish(code ?? 1);
  } catch (error) {
    console.error(error.message || error);
    await finish(1);
  }
}
