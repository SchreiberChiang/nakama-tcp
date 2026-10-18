extends SceneTree
const TIMELINE = preload("res://core/snapshot_timeline.gd")
var checks := 0
var failures := 0
func _initialize() -> void:
	_run.call_deferred()
func check(value: bool, label: String) -> void:
	checks += 1
	if not value: failures += 1
	print(("PASS " if value else "FAIL ") + label)
func state(tick: int, round_id: int = 1) -> Dictionary:
	return {"tick": tick, "round_id": round_id, "phase": "playing", "tick_rate": 30, "snapshot_rate": 20,
		"players": [{"user_id": "LOCAL_TEST", "position": {"x": float(tick), "y": 0.0}, "velocity": {"x": 30.0, "y": 0.0}}]}
func _run() -> void:
	var line = TIMELINE.new()
	check(line.sample(0).is_empty(), "empty has no invented pose")
	check(not line.configure(-1) and not line.configure(NAN) and not line.configure(1, INF), "invalid configuration rejected")
	check(line.configure(50, 10000), "valid bounded configuration")
	for tick in [0, 2, 3, 5, 6, 8, 9]: line.push_snapshot(state(tick), tick / 30.0 + 0.04, "room-a")
	var sampled: Dictionary = line.sample(0.29)
	check(absf(sampled.LOCAL_TEST.position.x - 6.0) < 0.001, "nonuniform snapshots interpolate server tick time")
	var held: Dictionary = line.sample(0.1)
	held.LOCAL_TEST.position = Vector2(999, 999)
	check(line.frames[0].poses.LOCAL_TEST.position != Vector2(999, 999), "returned held poses cannot mutate history")
	var stale := state(10)
	stale.phase = "lobby"
	check(not line.push_snapshot(stale, 0.35, "room-a"), "same round phase cannot go backwards")
	check(not line.push_snapshot(state(9), 0.35, "room-a") and not line.push_snapshot(state(8), 0.35, "room-a"), "duplicate and old ticks rejected")
	var previous := float(line.presented_time_seconds)
	var monotonic := true
	for frame in range(120):
		line.sample(0.30 + frame / 60.0)
		monotonic = monotonic and float(line.presented_time_seconds) >= previous
		previous = float(line.presented_time_seconds)
	check(monotonic and line.state == "underrun", "underrun remains monotonic")
	check(float(line.presented_time_seconds) <= 10.0 / 30.0 + 0.00001, "extrapolation capped to one tick")
	check(line.frames.size() <= 32 and line.arrival_offsets.size() <= 64, "bounded history")
	check(line.push_snapshot(state(100), 4.0, "room-a") and line.frames.size() == 1, "long gap rebuffered")
	line.sample(4.0)
	check(line.discontinuities >= 1, "long gap recorded as discontinuity")
	check(line.push_snapshot(state(101, 2), 4.1, "room-a") and line.frames.size() == 1, "round change clears history")
	check(not line.push_snapshot(state(102, 1), 4.2, "room-a"), "old round rejected")
	check(line.push_snapshot(state(0), 0.0, "room-b") and line.last_server_tick == 0, "room epoch switches clock and history")
	for tick in range(1, 200): line.push_snapshot(state(tick), tick / 30.0, "room-b")
	check(line.frames.size() == 32 and line.arrival_offsets.size() == 64, "long run storage bounded")
	var invalid := state(201)
	invalid.players[0].position.x = NAN
	check(line.push_snapshot(invalid, 7, "room-b") and line.frames[-1].poses.is_empty(), "invalid pose omitted")
	line.reset()
	check(line.sample(8).is_empty() and line.summary().render_tick == null, "release has no stale render data")
	line.configure(50)
	line.reset()
	var max_rate := 0.0
	var recovered := false
	var prior_receive := -1.0
	for tick in range(91):
		var at := maxf(prior_receive, tick / 30.0 + (0.12 if tick <= 30 else 0.04))
		prior_receive = at
		line.push_snapshot(state(tick), at, "recovery")
		line.sample(at)
		max_rate = maxf(max_rate, line.playback_rate)
		recovered = recovered or line.recovery_age_ms > 0
	check(recovered and max_rate <= 1.200001, "offset recovery is explicitly bounded")
	check(line.recovery_age_ms <= 750.001, "catchup never remains active indefinitely")
	# Deterministic application arrival injection, not a network emulator.
	line.reset()
	line.configure(80, 33)
	var arrivals: Array = []
	for tick in range(121):
		var receive := tick / 30.0 + (0.08 if tick % 2 else 0.0)
		if receive >= 1.0 and receive < 1.7: receive = 1.7
		arrivals.append({"tick": tick, "at": receive})
	arrivals.sort_custom(func(a, b): return a.at < b.at or (a.at == b.at and a.tick < b.tick))
	var cursor := 0
	var bounded := true
	var saw_gap := false
	for frame in range(51):
		var now := frame / 10.0
		while cursor < arrivals.size() and float(arrivals[cursor].at) <= now:
			line.push_snapshot(state(int(arrivals[cursor].tick)), float(arrivals[cursor].at), "arrival-injection")
			cursor += 1
		line.sample(now)
		bounded = bounded and line.frames.size() <= 32 and line.arrival_offsets.size() <= 64
		if line.presented_time_seconds != null:
			bounded = bounded and float(line.presented_time_seconds) <= float(line.last_server_tick) / 30.0 + 1.0 / 30.0 + 0.00001
		saw_gap = saw_gap or line.discontinuities > 0
	check(bounded, "injected jitter batch release and 100ms render callbacks retain bounds")
	check(saw_gap and line.recovery_age_ms <= 750.001, "700ms delivery pause records discontinuity and bounded recovery")
	check(float(line.presented_time_seconds) >= 3.9, "after injected pause playback follows fresh authority")
	var nonplaying := state(100)
	nonplaying.phase = "results"
	line.configure(0, 33)
	line.push_snapshot(nonplaying, 4.0, "stationary")
	line.sample(4.0)
	var after: Dictionary = line.sample(4.03)
	check(after.LOCAL_TEST.velocity == Vector2.ZERO and after.LOCAL_TEST.position.x == 100, "results cannot extrapolate stale velocity")
	var diag = preload("res://core/session_diagnostics.gd").new()
	diag.record("snapshot_received", 50, 1)
	check(diag.summary(2) == {"enabled": false}, "diagnostics default off")
	diag.set_enabled(true)
	for index in range(200): diag.record("snapshot_received", 50, index)
	var summary: Dictionary = diag.summary(300)
	check(summary.snapshot_received.window_samples == 120 and summary.snapshot_received.count == 200, "diagnostic samples bounded")
	check(summary.rtt_ms == null and summary.server_consume_delay_ms == null, "unobservable timing missing")
	diag.record("send_completed", 64, 301)
	diag.record("snapshot_consumed", 128, 301)
	check(diag.summary(302).send_completed.window_bytes == 64 and diag.summary(302).snapshot_consumed.window_bytes == 128, "completed send and logical snapshot consumption preserve measured payload bytes")
	var transport := get_root().get_node("Session")
	check(not transport._valid_catalog({"games": []}) and not transport._valid_catalog({"protocol_version": 0, "games": []}), "missing and old catalog version rejected")
	check(transport._valid_catalog({"protocol_version": 1, "games": []}), "current empty catalog is compatible")
	check(not ModuleRegistry.compatible({"id": "UNINSTALLED", "module_version": 1}), "uninstalled module is incompatible")
	var saved_modules: Dictionary = ModuleRegistry.modules.duplicate(true)
	ModuleRegistry.modules["VERSION_TEST"] = {"metadata": {"module_version": 2}}
	check(not ModuleRegistry.compatible({"id": "VERSION_TEST", "module_version": 1}) and not ModuleRegistry.compatible({"id": "VERSION_TEST"}), "mismatched and missing module version rejected")
	ModuleRegistry.modules = saved_modules
	diag.observe_input_ack({"accepted_input_seq": 7, "accepted_input_tick": 30, "username": "PRIVATE_NAME"})
	diag.observe_receipts([{"seq": 4, "tick": 32, "kind": "command", "secret": "PRIVATE_PAYLOAD"}])
	var safe := JSON.stringify(diag.summary(300))
	check(not safe.contains("PRIVATE") and diag.summary(300).exact_input_receipts.size() == 1, "diagnostics whitelist drops identity and payload")
	diag.observe_receipts([{"seq": 4.5, "tick": 32, "kind": "command"}])
	check(diag.summary(300).exact_input_receipts.is_empty(), "fractional receipt seq rejected without truncation")
	diag.observe_receipts([{"seq": 4, "tick": 32.5, "kind": "state"}])
	check(diag.summary(300).exact_input_receipts.is_empty(), "fractional receipt tick rejected without truncation")
	diag.observe_receipts(null)
	check(diag.summary(300).exact_input_receipts.is_empty(), "absent exact receipt window remains missing")
	diag.set_enabled(false)
	check(diag._samples.is_empty(), "disable clears observations")
	var view = preload("res://core/game_module.gd").new()
	var original := state(1)
	view.apply_snapshot(original)
	view.release()
	check(original.has("players") and original.players.size() == 1, "release leaves input snapshot intact")
	view.free()
	print("TIMELINE_CHECKS %d FAILURES %d" % [checks, failures])
	quit(1 if failures else 0)
