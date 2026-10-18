// Public test entry: bare Godot --script still loads Session's default profile.
import { checkedGodot } from "./test-profile.mjs";
const names = process.argv.slice(2);
const allowed = new Set(["lobby_state", "snapshot_timeline", "sdk_socket_lifecycle", "profile_smoke", "module_request_isolation"]);
if (!names.length || names.some(name => !allowed.has(name))) throw Error("Pass unit names: " + [...allowed].join(", "));
for (const name of names) console.log(await checkedGodot(["--headless", "--path", "client", "--script", `res://tests/${name}.gd`], {log: `.local/${name}.log`}));
