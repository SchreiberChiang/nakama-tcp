// Negative control: mutate ONLY a disposable .local client copy.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkedGodot } from "../scripts/test-profile.mjs";
const source = path.resolve("client");
const original = fs.readFileSync(path.join(source, "core/snapshot_timeline.gd"), "utf8");
const hash = text => createHash("sha256").update(text).digest("hex");
fs.mkdirSync(".local", {recursive: true});
const evidence = fs.mkdtempSync(path.resolve(".local/timeline-freeze-"));
const copy = path.join(evidence, "client");
fs.cpSync(source, copy, {recursive: true, filter: file => path.basename(file) !== ".godot"});
const target = path.join(copy, "core/snapshot_timeline.gd");
const needle = 'func push_snapshot(snapshot: Dictionary, receive_seconds: float, match_scope: String) -> bool:\n';
assert.equal(original.split(needle).length, 2, "unambiguous mutation anchor");
fs.writeFileSync(target, original.replace(needle, needle + '\t# DELIBERATE TEST BUG: freeze new authority while holding.\n\tif _rebuffering: return true\n'));
await checkedGodot(["--headless", "--editor", "--path", copy, "--import"], {timeout:120000, log:path.join(evidence,"import.log")});
let failed = false;
try {
  await checkedGodot(["--headless", "--path", copy, "--script", "res://tests/snapshot_timeline.gd"], {log:path.join(evidence,"timeline.log")});
} catch { failed = true; }
const output = fs.readFileSync(path.join(evidence,"timeline.log"), "utf8");
assert.ok(failed, "frozen authority must fail the unit suite");
assert.match(output, /^PASS authority-update scenario genuinely enters reanchor hold/m);
assert.match(output, /^FAIL held timeline accepts fresh authoritative negative correction/m);
assert.match(output, /^FAIL fresh authority may move pose backwards after hold without source-time rewind/m);
assert.match(output, /^FAIL held presentation does not retain authoritatively removed player/m);
assert.equal(hash(fs.readFileSync(path.join(source,"core/snapshot_timeline.gd"),"utf8")), hash(original), "production timeline unchanged");
const summary = output.match(/TIMELINE_CHECKS (\d+) FAILURES (\d+)/);
assert.ok(summary && Number(summary[2]) > 0);
fs.writeFileSync(path.join(evidence,"result.json"), JSON.stringify({expected_failure:true, checks:Number(summary[1]), failures:Number(summary[2]), production_sha256:hash(original)},null,2));
console.log(`PASS isolated frozen-authority negative control: ${summary[2]}/${summary[1]} assertions fail as expected; evidence ${evidence}`);
