import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./acceptance-lifecycle.js', import.meta.url), 'utf8');
function fixture() {
  const handlers = { hide: [], show: [] }, logs = [];
  const context = vm.createContext({ GameGlobal: { window: {} },
    wx: { onHide: callback => handlers.hide.push(callback), onShow: callback => handlers.show.push(callback) },
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  vm.runInContext(source, context);
  return { context, api: context.FoundationAcceptance, logs,
    emit: event => handlers[event].forEach(callback => callback()), handlers };
}
test('native/no-wx context gets no test platform global', () => {
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(context.FoundationAcceptance, undefined);
});
test('visibility remains observable even before Godot subscribes', () => {
  const f = fixture(); assert.equal(f.api.isHidden(), false);
  f.emit('hide'); assert.equal(f.api.isHidden(), true);
  f.emit('show'); assert.equal(f.api.isHidden(), false);
});
test('only fixed visibility events reach subscribers and globals share the API', () => {
  const f = fixture(), events = [];
  const handle = f.api.subscribeLifecycle(event => events.push(event)); assert.ok(handle > 0);
  f.emit('hide'); f.emit('show'); assert.deepEqual(events, ['hide', 'show']);
  assert.equal(f.context.GameGlobal.FoundationAcceptance, f.api);
  assert.equal(f.context.GameGlobal.window.FoundationAcceptance, f.api);
});
test('unsubscribe prevents a released entry receiving any later event', () => {
  const f = fixture(), events = []; const handle = f.api.subscribeLifecycle(event => events.push(event));
  f.api.unsubscribeLifecycle(handle); f.api.unsubscribeLifecycle(handle);
  f.emit('hide'); f.emit('show'); assert.deepEqual(events, []);
});
test('unsubscribing another entry during dispatch takes effect immediately', () => {
  const f = fixture(); let calls = 0, second;
  f.api.subscribeLifecycle(() => f.api.unsubscribeLifecycle(second));
  second = f.api.subscribeLifecycle(() => calls++); f.emit('hide'); assert.equal(calls, 0);
});
test('callback error does not block other listeners or log its private text', () => {
  const f = fixture(); let calls = 0;
  f.api.subscribeLifecycle(() => { throw Error('PRIVATE_TEST_CALLBACK'); });
  f.api.subscribeLifecycle(() => calls++); f.emit('hide');
  assert.equal(calls, 1); assert.deepEqual(f.logs, []);
});
test('bridge re-evaluation does not duplicate wx subscriptions', () => {
  const f = fixture(); vm.runInContext(source, f.context);
  assert.equal(f.handlers.hide.length, 1); assert.equal(f.handlers.show.length, 1);
  assert.equal(f.context.FoundationAcceptance, f.api);
});
test('listener capacity is bounded and released capacity is reusable', () => {
  const f = fixture(); assert.equal(f.api.subscribeLifecycle(null), 0);
  const handles = Array.from({ length: 4 }, () => f.api.subscribeLifecycle(() => {}));
  assert.equal(f.api.subscribeLifecycle(() => {}), 0);
  f.api.unsubscribeLifecycle(handles[0]); assert.ok(f.api.subscribeLifecycle(() => {}) > 0);
});
