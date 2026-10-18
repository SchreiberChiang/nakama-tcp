import { mkdirSync } from "node:fs";
import { restoreSourceAssets } from "./restore-source-assets.mjs";
import { checkedGodot } from "./test-profile.mjs";

export async function prepareTests() {
  if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
  mkdirSync(".local", { recursive: true });
  // A fresh checkout needs both its source font and Godot's global class cache
  // before Session and the SDK are loaded by any runtime regression.
  restoreSourceAssets();
  await checkedGodot(
    ["--headless", "--editor", "--path", "client", "--import"],
    { timeout: 120000, log: ".local/import.log" },
  );
  // Stay in the owning Node process until the bounded Godot children finish.
  await import("../tests/test-profile.mjs");
  console.log("TEST_PREPARATION_OK");
}
