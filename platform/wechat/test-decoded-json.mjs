import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
const task = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(task, "decoded-json.js"), "utf8");
const ab = (b) => Uint8Array.from(b).buffer;
const normal = {
  statusCode: 200,
  header: {
    "Content-Encoding": "gzip",
    "Content-Type": "application/json",
    "Content-Length": "7",
  },
  data: ab(Buffer.from('{"ok":true}')),
};
const cases = [
  ["decoded JSON", normal, true],
  ["real gzip", { ...normal, data: ab(zlib.gzipSync('{"ok":true}')) }, false],
  ["invalid JSON", { ...normal, data: ab(Buffer.from("invalid body")) }, false],
  [
    "non JSON",
    {
      ...normal,
      header: { ...normal.header, "Content-Type": "application/octet-stream" },
    },
    false,
  ],
  [
    "no encoding",
    { ...normal, header: { "Content-Type": "application/json" } },
    false,
  ],
  ["typed subview", normal, true],
  ["JSON error status", { ...normal, statusCode: 401 }, true],
];
// Exact-range typed view with unrelated prefix/suffix.
const padded = Uint8Array.from(Buffer.from('x{"ok":true}z'));
cases[5] = [
  "typed subview",
  { ...normal, data: padded.subarray(1, padded.length - 1) },
  true,
];
const results = [];
for (const [name, response, strip] of cases) {
  const beforeHeaders = JSON.stringify(response.header);
  let sent,
    listener,
    received,
    gotHeaders,
    taskObject = {
      onHeadersReceived(cb) {
        listener = cb;
      },
      abort() {},
    };
  const wx = {
    request(o) {
      sent = o;
      return taskObject;
    },
  };
  vm.runInNewContext(code, {
    wx,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    console: { log() {} },
  });
  const ret = wx.request({
    responseType: "arraybuffer",
    enableChunked: true,
    success(r) {
      received = r;
    },
  });
  ret.onHeadersReceived((r) => {
    gotHeaders = r;
  });
  listener({ statusCode: response.statusCode, header: response.header });
  sent.success(response);
  const has = Object.keys(received.header).some(
    (k) => k.toLowerCase() === "content-encoding",
  );
  assert.equal(
    has,
    strip ? false : !!response.header["Content-Encoding"],
    name,
  );
  assert.equal(gotHeaders.statusCode, response.statusCode, name);
  assert.equal(received.data, response.data, name + " body identity");
  assert.equal(sent.enableChunked, false);
  assert.equal(ret, taskObject);
  assert.equal(
    JSON.stringify(response.header),
    beforeHeaders,
    name + " original headers unchanged",
  );
  results.push({ name, passed: true });
}

console.log(JSON.stringify({ passed: results.length, failed: 0 }));
