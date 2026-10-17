// Official pinned Nakama binaries only. No server is started by bootstrap.
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const platforms = {
  linux: {
    file: "nakama-3.41.0-linux-amd64.tar.gz",
    sha: "71aea14384b097e043917d0b1e8c3799594064acbab01853e71ea10d80624ce2",
  },
  win32: {
    file: "nakama-3.41.0-windows-amd64.tar.gz",
    sha: "9ff754c2750d9e8c11916f59fe6b2b07b6a6c514f8f4a9c96fc27f5df0049890",
  },
};
if (process.arch !== "x64" || !platforms[process.platform])
  throw Error(
    "Bootstrap supports Linux x64 and Windows x64 only. Set NAKAMA_BIN for another official build.",
  );
const p = platforms[process.platform];
mkdirSync(".tools", { recursive: true });
const archive = path.join(".tools", p.file);
if (!existsSync(archive)) {
  console.log("Downloading official Nakama3.41.0", p.file);
  const r = await fetch(
    "https://github.com/heroiclabs/nakama/releases/download/v3.41.0/" + p.file,
  );
  if (!r.ok) throw Error("Download HTTP " + r.status);
  writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
}
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
if (digest !== p.sha)
  throw Error("Official release SHA256 mismatch; refusing extraction.");
const r = spawnSync("tar", ["-xzf", archive, "-C", ".tools"], {
  stdio: "inherit",
});
if (r.status !== 0)
  throw Error(
    "tar extraction failed; install tar (Windows10+ includes tar.exe).",
  );
if (process.platform === "linux") chmodSync(".tools/nakama", 0o755);
console.log(
  "Verified Nakama3.41.0 binary installed. Next: npm run build && npm start",
);
