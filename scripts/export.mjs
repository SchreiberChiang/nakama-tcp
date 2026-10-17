import { checked } from "./process.mjs";
import { mkdirSync } from "node:fs";
if (!process.env.GODOT) throw Error("Set GODOT to Godot 4.7.2 executable.");
mkdirSync("artifacts", { recursive: true });
await checked(
  process.env.GODOT,
  ["--headless", "--editor", "--path", "client", "--import"],
  { timeout: 120000, log: ".local/import.log" },
);
await checked(
  process.env.GODOT,
  [
    "--headless",
    "--path",
    "client",
    "--export-pack",
    "Template PCK",
    "../artifacts/template.pck",
  ],
  { timeout: 120000, log: ".local/export.log" },
);
await import("./audit.mjs");
