import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { checkedGodot } from "./test-profile.mjs";
const pack = path.resolve("artifacts/template.pck");
mkdirSync(".local/pack-check/empty-root", { recursive: true });
const report = path.resolve(".local/pack-check/inventory.json");
await checkedGodot(
  [
    "--headless",
    "--main-pack",
    pack,
    "--script",
    path.resolve("scripts/pack_check.gd"),
    "--",
    `--report=${report}`,
  ],
  {
    cwd: path.resolve(".local/pack-check/empty-root"),
    timeout: 15000,
    log: ".local/pack-check/runtime.log",
  },
);
const inventory = JSON.parse(readFileSync(report));
assert.ok(inventory.files.length > 20, "non-empty actual pack");
assert.equal(inventory.page, "login");
assert.equal(inventory.empty_registry, true);
assert.equal(inventory.has_fixture, false);
assert.deepEqual(inventory.bad_nodes, []);
const forbidden =
  /(?:games\/|tests\/|fixtures?\/|racing|stones|tabletop|harbor|vehicle|\.ogg(?:$|\.)|\.wav(?:$|\.)|\.mp3(?:$|\.)|\.glb(?:$|\.)|\.gltf(?:$|\.)|\.png(?:$|\.)|\.jpe?g(?:$|\.))/i;
assert.deepEqual(
  inventory.files.filter((x) => forbidden.test(x)),
  [],
  "forbidden dependency in actual export",
);
for (const p of ["res://Main.tscn.remap", "res://project.binary"])
  assert.ok(inventory.files.includes(p), `export includes ${p}`);
const data = readFileSync(pack);
const result = {
  ...inventory,
  bytes: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
  checked:
    "actual exported PCK inventory and packed login scene, not source-only scan",
};
writeFileSync(".local/pack-check/result.json", JSON.stringify(result, null, 2));
console.log(
  `PASS actual PCK: ${inventory.files.length} files, ${data.length} bytes, no games/fixture/3D/audio/image resources. Packed login runs.`,
);
