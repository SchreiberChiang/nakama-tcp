extends SceneTree
const TIMELINE = preload("res://core/snapshot_timeline.gd")
var checks := 0
var failures := 0
class DepartureAdapter extends NakamaSocketAdapter:
	var packets: Array = []
	func send(buffer: PackedByteArray, _reliable: bool = true) -> int:
		packets.append(JSON.parse_string(buffer.get_string_from_utf8()))
		return OK
	func close():
		closed.emit()
class ImmediateDepartureSocket extends NakamaSocket:
	func leave_match_async(_match_id: String) -> NakamaAsyncResult:
		return NakamaAsyncResult.new()
class ImmediateLobbyClient extends NakamaClient:
	func rpc_async(_session: NakamaSession, _id: String, _payload = null):
		var result := NakamaAPI.ApiRpc.new()
		result._payload = '{"rooms":[]}'
		return result
	func session_logout_async(_session: NakamaSession):
		return NakamaAsyncResult.new()
func _initialize() -> void:
	_run.call_deferred()
func check(value: bool, label: String) -> void:
	checks += 1
	if not value: failures += 1
	print(("PASS " if value else "FAIL ") + label)
func state(tick: int, round_id: int = 1) -> Dictionary:
	return {"tick": tick, "round_id": round_id, "phase": "playing", "tick_rate": 30, "snapshot_rate": 20,
		"players": [{"user_id": "LOCAL_TEST", "position": {"x": float(tick), "y": 0.0}, "velocity": {"x": 30.0, "y": 0.0}}]}

func test_offset_increase(hz: int, gap: bool) -> void:
	var line = TIMELINE.new()
	line.configure(150 if hz == 10 else 117)
	check(not line.configure_recovery(0) and line.configure_recovery(350), "reanchor threshold bounded %dHz" % hz)
	var arrivals: Array = []
	for tick in range(420):
		if (tick * hz) / 30 == ((tick - 1) * hz) / 30 and tick > 0: continue
		var source := tick / 30.0
		var at := source + 0.04 + (0.25 if source >= 2.0 else 0.0)
		if gap and source >= 2.0 and source < 2.7: continue
		var packet := state(tick)
		packet.snapshot_rate = hz
		arrivals.append({"at": at, "packet": packet})
	var cursor := 0
	var underrun_seconds := 0.0
	var stable_buffer := true
	var previous := -1.0
	var monotonic := true
	for frame in range(840):
		var now := frame / 60.0
		while cursor < arrivals.size() and float(arrivals[cursor].at) <= now:
			line.push_snapshot(arrivals[cursor].packet, arrivals[cursor].at, "offset-increase")
			cursor += 1
		line.sample(now)
		if line.state == "underrun" and now >= 2.0 and now < 12.0: underrun_seconds += 1.0 / 60.0
		if line.presented_time_seconds != null:
			monotonic = monotonic and float(line.presented_time_seconds) + 0.000001 >= previous
			previous = float(line.presented_time_seconds)
			# Source cadence consumes at most one snapshot gap of playable reserve.
			if now >= 4.2 and now < 12.0:
				var reserve := float(line.last_server_tick) / 30.0 - float(line.presented_time_seconds)
				stable_buffer = stable_buffer and reserve >= line.delay_seconds - ceil(30.0 / hz) / 30.0 - 0.018
	check(underrun_seconds < 1.5, "+250ms maintained 10s bounded underrun %dHz gap=%s seconds=%.3f" % [hz, gap, underrun_seconds])
	check(stable_buffer and line.clock_reanchors > 0, "playable reserve restored within 2.2s %dHz gap=%s" % [hz, gap])
	check(monotonic, "offset increase never rewinds shown source time %dHz gap=%s" % [hz, gap])
func test_extrapolated_reanchor(extrapolation_ms: float, motion: String, delay_ms: float = 150, recovery_ms: float = 100, arrival_frame: int = 18) -> void:
	var line = TIMELINE.new()
	line.configure(delay_ms, extrapolation_ms)
	line.configure_recovery(recovery_ms)
	var poses_before: Dictionary = {}
	var source_before := 0.0
	var saw_hold := false
	var stable_hold := true
	var detached := true
	for frame in range(90):
		var now := frame / 60.0
		if frame == 0 or frame == arrival_frame:
			var packet := state(0 if frame == 0 else 3)
			packet.players[0].position.y = -2.0 * float(packet.tick)
			packet.players[0].angle = 0.7
			packet.players[0].velocity.y = -60.0
			if motion == "stationary": packet.players[0].stationary = true
			if motion == "missing": packet.players[0].erase("velocity")
			line.push_snapshot(packet, now, "reanchor-hold")
		var poses: Dictionary = line.sample(now)
		if frame > arrival_frame and line.state == "buffering" and line.clock_reanchors > 0:
			saw_hold = true
			stable_hold = stable_hold and poses.LOCAL_TEST.position.is_equal_approx(poses_before.LOCAL_TEST.position) and is_equal_approx(poses.LOCAL_TEST.angle, 0.7) and is_equal_approx(float(line.presented_time_seconds), source_before)
			var expected: Dictionary = poses.duplicate(true)
			poses.LOCAL_TEST.position = Vector2(999, 999)
			poses.LOCAL_TEST.velocity = Vector2(999, 999)
			poses.LOCAL_TEST.angle = 999.0
			poses = line.sample(now)
			detached = detached and poses == expected and line.frames[-1].poses.LOCAL_TEST.position == Vector2(3, -6)
		if frame >= arrival_frame:
			# Compare only samples with unchanged authority, never a new packet's correction.
			poses_before = poses.duplicate(true)
			source_before = float(line.presented_time_seconds)
	var label := "extra=%s motion=%s delay=%s recovery=%s" % [extrapolation_ms, motion, delay_ms, recovery_ms]
	check(saw_hold and stable_hold, "reanchor preserves already presented pose and source " + label)
	check(detached, "mutating reanchor hold output cannot affect repeated hold or history " + label)
	var expected_end := Vector2(3, -6)
	if motion == "moving": expected_end += Vector2(30, -60) * extrapolation_ms / 1000.0
	check(poses_before.LOCAL_TEST.position.is_equal_approx(expected_end), "reanchor retains bounded authoritative velocity only " + label)

func test_authority_after_hold() -> void:
	var line = TIMELINE.new()
	line.configure(500, 33)
	line.configure_recovery(350)
	var held: Dictionary = {}
	var now := 0.0
	for frame in range(180):
		now = frame / 60.0
		if frame == 0: line.push_snapshot(state(0), now, "authority-after-hold")
		if frame == 30: line.push_snapshot(state(3), now, "authority-after-hold")
		held = line.sample(now)
		if frame > 30 and line.state == "buffering" and line._rebuffering: break
	check(line.state == "buffering" and line._rebuffering and line.clock_reanchors > 0 and held.has("LOCAL_TEST"), "authority-update scenario genuinely enters reanchor hold")
	var held_time := float(line.presented_time_seconds)
	var held_position: Vector2 = held.LOCAL_TEST.position
	var correction := state(4)
	correction.players[0].position = {"x": -40.0, "y": -20.0}
	correction.players[0].velocity = {"x": 0.0, "y": 0.0}
	now += 1.0 / 60.0
	check(line.push_snapshot(correction, now, "authority-after-hold") and line.last_server_tick == 4, "held timeline accepts fresh authoritative negative correction")
	var corrected: Dictionary = line.sample(now)
	check(corrected.LOCAL_TEST.position.x < held_position.x and corrected.LOCAL_TEST.position.y < held_position.y, "fresh authority may move pose backwards after hold without source-time rewind")
	check(float(line.presented_time_seconds) >= held_time and line.state == "buffering", "negative authority correction preserves held source time while still buffering")
	var forward := state(7)
	forward.players[0].position = {"x": -10.0, "y": -5.0}
	forward.players[0].velocity = {"x": 0.0, "y": 0.0}
	now += 1.0 / 60.0
	check(line.push_snapshot(forward, now, "authority-after-hold") and line.last_server_tick == 7, "authority continues advancing after held correction")
	var advanced: Dictionary = {}
	for frame in range(60):
		now += 1.0 / 60.0
		advanced = line.sample(now)
	check(advanced.LOCAL_TEST.position.is_equal_approx(Vector2(-10, -5)) and float(line.presented_time_seconds) > held_time, "held timeline resumes following subsequent authoritative pose")
	var removed := state(8)
	removed.players.clear()
	now += 1.0 / 60.0
	check(line.push_snapshot(removed, now, "authority-after-hold") and line.last_server_tick == 8, "post-hold authority accepts player removal")
	for frame in range(60):
		now += 1.0 / 60.0
		advanced = line.sample(now)
	check(not advanced.has("LOCAL_TEST") and line.frames[-1].poses.is_empty(), "removed player cannot survive in post-hold presentation")
	# Separate boundary: removal reaches the already displayed source time,
	# rather than demanding a future membership change be shown early.
	line.reset()
	for frame in range(180):
		now = frame / 60.0
		if frame == 0: line.push_snapshot(state(0), now, "removal-during-hold")
		if frame == 30: line.push_snapshot(state(3), now, "removal-during-hold")
		line.sample(now)
		if frame > 30 and line.state == "buffering" and line._rebuffering: break
	check(line.state == "buffering" and line._rebuffering and line.clock_reanchors > 0, "removal scenario genuinely enters reanchor hold")
	var held_removal := state(4)
	held_removal.players.clear()
	now += 1.0 / 60.0
	check(line.push_snapshot(held_removal, now, "removal-during-hold") and line.last_server_tick == 4, "fresh authority removes player during actual hold")
	var without_player: Dictionary = line.sample(now)
	check(line.state == "buffering" and without_player.is_empty(), "held presentation does not retain authoritatively removed player")

func _run() -> void:
	test_authority_after_hold()
	for extra in [0.0, 33.0]:
		for motion in ["moving", "stationary", "missing"]:
			test_extrapolated_reanchor(extra, motion)
	# Default recovery threshold, with an explicitly configured larger delay.
	test_extrapolated_reanchor(33, "moving", 500, 350, 30)
	var joining = TIMELINE.new()
	joining.configure(0)
	var before_join := state(0)
	before_join.players.clear()
	joining.push_snapshot(before_join, 0.0, "joining")
	joining.push_snapshot(state(3), 0.1, "joining")
	var joined_pose: Dictionary = joining.sample(0.05)
	joined_pose.LOCAL_TEST.position = Vector2(999, 999)
	joined_pose.LOCAL_TEST.velocity = Vector2(999, 999)
	joined_pose.LOCAL_TEST.angle = 999.0
	check(joining.frames[-1].poses.LOCAL_TEST.position == Vector2(3, 0) and joining.frames[-1].poses.LOCAL_TEST.velocity == Vector2(30, 0) and joining.frames[-1].poses.LOCAL_TEST.angle == 0.0, "newly joined interpolated pose cannot mutate history")
	check(joining.sample(0.05).LOCAL_TEST.position == Vector2(3, 0), "newly joined pose mutation cannot affect later samples")
	for hz in [10, 20]:
		test_offset_increase(hz, false)
		test_offset_increase(hz, true)
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
	check(not transport._valid_catalog({"protocol_version": 1, "games": []}), "v1 catalog rejected after command outcome protocol change")
	check(not transport._valid_catalog({"protocol_version": 2, "games": []}), "v2 catalog rejected after request isolation protocol change")
	check(transport._valid_catalog({"protocol_version": transport.PROTOCOL_VERSION, "games": []}), "current empty catalog is compatible")
	check(transport.diagnostic_summary() == {"enabled": false}, "real Session diagnostics default off")
	var initial_scope: String = transport.presentation_scope()
	transport.leave_room()
	var left_scope: String = transport.presentation_scope()
	transport.logout()
	check(initial_scope != left_scope and left_scope != transport.presentation_scope(), "real Session leave epoch and logout generation change presentation scope")
	var scope_line = TIMELINE.new()
	scope_line.push_snapshot(state(300), 10.0, initial_scope)
	check(scope_line.push_snapshot(state(0), 0.0, left_scope) and scope_line.frames.size() == 1, "Session epoch scope clears prior clock and history")
	check(scope_line.push_snapshot(state(0), 0.0, transport.presentation_scope()) and scope_line.frames.size() == 1, "Session generation scope clears prior clock and history")
	transport.snapshot_received_msec = 1000
	check(transport.state_input_fresh(1350) and not transport.state_input_fresh(1351), "state pauses past configurable local snapshot age")
	check(not transport.configure_state_freshness(0) and transport.configure_state_freshness(500) and transport.state_input_fresh(1450), "state freshness threshold validated")
	transport.configure_state_freshness(350)
	transport.snapshot = {"phase": "playing"}
	transport._seq = 0
	transport.snapshot_received_msec = -1
	transport.submit_input({"direction": {"x": 1, "y": 0}}, "state")
	check(transport._seq == 0, "stale state not submitted or sequenced")
	transport._input_elapsed = 0.0
	transport._process(0.040)
	check(absf(transport._input_elapsed - (0.040 - 1.0 / 30.0)) < 0.00001, "state cadence preserves remainder")
	transport._process(3.0)
	check(transport._input_elapsed < 1.0 / 30.0, "long frame discards missed send periods")
	transport._observe_command_results([{"seq": 5, "round_id": 1, "tick": 30, "status": "expired", "secret": "PRIVATE_PAYLOAD"}])
	check(transport.command_results()[0].status == "expired" and transport.command_results()[0].size() == 4, "command outcomes available while diagnostics disabled")
	transport._on_room_action_error({"error": "Projection failure"})
	check(transport.snapshot.is_empty() and not transport.input_provider.is_valid() and transport.command_results().is_empty(), "fixed projection error exits playing and clears inputs and command outcomes")
	check(not ModuleRegistry.compatible({"id": "UNINSTALLED", "module_version": 1}), "uninstalled module is incompatible")
	var saved_modules: Dictionary = ModuleRegistry.modules.duplicate(true)
	ModuleRegistry.modules["VERSION_TEST"] = {"metadata": {"module_version": 2}}
	check(not ModuleRegistry.compatible({"id": "VERSION_TEST", "module_version": 1}) and not ModuleRegistry.compatible({"id": "VERSION_TEST"}), "mismatched and missing module version rejected")
	var packet := state(1)
	packet.merge({"game_id": "VERSION_TEST", "module_version": 2, "protocol_version": transport.PROTOCOL_VERSION, "room_phase_version": 2})
	packet.players[0].user_id = ""
	packet.players[0].command_results = [{"seq": 1, "round_id": 1, "tick": 1, "status": "applied"}]
	var message := NakamaRTAPI.MatchData.new()
	message.match_id = "REENTRANT_TEST"
	message.op_code = 10
	message.data = JSON.stringify(packet)
	transport.match_id = message.match_id
	var exit_on_result := func(_outcomes): transport.logout()
	transport.command_results_updated.connect(exit_on_result)
	transport._on_match_state(message)
	check(transport.match_id.is_empty() and transport.snapshot.is_empty() and transport.command_results().is_empty(), "command result callback logout cannot restore old room state")
	transport.command_results_updated.disconnect(exit_on_result)
	transport.match_id = message.match_id
	var exit_on_snapshot := func(_snapshot): transport.leave_room()
	transport.snapshot_received.connect(exit_on_snapshot)
	transport._on_match_state(message)
	check(transport.match_id.is_empty() and transport.snapshot.is_empty() and transport.command_results().is_empty(), "snapshot callback leave prevents later old-room command emission")
	transport.snapshot_received.disconnect(exit_on_snapshot)
	var adapter := DepartureAdapter.new()
	root.add_child(adapter)
	var departure_socket := NakamaSocket.new(adapter, "127.0.0.1", 7350, "ws", false)
	transport.socket = departure_socket
	transport.connected = true
	transport.match_id = "REENTRANT_TEST"
	var rejoin_on_left := func(): transport.join_room("REENTRANT_TEST", "VERSION_TEST")
	transport.left.connect(rejoin_on_left)
	transport.leave_room()
	check(adapter.packets.size() == 2 and adapter.packets[0].has("match_leave") and adapter.packets[1].has("match_join"), "old leave is dispatched before synchronous left listener rejoins same room")
	check(transport._joining_id == "REENTRANT_TEST", "UI left listener can begin new join without awaiting old leave")
	transport.left.disconnect(rejoin_on_left)
	adapter.received.emit(JSON.stringify({"cid": adapter.packets[0].cid}).to_utf8_buffer())
	await process_frame
	await process_frame
	check(transport._joining_id == "REENTRANT_TEST" and transport.socket == departure_socket, "old departure completion cannot clear pending new join")
	transport.logout()
	adapter.queue_free()
	await process_frame
	var immediate_adapter := DepartureAdapter.new()
	root.add_child(immediate_adapter)
	var immediate_socket := ImmediateDepartureSocket.new(immediate_adapter, "127.0.0.1", 7350, "ws", false)
	var immediate_http := NakamaHTTPAdapter.new()
	immediate_http.logger = NakamaLogger.new()
	root.add_child(immediate_http)
	transport.client = ImmediateLobbyClient.new(immediate_http, "", "http", "127.0.0.1", 7350, 8)
	transport.session = NakamaSession.new()
	transport.session._valid = true
	transport.socket = immediate_socket
	transport.connected = true
	transport.match_id = "IMMEDIATE_TEST"
	var order: Array = []
	var observe_left := func(): order.append("left")
	var observe_rooms := func(_rooms): order.append("rooms")
	transport.left.connect(observe_left)
	transport.rooms_updated.connect(observe_rooms)
	transport.leave_room()
	check(order == ["left"], "synchronous leave completion still emits left before lobby refresh")
	await process_frame
	await process_frame
	check(order == ["left", "rooms"], "synchronous departure refresh runs after immediate UI release")
	transport.left.disconnect(observe_left)
	transport.rooms_updated.disconnect(observe_rooms)
	transport.logout()
	immediate_adapter.queue_free()
	immediate_http.queue_free()
	await process_frame
	ModuleRegistry.modules = saved_modules
	diag.observe_input_ack({"accepted_input_seq": 7, "accepted_input_tick": 30, "username": "PRIVATE_NAME"})
	diag.observe_receipts([{"seq": 4, "tick": 32, "kind": "command", "secret": "PRIVATE_PAYLOAD"}])
	diag.observe_command_results([{"seq": 5, "round_id": 1, "tick": 33, "status": "rejected_rate", "secret": "PRIVATE_PAYLOAD"}, {"seq": 5.5, "round_id": 1, "tick": 33, "status": "applied"}])
	check(diag.summary(300).command_results == [{"seq": 5, "round_id": 1, "tick": 33, "status_code": 9}], "command diagnostics numeric whitelist excludes malformed and extra fields")
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
