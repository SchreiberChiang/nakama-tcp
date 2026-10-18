import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, connectionConfig, stageProject, exportCrossPlatform, parseArgs } from '../scripts/export-cross-platform.mjs';
import { validateInventory } from '../scripts/audit-cross-platform.mjs';
import { checked } from '../scripts/process.mjs';

const base = path.join(ROOT, '.local/cross-platform');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(path.join(base, 'packaging-unit-'));
let checks = 0;
const check = action => { action(); checks++; };
function put(file, text = 'fixture') {
  const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, text);
}
function out(name) { return path.join(root, '.local/cross-platform', name); }
try {
  execFileSync('git', ['init', '-q', root]);
  put('tracked.txt');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Packaging Test', '-c', 'user.email=packaging@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
  check(() => assert.throws(() => stageProject({ root, out: out('missing') }), /Missing cross-platform entry/));
  check(() => assert.equal(existsSync(out('missing')), false));
  for (const file of ['addons/sdk.gd', 'assets/fonts/LICENSE-CJK.txt', 'core/module_registry.gd', 'ui/main.gd', 'Main.tscn', 'tests/fixture_view.gd', 'tests/fixture_view.gd.uid', 'tests/cross_platform/entry.tscn', 'tests/cross_platform/test_session.gd', 'tests/cross_platform/ui.gd']) put(`client/${file}`);
  put('client/project.godot', 'config_version=5\n[application]\nrun/main_scene="res://Main.tscn"\n[autoload]\nSession="*res://core/session.gd"\n');
  for (const file of ['.godot/cached', 'tests/driver.gd', 'tests/module_request_isolation.gd', 'tests/cross_platform/driver.gd', 'tests/cross_platform/fault_injection.gd', 'tests/cross_platform/local.private.cfg', 'addons/.env', 'addons/secret.key', 'assets/logs/private.txt']) put(`client/${file}`, 'NEVER_COPY');
  mkdirSync(path.join(root, 'assets/source-fonts'), { recursive: true });
  copyFileSync(path.join(ROOT, 'assets/source-fonts/TemplateCJK.otf.gz'), path.join(root, 'assets/source-fonts/TemplateCJK.otf.gz'));
  const projectBefore = readFileSync(path.join(root, 'client/project.godot'));
  const registryBefore = readFileSync(path.join(root, 'client/core/module_registry.gd'));
  const stage = stageProject({ root, out: out('fresh'), config: connectionConfig({ host: '192.168.1.2', allow_insecure_lan: true }) });
  check(() => assert.deepEqual(readFileSync(path.join(root, 'client/project.godot')), projectBefore));
  check(() => assert.deepEqual(readFileSync(path.join(root, 'client/core/module_registry.gd')), registryBefore));
  check(() => assert.equal(existsSync(path.join(root, 'client/assets/fonts/TemplateCJK.otf')), false));
  check(() => assert.deepEqual(readFileSync(path.join(stage.client, 'core/module_registry.gd')), registryBefore));
  for (const file of ['.godot', 'tests/driver.gd', 'tests/module_request_isolation.gd', 'tests/cross_platform/driver.gd', 'tests/cross_platform/fault_injection.gd', 'tests/cross_platform/local.private.cfg', 'addons/.env', 'addons/secret.key', 'assets/logs']) check(() => assert.equal(existsSync(path.join(stage.client, file)), false, file));
  const project = readFileSync(path.join(stage.client, 'project.godot'), 'utf8');
  check(() => assert.match(project, /Session="\*res:\/\/tests\/cross_platform\/test_session.gd"/));
  check(() => assert.match(project, /config\/custom_user_dir_name="nakama-cross-platform-/));
  check(() => assert.match(project, /allow_insecure_lan=true/));
  check(() => assert.equal(stage.manifest.source_sha.length, 40));
  check(() => assert.equal(stage.manifest.source_dirty, true));
  check(() => assert.equal(stage.manifest.pck, null));
  check(() => assert.throws(() => stageProject({ root, out: stage.out }), /already exists/));
  check(() => assert.throws(() => stageProject({ root, out: path.join(root, 'unsafe') }), /under .local/));
  for (const config of [{ host: 'example.com' }, { host: '192.168.0.4' }, { host: '172.32.0.1', allow_insecure_lan: true }, { host: '192.168.1.999', allow_insecure_lan: true }, { host: '127.0.0.2' }, { host: '192.168.01.2', allow_insecure_lan: true }, { host: '010.0.0.2', tls: true }, { server_key: 'PRIVATE' }]) check(() => assert.throws(() => connectionConfig(config)));
  check(() => assert.equal(connectionConfig({ host: 'example.com', tls: true }).tls, true));
  check(() => assert.equal(connectionConfig().host, '127.0.0.1'));
  check(() => assert.throws(() => parseArgs(['--tls', 'yes'])));
  check(() => assert.throws(() => parseArgs(['--server-key', 'PRIVATE'])));
  const calls = [];
  await assert.rejects(exportCrossPlatform({ root, out: out('import-failure'), godot: 'fake', runner: async (_cmd, args) => { calls.push(args); if (args[0] === '--version') return '4.7.2.stable.fixture'; throw Error('import failure'); } }), /import failure/); checks++;
  check(() => assert.equal(calls.length, 2));
  check(() => assert.ok(calls[1].includes('--import')));
  const exportCalls = [];
  await assert.rejects(exportCrossPlatform({ root, out: out('export-failure'), godot: 'fake', runner: async (_cmd, args) => { exportCalls.push(args); if (args[0] === '--version') return '4.7.2.stable.fixture'; if (args.includes('--import')) return ''; throw Error('export failure'); } }), /export failure/); checks++;
  check(() => assert.equal(exportCalls.length, 3));
  check(() => assert.ok(exportCalls[1].includes('--import') && exportCalls[2].includes('--export-pack')));
  await assert.rejects(exportCrossPlatform({ root, out: out('wrong-version'), godot: 'fake', runner: async () => '4.6.1.stable' }), /4.7.2/); checks++;
  check(() => assert.equal(existsSync(out('wrong-version')), false));
  const inventory = { files: ['res://project.binary', 'res://addons/NAKAMA_SDK_LICENSE', 'res://assets/fonts/LICENSE-CJK.txt', ...Array.from({ length: 25 }, (_, i) => `res://core/a${i}.gdc`)], main_scene: 'res://tests/cross_platform/entry.tscn', session: '*res://tests/cross_platform/test_session.gd', empty_registry: true, has_entry: true, has_main: true, has_fixture: true, entry_instantiated: true, fixture_registry_count: 1, has_fixture_module: true, isolated_user_data: true, test_enabled: true, bad_nodes: [] };
  check(() => validateInventory(inventory));
  for (const file of ['res://tests/driver.gd.remap', 'res://tests/other.gdc', 'res://assets/car.png', 'res://assets/map.glb', 'res://tests/cross_platform/private.key']) check(() => assert.throws(() => validateInventory({ ...inventory, files: [...inventory.files, file] })));
  check(() => assert.throws(() => validateInventory({ ...inventory, empty_registry: false })));
  await assert.rejects(checked(process.execPath, ['-e', 'console.log("SCRIPT ERROR: synthetic exit-zero Godot diagnostic")'], { timeout: 15000, forbidErrors: true }), /Process failed \(0\)/); checks++;
  console.log(`PASS cross-platform packaging: ${checks} checks (staging, isolation, manifest, fail-fast ordering, audit rules; no actual Godot export)`);
} finally {
  // root is the exact mkdtemp directory owned by this test.
  rmSync(root, { recursive: true, force: true });
}
