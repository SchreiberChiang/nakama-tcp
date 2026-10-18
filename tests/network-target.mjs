// Explicit opt-in for an owned, isolated remote fixture backend. No connections here.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function networkTarget(env = process.env) {
  const keys = ['TEST_HOST', 'TEST_PORT', 'TEST_TLS', 'TEST_REMOTE_OWNED'];
  if (keys.every(key => env[key] === undefined))
    return { remote: false, args: [], movementLabel: 'loopback_movement' };
  if (keys.some(key => typeof env[key] !== 'string' || !env[key]))
    throw Error('Explicit network target requires TEST_HOST, TEST_PORT, TEST_TLS and TEST_REMOTE_OWNED.');
  if (env.TEST_REMOTE_OWNED !== '1' || env.TEST_TLS !== 'true')
    throw Error('Explicit network target requires TLS and ownership of an isolated test backend.');
  const host = env.TEST_HOST;
  // DNS name or canonical IPv4 only; no URL, credentials, path, port or whitespace.
  if (host.length > 253 || !host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))
    throw Error('Invalid explicit network host.');
  if (/^[\d.]+$/.test(host) && (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host) || host.split('.').some(part => Number(part) > 255)))
    throw Error('Invalid explicit network host.');
  if (!/^[1-9]\d{0,4}$/.test(env.TEST_PORT) || Number(env.TEST_PORT) > 65535)
    throw Error('Invalid explicit network port.');
  return { remote: true, args: [`--host=${host}`, `--port=${env.TEST_PORT}`, '--tls=true'], movementLabel: 'remote_tls_movement' };
}

export function acceptanceRounds(env = process.env) {
  if (env.TEST_ACCEPTANCE_ROUNDS === undefined) return 2;
  if (env.TEST_ACCEPTANCE_ROUNDS !== '3' || env.TEST_FIXTURE !== '1' || (env.TEST_FAULT ?? '') !== '')
    throw Error('TEST_ACCEPTANCE_ROUNDS only supports 3 with TEST_FIXTURE=1 and no fault mode.');
  return 3;
}

// Run standalone for parameter tests, without Godot, backend, profiles or ports.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { default: assert } = await import('node:assert/strict');
  let checks = 0;
  const check = action => { action(); checks++; };
  check(() => assert.deepEqual(networkTarget({}), { remote: false, args: [], movementLabel: 'loopback_movement' }));
  const target = { TEST_HOST: 'fixture.example.test', TEST_PORT: '17443', TEST_TLS: 'true', TEST_REMOTE_OWNED: '1' };
  check(() => assert.deepEqual(networkTarget(target), { remote: true, args: ['--host=fixture.example.test', '--port=17443', '--tls=true'], movementLabel: 'remote_tls_movement' }));
  for (const key of Object.keys(target)) {
    const missing = { ...target }; delete missing[key];
    check(() => assert.throws(() => networkTarget(missing)));
  }
  for (const bad of [{ TEST_TLS: 'false' }, { TEST_TLS: 'TRUE' }, { TEST_REMOTE_OWNED: '0' }, { TEST_HOST: '' }, { TEST_HOST: 'https://fixture.example.test' }, { TEST_HOST: 'user@fixture.example.test' }, { TEST_HOST: 'fixture.example.test:443' }, { TEST_HOST: ' fixture.example.test' }, { TEST_HOST: '-invalid.test' }, { TEST_HOST: '192.168.01.2' }, { TEST_HOST: '300.1.2.3' }, { TEST_PORT: '0' }, { TEST_PORT: '65536' }, { TEST_PORT: '0443' }, { TEST_PORT: '443.5' }])
    check(() => assert.throws(() => networkTarget({ ...target, ...bad })));
  check(() => assert.equal(networkTarget({ ...target, TEST_HOST: '192.168.1.2' }).remote, true));
  check(() => assert.equal(acceptanceRounds({}), 2));
  check(() => assert.equal(acceptanceRounds({ TEST_ACCEPTANCE_ROUNDS: '3', TEST_FIXTURE: '1' }), 3));
  for (const bad of [{ TEST_ACCEPTANCE_ROUNDS: '2', TEST_FIXTURE: '1' }, { TEST_ACCEPTANCE_ROUNDS: '3' }, { TEST_ACCEPTANCE_ROUNDS: '3', TEST_FIXTURE: '1', TEST_FAULT: 'input' }])
    check(() => assert.throws(() => acceptanceRounds(bad)));
  check(() => assert.throws(() => networkTarget({ ...target, TEST_PORT: 'PRIVATE_PORT' }), error => !error.message.includes(target.TEST_HOST) && !error.message.includes('PRIVATE_PORT')));
  console.log(`PASS network target: ${checks} checks; no network connections`);
}
