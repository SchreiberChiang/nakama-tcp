// Thin, local-only orchestration of wechat-wasm-slim; conversion stays upstream.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checked } from './process.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = data => createHash('sha256').update(data).digest('hex');
function noLinks(target) {
  target = path.resolve(target);
  let cursor = path.parse(target).root;
  for (const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error('Symlink path is not supported');
  }
  return target;
}
function file(target) {
  target = noLinks(target);
  if (!lstatSync(target).isFile()) throw Error('Expected a regular input file');
  return target;
}
function directory(target) {
  target = noLinks(target);
  if (!lstatSync(target).isDirectory()) throw Error('Expected an input directory');
  return target;
}
const json = target => JSON.parse(readFileSync(file(target), 'utf8'));
const token = (value, regex) => typeof value === 'string' && regex.test(value);

export async function convertCrossPlatform({ root = ROOT, tool, engine, packageDir, out, transformer, appid } = {}) {
  if (![tool, engine, packageDir, out].every(value => typeof value === 'string' && value.length)) throw Error('Required: --tool, --engine, --package, --out');
  tool = directory(tool); engine = directory(engine); packageDir = directory(packageDir);
  out = noLinks(out);
  const relative = path.relative(path.resolve(root, '.local/cross-platform'), out);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Output must be a fresh directory under .local/cross-platform');
  if (existsSync(out)) throw Error('Output already exists; refusing overwrite');
  for (const input of [tool, engine, packageDir]) {
    const nested = path.relative(input, out);
    if (!nested || (!nested.startsWith('..') && !path.isAbsolute(nested))) throw Error('Output must be separate from input directories');
  }
  if (appid !== undefined && !/^wx[0-9a-f]{16}$/.test(appid)) throw Error('Invalid AppID format');
  const manifest = json(path.join(packageDir, 'manifest.json'));
  if (manifest.schema !== 1 || manifest.stage !== 'exported-and-audited' || manifest.entry !== 'res://tests/cross_platform/entry.tscn' || manifest.development_key !== 'defaultkey' || !token(manifest.source_sha, /^[0-9a-f]{40}$/) || typeof manifest.source_dirty !== 'boolean' || !token(manifest.godot_version, /^4\.7\.2(?:\.[A-Za-z0-9_-]+)*$/) || manifest.pck?.file !== 'test.pck') throw Error('Package manifest is not an audited cross-platform fixture export');
  // Current exporter does not emit protocol_version. Validate it if a later schema-1 exporter supplies it.
  if (manifest.protocol_version !== undefined && manifest.protocol_version !== 3) throw Error('Unsupported package protocol version');
  const pack = file(path.join(packageDir, 'test.pck'));
  const data = readFileSync(pack);
  if (data.length < 20 || data.subarray(0, 4).toString('latin1') !== 'GDPC' || [8, 12, 16].map(offset => data.readUInt32LE(offset)).join('.') !== '4.7.2') throw Error('PCK header must identify Godot 4.7.2');
  if (manifest.pck.bytes !== data.length || manifest.pck.sha256 !== sha(data)) throw Error('PCK does not match audited export manifest');
  const cli = file(path.join(tool, 'convert/convert.mjs'));
  const toolchainFile = file(path.join(tool, 'convert/convert.toolchain.json'));
  const tc = json(toolchainFile);
  transformer = file(transformer ?? path.resolve(path.dirname(toolchainFile), tc.transformer));
  if (!token(tc.transformerVersion, /^[A-Za-z0-9_.-]{1,60}$/) || !token(tc.transformerSha256, /^[0-9a-f]{64}$/) || sha(readFileSync(transformer)) !== tc.transformerSha256) throw Error('Transformer must match upstream version and SHA256 pin');
  const engineFiles = readdirSync(engine).map(name => noLinks(path.join(engine, name))).filter(name => lstatSync(name).isFile());
  const jsFiles = engineFiles.filter(name => name.endsWith('.js') && readFileSync(name, 'utf8').includes('var Godot = '));
  if (jsFiles.length !== 1) throw Error('Engine directory must identify exactly one original Godot JS');
  const js = jsFiles[0];
  const wasm = file(path.join(engine, path.basename(js, '.js') + '.wasm'));
  const bridgeFiles = ['decoded-json.js', 'acceptance-lifecycle.js'].map(name => file(path.join(root, 'platform/wechat', name)));
  const interfaces = bridgeFiles.map(name => readFileSync(name, 'utf8')).join('\n;\n');
  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(out); // own the wrapper root exclusively; upstream gets a fresh child
  const inputs = path.join(out, 'local-inputs'); mkdirSync(inputs);
  const interfacesFile = path.join(inputs, 'interfaces.js'); writeFileSync(interfacesFile, interfaces);
  const localToolchain = path.join(inputs, 'toolchain.private.json');
  writeFileSync(localToolchain, JSON.stringify({ ...tc, transformer }, null, 2));
  let appidArgs = [];
  if (appid !== undefined) {
    const localAppid = path.join(inputs, 'appid.private.json');
    writeFileSync(localAppid, JSON.stringify({ appid }), { mode: 0o600 });
    appidArgs = ['--appid-from', localAppid];
  }
  const converted = path.join(out, 'wechat');
  const common = ['--export', engine, '--pck', pack, '--toolchain', localToolchain];
  const run = async (step, args) => {
    try {
      // Do not forward raw tool output/errors: they can contain local paths or AppID.
      await checked(process.execPath, [cli, step, ...args], { cwd: out, timeout: 900000, forbidErrors: true });
    } catch { throw Error(`wechat-wasm-slim ${step} failed; conversion is not accepted`); }
  };
  await run('check', common);
  await run('convert', [...common, '--out', converted, '--interfaces', interfacesFile, '--no-timing', '--orientation', 'landscape', '--locale', 'zh', '--name', 'foundation-cross-platform', ...appidArgs]);
  directory(path.join(converted, 'minigame'));
  const gameData = path.join(converted, 'minigame/godot-data');
  if (existsSync(path.join(gameData, 'wxslim-timing.js'))) throw Error('Conversion unexpectedly installed persistent timing diagnostics');
  if (sha(readFileSync(file(path.join(gameData, 'local-interfaces.js')))) !== sha(interfaces)) throw Error('Converted interfaces do not match local bridges');
  await run('verify', ['--project', path.join(converted, 'minigame'), '--toolchain', localToolchain]);
  const summary = {
    schema: 1, source_sha: manifest.source_sha, source_dirty: manifest.source_dirty,
    godot_version: manifest.godot_version,
    ...(manifest.protocol_version === undefined ? {} : { protocol_version: manifest.protocol_version }),
    pck: { bytes: data.length, sha256: sha(data) },
    tool: { cli_sha256: sha(readFileSync(cli)), toolchain_sha256: sha(readFileSync(toolchainFile)) },
    transformer: { version: tc.transformerVersion, sha256: tc.transformerSha256 },
    engine: { js_sha256: sha(readFileSync(js)), wasm_sha256: sha(readFileSync(wasm)) },
    interfaces_sha256: sha(interfaces), timing_enabled: false, appid_supplied: appid !== undefined,
    steps: ['check', 'convert', 'verify'], verified: true,
  };
  writeFileSync(path.join(out, 'conversion-summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

export function parseArgs(args) {
  const result = {};
  const keys = { '--tool': 'tool', '--engine': 'engine', '--package': 'packageDir', '--out': 'out', '--transformer': 'transformer', '--appid': 'appid' };
  for (let i = 0; i < args.length; i++) {
    const key = keys[args[i]], value = args[++i];
    if (!key || !value || value.startsWith('--') || result[key] !== undefined) throw Error('Invalid or duplicate conversion option');
    result[key] = value;
  }
  return result;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await convertCrossPlatform(parseArgs(process.argv.slice(2))); console.log('PASS local WeChat conversion: check, convert, verify; timing disabled'); }
  catch (error) {
    // Filesystem/JSON errors may include private input values; CLI emits a fixed message.
    console.error('Cross-platform conversion failed; verify local inputs and tool compatibility. No accepted conversion evidence was produced.');
    process.exitCode = 1;
  }
}
