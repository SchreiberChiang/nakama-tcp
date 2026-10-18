// Cross-platform acceptance client unit tests. Godot only: no backend, sockets or ports.
// Uses checkedGodot's owned profile so the default player configuration is never written.
// Simulated touch and lifecycle notifications are not WeChat, iPhone or network evidence.
import { checkedGodot } from "../scripts/test-profile.mjs";

if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
const output = await checkedGodot(
  ["--headless", "--path", "client", "--script", "res://tests/cross_platform/cross_platform_tests.gd"],
  { timeout: 120000, log: ".local/cross-platform-client.log" },
);
if (/PRIVATE_/.test(output)) throw Error("Cross-platform client output leaked a private sentinel.");
// Exact count: a script error aborts a test function and would otherwise drop checks silently.
const EXPECTED_CHECKS = 93;
if (!output.includes(`CROSS_PLATFORM_CHECKS ${EXPECTED_CHECKS} FAILURES 0`))
  throw Error(`Cross-platform client must report exactly ${EXPECTED_CHECKS} passing checks.`);
console.log(output);
