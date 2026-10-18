import { checked } from "./process.mjs";
import { mkdirSync } from "node:fs";
import { checkedGodot } from "./test-profile.mjs";
import { restoreSourceAssets } from "./restore-source-assets.mjs";
if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
mkdirSync(".local", { recursive: true });
// A fresh checkout has neither the restored font nor Godot's global class cache.
// Prepare both before any runtime test loads Session and its SDK dependencies.
restoreSourceAssets();
await checkedGodot(
  ["--headless", "--editor", "--path", "client", "--import"],
  { timeout: 120000, log: ".local/import.log" },
);
// This test itself owns Godot children; avoid another hard-killing Node parent.
await import("../tests/test-profile.mjs");
// Exercise this same preflight in a disposable cold project without a backend.
if (process.argv.includes("--prepare-only")) {
  console.log("TEST_PREPARATION_OK");
  process.exit(0);
}
await import("./test-cold-start.mjs");
console.log(await checked(process.execPath, ["scripts/test-launcher-config.mjs"], {log: ".local/launcher-config.log"}));
for (const args of [["scripts/build.mjs"], ["scripts/build.mjs", "--fixture"]])
  console.log(
    await checked(process.execPath, args, { log: ".local/test-build.log" }),
  );
console.log(await checked(process.execPath, ["tests/server-protocol.mjs"], {log: ".local/server-protocol.log"}));
const lobbyOutput = await checkedGodot( ["--headless", "--path", "client", "--script", "res://tests/lobby_state.gd"], {log: ".local/lobby-state.log"});
if (/PRIVATE_(?:RAW|RESPONSE|JOIN)_SENTINEL/.test(lobbyOutput)) throw Error("Lobby output leaked private response content.");
console.log(lobbyOutput);
console.log(await checkedGodot( ["--headless", "--path", "client", "--script", "res://tests/snapshot_timeline.gd"], {log: ".local/snapshot-timeline.log"}));
console.log(
  await checkedGodot(
    [
      "--headless",
      "--path",
      "client",
      "--script",
      "res://tests/sdk_socket_lifecycle.gd",
    ],
    { log: ".local/sdk.log" },
  ),
);
for (const scenario of ["empty", "fixture", "diagnostics", "input", "projection"]) {
  const fixture = scenario !== "empty";
  const env = {
    ...process.env,
    NAKAMA_DATA_DIR: `.local/database-${scenario}-${Date.now()}`,
    TEST_FIXTURE: fixture ? "1" : "0",
    NAKAMA_LOG: `.local/server-${scenario}.log`,
    TEST_DIAGNOSTICS: scenario === "diagnostics" ? "1" : "0",
    TEST_FAULT: ["input", "projection"].includes(scenario) ? scenario : "",
  };
  if (scenario === "diagnostics") env.GAME_DIAGNOSTICS = "1";
  else delete env.GAME_DIAGNOSTICS;
  if (fixture) env.NAKAMA_RUNTIME_DIR = ".local/test-runtime";
  else delete env.NAKAMA_RUNTIME_DIR;
  console.log(
    await checked(
      process.execPath,
      ["scripts/run-with-server.mjs", "--test-cooperative-stop", process.execPath, "tests/network.mjs"],
      {
        timeout: 180000,
        cooperativeStop: true,
        cleanupGrace: 100000,
        env,
        log: `.local/network-${scenario}.log`,
      },
    ),
  );
}
// Keep the owning parent alive until each bounded Godot export/audit closes.
// Individual import/export/runtime logs remain in .local.
await import("./export.mjs");
console.log(
  await checked(process.execPath, ["platform/wechat/test-decoded-json.mjs"], {
    log: ".local/wechat-http.log",
  }),
);
console.log(
  await checked(process.execPath, ["scripts/source-audit.mjs"], {
    log: ".local/source-audit.log",
  }),
);
