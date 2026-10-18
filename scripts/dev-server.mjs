// LOCAL DEVELOPMENT ONLY. Binds PostgreSQL, Nakama API, and console to loopback.
import EmbeddedPostgres from "embedded-postgres";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { assertPortsFree } from "./dev-ports.mjs";
import {
  onceShutdown,
  terminateOwned,
  waitForExit,
} from "./run-with-server.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function windowsPgStop(
  pg,
  databaseDir,
  {
    loadCtl = async () =>
      (await import("@embedded-postgres/windows-x64")).pg_ctl,
    run = spawnSync,
    readPid = () =>
      Number(
        readFileSync(path.join(databaseDir, "postmaster.pid"), "utf8").split(
          /\r?\n/,
        )[0],
      ),
    hasLock = () => existsSync(path.join(databaseDir, "postmaster.pid")),
    exitTimeoutMs = 2000,
  } = {},
) {
  return onceShutdown([
    async () => {
      const child = pg.process;
      if (!child) return;
      const evidence = `owned PostgreSQL PID ${child.pid}, data ${databaseDir}`;
      const ctl = await loadCtl();
      const alive = () => child.exitCode === null && child.signalCode === null;
      for (const mode of ["fast", "immediate"]) {
        if (!alive()) break;
        // pg_ctl addresses a directory: verify its lock still names our child.
        let owner;
        try {
          owner = readPid();
        } catch (error) {
          throw Error(`Cannot verify ${evidence}: ${error.message}`);
        }
        if (owner !== child.pid)
          throw Error(
            `Refusing PostgreSQL shutdown: lock PID ${owner} does not match ${evidence}`,
          );
        const result = run(
          ctl,
          [
            "stop",
            "-D",
            databaseDir,
            "-m",
            mode,
            "-w",
            "-t",
            mode === "fast" ? "10" : "5",
          ],
          {
            stdio: "inherit",
            windowsHide: true,
            timeout: mode === "fast" ? 15000 : 8000,
          },
        );
        try {
          await waitForExit(child, evidence, exitTimeoutMs);
        } catch (error) {
          if (mode === "immediate")
            throw Error(
              `${error.message}; pg_ctl ${result.error?.message || `exit ${result.status}`}`,
            );
          continue;
        }
        break;
      }
      if (alive() || hasLock())
        throw Error(
          `PostgreSQL cleanup incomplete (${evidence}); lock retained, inspect manually`,
        );
    },
  ]);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(root);
  // Official Nakama v3.41.0 main.go lines224–236: disables startup/end Segment telemetry.
  process.env.NAKAMA_TELEMETRY = "0";
  const data = process.env.NAKAMA_DATA_DIR || path.join(root, ".local");
  const snapshotRate = process.env.GAME_SNAPSHOT_RATE;
  const diagnostics = process.env.GAME_DIAGNOSTICS;

  // Intentionally public LOCAL dev values, never production credentials.
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(data, "postgres"),
    user: "nakama_dev",
    password: "local-only-dev",
    port: 54329,
    persistent: true,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1", "-k", ""],
    onLog: (m) => console.log("[postgres]", m),
    onError: (m) => console.error("[postgres]", m),
  });
  // The package's Windows stop uses taskkill, leaving postmaster.pid behind.
  // Stop only this instance's process with pg_ctl so persistent dev data can reopen.
  if (process.platform === "win32") {
    pg.stop = windowsPgStop(pg, path.join(data, "postgres"));
  }
  let server;
  let stopping = false;
  const stop = onceShutdown([
    () => {
      stopping = true;
      return terminateOwned(server, "Nakama");
    },
    () => pg.stop(),
  ]);
  async function finish(code = 0) {
    try {
      await stop();
    } catch (error) {
      console.error("CLEANUP FAILED:", error.message);
      code = 1;
    }
    process.exit(code);
  }
  process.on("SIGINT", () => void finish());
  process.on("SIGTERM", () => void finish());
  process.on("disconnect", () => void finish());
  process.on("message", (message) => {
    if (message?.type === "nakama-stop") void finish();
  });
  try {
    if (
      snapshotRate !== undefined &&
      !["10", "20", "30"].includes(snapshotRate)
    )
      throw Error("GAME_SNAPSHOT_RATE must be exactly 10, 20, or 30");
    if (diagnostics !== undefined && !["0", "1"].includes(diagnostics))
      throw Error("GAME_DIAGNOSTICS must be exactly 0 or 1");
    await assertPortsFree();
    if (existsSync(path.join(data, "postgres", "postmaster.pid")))
      throw Error(
        "Refusing startup: PostgreSQL lock file already exists in this data directory. Inspect the existing owner; this launcher will not remove its lock or stop it.",
      );
    mkdirSync(data, { recursive: true });
    if (!existsSync(path.join(data, "postgres", "PG_VERSION")))
      await pg.initialise();
    await pg.start();
    const c = pg.getPgClient("postgres", "127.0.0.1");
    await c.connect();
    const has = await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [
      "nakama",
    ]);
    if (!has.rowCount) await c.query("CREATE DATABASE nakama");
    await c.end();
    const binary =
      process.env.NAKAMA_BIN ||
      path.join(
        root,
        ".tools",
        process.platform === "win32" ? "nakama.exe" : "nakama",
      );
    if (!existsSync(binary))
      throw Error(
        "Nakama binary missing: run node scripts/bootstrap.mjs first",
      );
    const db = "nakama_dev:local-only-dev@127.0.0.1:54329/nakama";
    const migrated = spawnSync(
      binary,
      ["migrate", "up", "--database.address", db],
      { stdio: "inherit" },
    );
    if (migrated.status !== 0) throw Error("Nakama migration failed");
    const config = path.join(root, "server", "dev.yml");
    server = spawn(
      binary,
      [
        "--config",
        config,
        "--socket.address",
        "127.0.0.1",
        "--console.address",
        "127.0.0.1",
        "--database.address",
        db,
        "--runtime.path",
        path.resolve(
          process.env.NAKAMA_RUNTIME_DIR || path.join(root, "server", "build"),
        ),
        ...(snapshotRate === undefined
          ? []
          : ["--runtime.env", "GAME_SNAPSHOT_RATE=" + snapshotRate]),
        ...(diagnostics === undefined ? [] : ["--runtime.env", "GAME_DIAGNOSTICS=" + diagnostics]),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let readySent = false;
    const forward = (stream, output) => {
      let pending = "";
      stream.on("data", (chunk) => {
        output.write(chunk);
        pending += chunk.toString();
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            !readySent &&
            message.msg === "Startup done" &&
            /(?:^|\/)main\.go:\d+$/.test(String(message.caller)) &&
            server.exitCode === null
          ) {
            readySent = true;
            console.log(
              "Owned local Nakama process started at http://127.0.0.1:7350; HTTP gateway may warm up briefly",
            );
            if (process.send && process.connected)
              process.send({ type: "nakama-ready", pid: server.pid }, () => {});
          }
        }
      });
    };
    forward(server.stdout, process.stdout);
    forward(server.stderr, process.stderr);
    server.on("exit", async (code) => {
      if (process.send && process.connected)
        process.send({ type: "nakama-stopped", pid: server.pid }, () => {});
      console.log("Nakama exited", code);
      if (!stopping) {
        await finish(code || 1);
      }
    });
  } catch (err) {
    console.error(err);
    await finish(1);
  }
}
