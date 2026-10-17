import { checked } from "./process.mjs";
import { mkdirSync } from "node:fs";
if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
mkdirSync(".local", { recursive: true });
for (const args of [["scripts/build.mjs"], ["scripts/build.mjs", "--fixture"]])
  console.log(
    await checked(process.execPath, args, { log: ".local/test-build.log" }),
  );
await checked(
  process.env.GODOT,
  ["--headless", "--editor", "--path", "client", "--import"],
  { timeout: 120000, log: ".local/import.log" },
);
console.log(
  await checked(
    process.env.GODOT,
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
for (const fixture of [false, true]) {
  const env = {
    ...process.env,
    NAKAMA_DATA_DIR: `.local/database-${fixture ? "fixture" : "empty"}-${Date.now()}`,
    TEST_FIXTURE: fixture ? "1" : "0",
  };
  if (fixture) env.NAKAMA_RUNTIME_DIR = ".local/test-runtime";
  else delete env.NAKAMA_RUNTIME_DIR;
  console.log(
    await checked(
      process.execPath,
      ["scripts/run-with-server.mjs", process.execPath, "tests/network.mjs"],
      {
        timeout: 120000,
        env,
        log: `.local/network-${fixture ? "fixture" : "empty"}.log`,
      },
    ),
  );
}
console.log(
  await checked(process.execPath, ["scripts/export.mjs"], {
    timeout: 180000,
    log: ".local/export-check.log",
  }),
);
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
