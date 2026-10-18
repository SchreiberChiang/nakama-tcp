import { existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checked } from './process.mjs';
import { FONT_SHA256, FONT_BYTES } from './restore-source-assets.mjs';
import { auditCrossPlatform } from './audit-cross-platform.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => createHash('sha256').update(data).digest('hex');
export function connectionConfig(input = {}) {
  const host = input.host ?? '127.0.0.1';
  const port = Number(input.port ?? 7350);
  const tls = input.tls ?? false;
  const allow_insecure_lan = input.allow_insecure_lan ?? false;
  const diagnostics = input.diagnostics ?? false;
  if (Object.keys(input).some(key => !['host', 'port', 'tls', 'allow_insecure_lan', 'diagnostics'].includes(key))) throw Error('Unsupported connection option; development key is fixed');
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(host) || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid host or port');
  if ([tls, allow_insecure_lan, diagnostics].some(value => typeof value !== 'boolean')) throw Error('Connection flags must be booleans');
  const octets = host.split('.').map(Number);
  const dottedNumeric = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const ipv4 = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host) && octets.every(n => n <= 255);
  if (dottedNumeric && !ipv4) throw Error('IPv4 requires decimal octets without leading zeroes');
  // The test transport extends production policy only for explicit RFC1918 LAN.
  // This packaging CLI supports IPv4/localhost, not the ::1 spelling.
  const loopback = host === 'localhost' || host === '127.0.0.1';
  const lan = ipv4 && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  if (!tls && !loopback && !(lan && allow_insecure_lan)) throw Error('Plaintext requires loopback or explicitly allowed RFC1918 IPv4');
  return { enabled: true, host, port, tls, allow_insecure_lan, diagnostics };
}

const excluded = /(?:^|\/)(?:\.godot|\.git|profiles?|logs?|artifacts|build|driver[^/]*|[^/]*(?:fault|injection)[^/]*)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.private\.|\.(?:pem|key|pck|wasm|exe|log|cfg)$/i;
function copyTree(source, target, relative = '') {
  for (const entry of readdirSync(source)) {
    const rel = relative ? `${relative}/${entry}` : entry;
    if (excluded.test(rel)) continue;
    const from = path.join(source, entry), to = path.join(target, entry);
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) throw Error('Symlink in selected source');
    if (stat.isDirectory()) { mkdirSync(to, { recursive: true }); copyTree(from, to, rel); }
    else if (stat.isFile()) copyFileSync(from, to);
  }
}
export function stageProject({ root = ROOT, out, config = connectionConfig() }) {
  config = connectionConfig(Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'enabled')));
  const base = path.resolve(root, '.local/cross-platform');
  out = path.resolve(out ?? path.join(base, randomUUID()));
  const relative = path.relative(base, out);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Output must be a fresh directory under .local/cross-platform');
  if (existsSync(out)) throw Error('Output already exists; refusing overwrite');
  const source = path.join(root, 'client');
  for (const required of ['tests/cross_platform/entry.tscn', 'tests/cross_platform/test_session.gd']) {
    if (!existsSync(path.join(source, required))) throw Error(`Missing cross-platform entry source: ${required}; export stopped`);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(out); // exclusive reservation; never copy into an existing run
  const client = path.join(out, 'client');
  mkdirSync(client);
  for (const dir of ['addons', 'assets', 'core', 'ui']) {
    mkdirSync(path.join(client, dir)); copyTree(path.join(source, dir), path.join(client, dir));
  }
  copyFileSync(path.join(source, 'Main.tscn'), path.join(client, 'Main.tscn'));
  mkdirSync(path.join(client, 'tests/cross_platform'), { recursive: true });
  copyTree(path.join(source, 'tests/cross_platform'), path.join(client, 'tests/cross_platform'));
  for (const file of ['fixture_view.gd', 'fixture_view.gd.uid']) if (existsSync(path.join(source, 'tests', file))) copyFileSync(path.join(source, 'tests', file), path.join(client, 'tests', file));
  const fontPath = path.join(client, 'assets/fonts/TemplateCJK.otf');
  const font = existsSync(fontPath) ? readFileSync(fontPath) : gunzipSync(readFileSync(path.join(root, 'assets/source-fonts/TemplateCJK.otf.gz')));
  if (font.length !== FONT_BYTES || hash(font) !== FONT_SHA256) throw Error('Release font verification failed');
  if (!existsSync(fontPath)) writeFileSync(fontPath, font, { flag: 'wx' });
  const runId = randomUUID();
  let project = readFileSync(path.join(source, 'project.godot'), 'utf8')
    .replace(/^run\/main_scene=.*$/m, 'run/main_scene="res://tests/cross_platform/entry.tscn"')
    .replace(/^Session=.*$/m, 'Session="*res://tests/cross_platform/test_session.gd"')
    .replace('[application]', `[application]\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir_name="nakama-cross-platform-${runId}"`);
  project += '\n[cross_platform]\n' + Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  writeFileSync(path.join(client, 'project.godot'), project);
  writeFileSync(path.join(client, 'export_presets.cfg'), `[preset.0]\nname="Cross Platform Test PCK"\nplatform="Windows Desktop"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter="addons/NAKAMA_SDK_LICENSE,assets/fonts/LICENSE*.txt"\nexclude_filter="*.private.*,*.pem,*.key"\nscript_export_mode=2\n\n[preset.0.options]\n`);
  const manifest = {
    schema: 1, source_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    source_dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    godot_version: null, pck: null, stage: 'prepared',
    entry: 'res://tests/cross_platform/entry.tscn', development_key: 'defaultkey',
    pc_launch: ['<Godot 4.7.2 executable>', '--main-pack', 'test.pck'],
  };
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { out, client, manifest };
}

export async function exportCrossPlatform({ godot = process.env.GODOT, runner = checked, ...options } = {}) {
  if (!godot) throw Error('Set GODOT to the Godot 4.7.2 executable');
  const version = (await runner(godot, ['--version'], { timeout: 15000, forbidErrors: true })).trim();
  if (!/^4\.7\.2(?:\.|$)/.test(version)) throw Error('Godot 4.7.2 is required');
  const stage = stageProject(options);
  stage.manifest.godot_version = version;
  writeFileSync(path.join(stage.out, 'manifest.json'), JSON.stringify(stage.manifest, null, 2));
  const pack = path.join(stage.out, 'test.pck');
  // checked's existing output gate also rejects Godot SCRIPT ERROR with exit 0.
  await runner(godot, ['--headless', '--editor', '--path', stage.client, '--import'], { timeout: 120000, forbidErrors: true, log: path.join(stage.out, 'import.log') });
  await runner(godot, ['--headless', '--path', stage.client, '--export-pack', 'Cross Platform Test PCK', pack], { timeout: 120000, forbidErrors: true, log: path.join(stage.out, 'export.log') });
  const audit = await auditCrossPlatform({ godot, pack, out: path.join(stage.out, 'audit'), runner });
  stage.manifest.pck = { file: 'test.pck', bytes: audit.bytes, sha256: audit.sha256 };
  stage.manifest.stage = 'exported-and-audited';
  writeFileSync(path.join(stage.out, 'manifest.json'), JSON.stringify(stage.manifest, null, 2));
  return stage;
}

export function parseArgs(args) {
  const options = { config: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stage-only') options.stageOnly = true;
    else if (arg === '--allow-insecure-lan') options.config.allow_insecure_lan = true;
    else if (arg === '--diagnostics') options.config.diagnostics = true;
    else if (['--out', '--host', '--port', '--tls'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error('Missing option value');
      if (arg === '--out') options.out = value;
      else if (arg === '--tls') { if (!['true', 'false'].includes(value)) throw Error('TLS must be true or false'); options.config.tls = value === 'true'; }
      else options.config[arg.slice(2)] = value;
    } else throw Error('Unsupported export option');
  }
  options.config = connectionConfig(options.config);
  return options;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { stageOnly, ...options } = parseArgs(process.argv.slice(2));
    if (stageOnly) stageProject(options); else await exportCrossPlatform(options);
    console.log(stageOnly ? 'PASS cross-platform project staged (no export)' : 'PASS cross-platform test PCK exported and audited; launch with Godot 4.7.2 --main-pack test.pck');
  } catch (error) { console.error(`Cross-platform packaging failed: ${error.message}`); process.exitCode = 1; }
}
