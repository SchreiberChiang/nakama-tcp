import { restoreSourceAssets } from "./restore-source-assets.mjs";
import { checked } from "./process.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
restoreSourceAssets();
let config = "server/tsconfig.json";
if (process.argv.includes("--fixture")) {
  // Test-only alternate registry/build, never modifies the production registration.
  mkdirSync(".local/fixture-build", { recursive: true });
  writeFileSync(
    ".local/fixture-build/registry.ts",
    "var GAMES: { [id: string]: GameModule } = { fixture: LifecycleFixture };\n",
  );
  const ts = JSON.parse(readFileSync(config));
  ts.compilerOptions.outFile = path.resolve(".local/test-runtime/index.js");
  ts.files = ts.files.flatMap((p) =>
    p === "src/registry.ts"
      ? [
          path.resolve("tests/fixtures/module.ts"),
          path.resolve(".local/fixture-build/registry.ts"),
        ]
      : [path.resolve("server", p)],
  );
  config = ".local/fixture-build/tsconfig.json";
  writeFileSync(config, JSON.stringify(ts, null, 2));
}
await checked(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", config],
  { log: ".local/build.log" },
);
console.log(
  process.argv.includes("--fixture")
    ? "Test-only runtime built. Production registry untouched."
    : "Production runtime built with no installed games.",
);
