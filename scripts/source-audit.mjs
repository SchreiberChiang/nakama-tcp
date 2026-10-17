import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((p) => p && fs.existsSync(p));
const unique = [...new Set(files)];
const failures = [];
const forbiddenPath =
  /(?:^|\/)(?:node_modules|\.local[^/]*|\.tools|logs|profiles?|artifacts|build|\.godot)(?:\/|$)|\.(?:pem|p12|key|wasm|br|pck|exe|ogg|wav|mp3|glb|gltf|png|jpe?g)$/i;
const bannedValues = [
  /wx[a-f0-9]{16}/,
  /cloud[1]-/,
  /AUTHORIZATION\.json/,
  /E:[\\/]AI/i,
  /\u8d75\u6c5f/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[a-zA-Z0-9]{25,}/,
  /\bgithub_pat_[a-zA-Z0-9_]{30,}/,
  /\bAKID[a-zA-Z0-9]{25,}/,
];
for (const file of unique) {
  if (forbiddenPath.test(file))
    failures.push({
      file,
      reason: "forbidden generated/private/game asset path",
    });
  if (/\.gz$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (bannedValues.some((re) => re.test(text)))
    failures.push({ file, reason: "sensitive or machine-specific value" });
  if (file.endsWith(".md")) {
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), target)))
        failures.push({ file, reason: "missing documentation link", target });
    }
  }
}
assert.deepEqual(
  failures,
  [],
  "Source privacy/path/documentation audit failed",
);
const pin = JSON.parse(fs.readFileSync("client/addons/SDK_PIN.json", "utf8"));
const final = new Map();
for (const patch of pin.modifications) {
  final.set(patch.file, patch.patched_file_sha256);
  for (const extra of patch.additional_files || [])
    final.set(extra.file, extra.patched_file_sha256);
}
for (const [file, hash] of final) {
  assert.equal(
    createHash("sha256")
      .update(
        fs
          .readFileSync(path.join("client", file), "utf8")
          .replace(/\r\n/g, "\n"),
      )
      .digest("hex"),
    hash,
    `SDK pinned hash ${file}`,
  );
}
assert.equal(
  fs
    .readFileSync("server/src/registry.ts", "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s/g, ""),
  "varGAMES:{[id:string]:GameModule}={};",
);
assert.ok(
  !fs
    .readFileSync("server/build/index.js", "utf8")
    .includes("LifecycleFixture"),
  "fixture absent from production build",
);
const nonTestCode = unique.filter(
  (p) =>
    /^(client\/(core|ui)|client\/(Main.tscn|project.godot)|server\/src)/.test(
      p,
    ) && /\.(gd|ts|tscn|tres|godot)$/.test(p),
);
assert.deepEqual(
  nonTestCode.filter((p) =>
    /racing|stones|tabletop|SubViewport|Node3D|preload\([^)]*games\//i.test(
      fs.readFileSync(p, "utf8"),
    ),
  ),
  [],
  "game/3D coupling in shared source",
);
console.log(
  `PASS source audit: ${unique.length} files; SDK pins, doc links, empty registration, privacy and generated-file exclusions.`,
);
