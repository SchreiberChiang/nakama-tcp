// Real entry-point regression: no source font, Godot cache, npm packages or backend.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checked } from "./process.mjs";
import { FONT_SHA256 } from "./restore-source-assets.mjs";

if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local");
mkdirSync(local, { recursive: true });
const dir = mkdtempSync(path.join(local, "cold-start-"));
try {
  cpSync(path.join(root, "client"), path.join(dir, "client"), {
    recursive: true,
    filter: source => ![".godot", "TemplateCJK.otf"].includes(path.basename(source)),
  });
  cpSync(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  mkdirSync(path.join(dir, "tests"));
  cpSync(path.join(root, "tests/test-profile.mjs"), path.join(dir, "tests/test-profile.mjs"));
  cpSync(path.join(root, "assets/source-fonts"), path.join(dir, "assets/source-fonts"), { recursive: true });
  const cache = path.join(dir, "client/.godot/global_script_class_cache.cfg");
  const font = path.join(dir, "client/assets/fonts/TemplateCJK.otf");
  assert.equal(existsSync(path.join(dir, "client/.godot")), false);
  assert.equal(existsSync(font), false);
  const output = await checked(process.execPath, ["scripts/test.mjs", "--prepare-only"], {
    cwd: dir,
    // Covers the serial 15s probe, 120s import, profile runner and 90s smoke.
    timeout: 240000,
    // Keep the preflight owner alive through its bounded Godot/profile cleanup.
    cooperativeStop: true,
    log: path.join(local, "cold-start.log"),
  });
  assert.match(output, /PROFILE_RUNNER_CHECKS \d+ FAILURES 0/);
  assert.match(output, /real Godot Session uses exact owned path/);
  assert.match(output, /TEST_PREPARATION_OK/);
  assert.ok(existsSync(cache), "editor import must generate the global class cache");
  assert.equal(createHash("sha256").update(readFileSync(font)).digest("hex"), FONT_SHA256);
  const importLog = readFileSync(path.join(dir, ".local/import.log"), "utf8");
  assert.match(importLog, /Godot Engine/);
  console.log("COLD_START_CHECKS 1 FAILURES 0: real test entry restored font, imported fresh project, and passed isolated profiles without backend");
} finally {
  const relative = path.relative(local, dir);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(dir).startsWith("cold-start-"));
  rmSync(dir, { recursive: true, force: true });
}
