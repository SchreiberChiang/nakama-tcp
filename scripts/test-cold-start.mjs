// Exercise the entry's shared preparation with no font/cache/packages/backend.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FONT_SHA256 } from "./restore-source-assets.mjs";

if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local");
mkdirSync(local, { recursive: true });
const dir = mkdtempSync(path.join(local, "cold-start-"));
const previousCwd = process.cwd();
let cleanupConfirmed = true;
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
  process.chdir(dir);
  const { prepareTests } = await import(pathToFileURL(path.join(dir, "scripts/test-prepare.mjs")).href);
  // No outer Node timeout can kill the owner before its Godot/profile cleanup.
  // Each Godot invocation retains the shared runner's own bounded deadline.
  await prepareTests();
  assert.ok(existsSync(cache), "editor import must generate the global class cache");
  assert.equal(createHash("sha256").update(readFileSync(font)).digest("hex"), FONT_SHA256);
  const importLog = readFileSync(path.join(dir, ".local/import.log"), "utf8");
  assert.match(importLog, /Godot Engine/);
  const result = "COLD_START_CHECKS 1 FAILURES 0: shared test preparation restored font, imported fresh project, and passed isolated profiles without backend";
  writeFileSync(path.join(local, "cold-start.log"), importLog + "\n" + result + "\n");
  console.log(result);
} catch (error) {
  if (error.exitConfirmed === false) cleanupConfirmed = false;
  throw error;
} finally {
  process.chdir(previousCwd);
  const relative = path.relative(local, dir);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(dir).startsWith("cold-start-"));
  if (cleanupConfirmed) rmSync(dir, { recursive: true, force: true });
  else console.error(`Cold project retained because child exit was not confirmed: ${dir}`);
}
