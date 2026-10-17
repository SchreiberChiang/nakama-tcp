// Restore the exact release font from its lossless, repository-local source archive.
// No downloads, font subsetting, or overwriting changed local assets.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const FONT_SHA256 =
  "d11b07d484692eeebb29ebfdef39253c72db8a7c7ab1641a69167f9266515f32";
export const FONT_BYTES = 13205332;
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const digest = (data) => createHash("sha256").update(data).digest("hex");

export function restoreSourceAssets(root = projectRoot) {
  const target = path.join(root, "client/assets/fonts/TemplateCJK.otf");
  const archive = path.join(root, "assets/source-fonts/TemplateCJK.otf.gz");
  const checkExisting = () => {
    const stat = lstatSync(target);
    if (
      !stat.isFile() ||
      stat.size !== FONT_BYTES ||
      digest(readFileSync(target)) !== FONT_SHA256
    ) {
      throw new Error(
        "Existing TemplateCJK.otf differs from the release asset; refusing to overwrite it. Preserve your local font before restoring.",
      );
    }
  };
  if (existsSync(target)) {
    checkExisting();
    return "already-valid";
  }
  const restored = gunzipSync(readFileSync(archive), {
    maxOutputLength: FONT_BYTES + 1,
  });
  if (restored.length !== FONT_BYTES || digest(restored) !== FONT_SHA256) {
    throw new Error(
      "Compressed CJK font failed its original release size/SHA256 check; no font was written.",
    );
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, restored, { flag: "wx", mode: 0o644 });
    try {
      // An atomic, no-replace install: another process or local file cannot be overwritten.
      linkSync(temporary, target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      checkExisting();
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return "restored";
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const status = restoreSourceAssets();
    console.log(`Source font ${status}; original release SHA256 verified.`);
  } catch (error) {
    console.error(`Source asset restoration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
