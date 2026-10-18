import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checked } from './process.mjs';

export function validateInventory(inventory) {
  assert.ok(Array.isArray(inventory.files) && inventory.files.length > 20, 'nonempty actual PCK');
  assert.equal(inventory.main_scene, 'res://tests/cross_platform/entry.tscn');
  assert.equal(inventory.session, '*res://tests/cross_platform/test_session.gd');
  assert.equal(inventory.empty_registry, true, 'original production registry stays empty before entry');
  assert.equal(inventory.has_entry, true);
  assert.equal(inventory.has_main, true);
  assert.equal(inventory.has_fixture, true);
  assert.equal(inventory.entry_instantiated, true);
  assert.equal(inventory.fixture_registry_count, 1, 'entry registers exactly the fixture');
  assert.equal(inventory.has_fixture_module, true);
  assert.equal(inventory.isolated_user_data, true);
  assert.equal(inventory.test_enabled, true);
  assert.deepEqual(inventory.bad_nodes, []);
  const forbidden = /(?:games\/|fixtures\/|racing|stones|tabletop|harbor|vehicle|driver|fault|injection|\.private\.|(?:^|\/)\.env|\.(?:pem|key|ogg|wav|mp3|glb|gltf|png|jpe?g|webp|svg)(?:$|\.))/i;
  assert.deepEqual(inventory.files.filter(file => forbidden.test(file)), [], 'forbidden test/art dependency');
  assert.deepEqual(inventory.files.filter(file => file.startsWith('res://tests/') && !file.startsWith('res://tests/cross_platform/') && !/^res:\/\/tests\/fixture_view\.gdc?(?:\.(?:remap|uid))?$/.test(file)), [], 'unrelated test dependency');
  assert.ok(inventory.files.includes('res://project.binary'));
  for (const required of ['res://addons/NAKAMA_SDK_LICENSE', 'res://assets/fonts/LICENSE-CJK.txt']) assert.ok(inventory.files.includes(required), 'third-party license preserved');
}

export async function auditCrossPlatform({ godot = process.env.GODOT, pack, out, runner = checked }) {
  if (!godot || !pack || !out) throw Error('Audit requires GODOT, pack and fresh output directory');
  pack = path.resolve(pack); out = path.resolve(out);
  mkdirSync(out); // preserve previous evidence; never overwrite
  const empty = path.join(out, 'empty-root'); mkdirSync(empty);
  const report = path.join(out, 'inventory.json');
  await runner(godot, ['--headless', '--main-pack', pack, '--script', path.join(path.dirname(fileURLToPath(import.meta.url)), 'cross_platform_pack_check.gd'), '--', `--report=${report}`], { cwd: empty, timeout: 15000, forbidErrors: true, log: path.join(out, 'runtime.log') });
  const inventory = JSON.parse(readFileSync(report, 'utf8'));
  validateInventory(inventory);
  const data = readFileSync(pack);
  const result = { ...inventory, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), checked: 'actual PCK from empty cwd; entry instantiated without login/network actions' };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--pack' || args[2] !== '--out') throw Error('Usage: audit-cross-platform.mjs --pack <test.pck> --out <fresh-audit-directory>');
    await auditCrossPlatform({ pack: args[1], out: args[3] });
    console.log('PASS actual cross-platform PCK inventory and test entry');
  } catch (error) { console.error(`Cross-platform audit failed: ${error.message}`); process.exitCode = 1; }
}
