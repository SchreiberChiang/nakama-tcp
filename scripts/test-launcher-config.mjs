import assert from "node:assert/strict";
import { inputRuntimeArgs } from "./dev-server.mjs";
assert.deepEqual(inputRuntimeArgs({}), []);
for (const key of ["GAME_INPUT_WINDOW_TICKS", "GAME_STATE_TIMEOUT_TICKS"]) {
  for (const value of ["1", "30", "300"])
    assert.deepEqual(inputRuntimeArgs({[key]: value}), ["--runtime.env", `${key}=${value}`]);
  for (const value of ["", "0", "301", "-1", "1.5", "1e2", " 30", "NaN"])
    assert.throws(() => inputRuntimeArgs({[key]: value}));
}
assert.deepEqual(inputRuntimeArgs({GAME_INPUT_WINDOW_TICKS: "90", GAME_STATE_TIMEOUT_TICKS: "45"}),
  ["--runtime.env", "GAME_INPUT_WINDOW_TICKS=90", "--runtime.env", "GAME_STATE_TIMEOUT_TICKS=45"]);
console.log("PASS launcher input window options: 24 assertions; unset omitted, bounded integers forwarded to runtime.env");
