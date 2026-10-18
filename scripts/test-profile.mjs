// Test-only ownership. Never derive a deletion target from child IPC or a label.
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync, unlinkSync, lstatSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { checked } from "./process.mjs";

const roots = new Map();
export async function userDataRoot(godot = process.env.GODOT) {
  const project = path.resolve("client/project.godot");
  const key = `${godot}\0${project}`;
  if (!roots.has(key)) roots.set(key, (async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "template-profile-probe-"));
    let safeToClean = true;
    try {
      // Godot resolves the platform-specific user:// path itself. This tiny
      // project has the same application settings but NO Session/autoload.
      const source = readFileSync(project, "utf8");
      const application = source.match(/^\[application\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
      if (!application) throw Error("Missing application settings");
      writeFileSync(path.join(dir, "project.godot"), `config_version=5\n\n${application[0].replace(/^run\/main_scene=.*\r?\n/gm, "")}`);
      writeFileSync(path.join(dir, "probe.gd"), 'extends SceneTree\nfunc _initialize():\n\tprint("TEST_USER_DATA_ROOT=" + JSON.stringify(OS.get_user_data_dir()))\n\tquit()\n');
      const output = await checked(godot, ["--headless", "--log-file", path.join(dir, "probe.log"), "--path", dir, "--script", "res://probe.gd"], { timeout: 15000 });
      const lines = output.split(/\r?\n/).filter(x => x.startsWith("TEST_USER_DATA_ROOT="));
      if (lines.length !== 1) throw Error("Missing unambiguous Godot user data root");
      const root = JSON.parse(lines[0].slice("TEST_USER_DATA_ROOT=".length));
      if (typeof root !== "string" || !path.isAbsolute(root)) throw Error("Invalid Godot user data root");
      return root;
    } catch (error) {
      safeToClean = error?.exitConfirmed !== false;
      throw error;
    } finally {
      const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dir));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(dir).startsWith("template-profile-probe-")) throw Error("Unsafe probe cleanup path");
      if (safeToClean) rmSync(dir, { recursive: true, force: true });
    }
  })());
  return roots.get(key);
}

export function ownProfile(root) {
  if (!path.isAbsolute(root)) throw Error("Profile root must be absolute");
  const profile = `test-owned-${randomUUID()}`;
  const file = path.join(root, `template-${profile}.cfg`);
  mkdirSync(root, { recursive: true });
  // Exclusive reservation establishes ownership before a child can start.
  closeSync(openSync(file, "wx"));
  let cleaned = false;
  return {
    profile, file,
    args(args) {
      if (args.some(x => x.startsWith("--profile"))) throw Error("Caller profile override forbidden");
      return [...args, ...(args.includes("--") ? [] : ["--"]), `--profile=${profile}`];
    },
    cleanup() {
      if (cleaned) return;
      try {
        if (!lstatSync(file).isFile()) throw Error("Owned profile replaced by non-file; refusing cleanup");
        unlinkSync(file);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      cleaned = true;
    },
  };
}

export async function withOwnedProfile(root, action) {
  const owner = ownProfile(root);
  let safeToClean = true;
  try { return await action(owner); }
  catch (error) {
    // A bounded runner can release its handles without proving process exit.
    // Preserve settings while that process may still write them.
    safeToClean = error?.exitConfirmed !== false;
    throw error;
  }
  finally { if (safeToClean) owner.cleanup(); }
}

export async function checkedGodot(args, options) {
  return withOwnedProfile(await userDataRoot(), owner => checked(process.env.GODOT, owner.args(args), options));
}
