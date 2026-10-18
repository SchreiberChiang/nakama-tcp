extends SceneTree
## Cross-platform acceptance client unit tests. No backend, sockets, ports or uploads.
## Simulated pointer events and lifecycle notifications are not WeChat device evidence.
const TEST_SESSION := "res://tests/cross_platform/test_session.gd"
const VIEW := preload("res://tests/cross_platform/cross_platform_view.gd")
const PAD := preload("res://tests/cross_platform/direction_pad.gd")
const LIFECYCLE := preload("res://tests/cross_platform/lifecycle.gd")
const BRIDGE := preload("res://tests/cross_platform/js_lifecycle_bridge.gd")
const PANEL := preload("res://tests/cross_platform/diagnostics_panel.gd")
const GUIDE := preload("res://tests/cross_platform/acceptance_guide.gd")
const SETTINGS := ["enabled", "host", "port", "tls", "allow_insecure_lan", "diagnostics"]
var checks := 0
var failures := 0

class FakeBridgeInterface:
	var subscribed: Array = []
	var unsubscribed: Array = []
	var hidden_now: Variant = false
	var next_handle := 7
	func subscribeLifecycle(callback: Variant) -> Variant:
		subscribed.append(callback)
		return float(next_handle)
	func unsubscribeLifecycle(handle: Variant) -> void:
		unsubscribed.append(handle)
	func isHidden() -> Variant:
		return hidden_now

class FakeCallback:
	var target: Callable
	func _init(callable: Callable) -> void:
		target = callable
	func fire(state: Variant) -> void:
		target.call([state])

func _initialize() -> void:
	_run.call_deferred()

func check(value: bool, label: String) -> void:
	checks += 1
	if not value:
		failures += 1
	print(("PASS " if value else "FAIL ") + label)

func spy_session() -> Node:
	var source := GDScript.new()
	source.source_code = "extends \"%s\"\nvar logouts := 0\nvar logins := 0\nvar submitted: Array = []\nvar scope := \"\"\nfunc logout() -> void:\n\tlogouts += 1\n\tsuper.logout()\nfunc login(a: String, b: String = \"\", c: String = \"\", d: bool = false) -> void:\n\tlogins += 1\nfunc submit_input(data: Dictionary, kind: String = \"command\") -> void:\n\tsubmitted.append(kind)\nfunc presentation_scope() -> String:\n\treturn scope\n" % TEST_SESSION
	source.reload()
	return source.new()

func touch(index: int, at: Vector2, pressed: bool, canceled: bool = false) -> InputEventScreenTouch:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.position = at
	event.pressed = pressed
	event.canceled = canceled
	return event

func drag(index: int, at: Vector2) -> InputEventScreenDrag:
	var event := InputEventScreenDrag.new()
	event.index = index
	event.position = at
	return event

func mouse(at: Vector2, pressed: bool, emulated: bool = false) -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.position = at
	event.pressed = pressed
	event.device = InputEvent.DEVICE_ID_EMULATION if emulated else 0
	return event

func _run() -> void:
	await process_frame
	await _test_pad()
	await _test_view_scope()
	await _test_lifecycle()
	_test_bridge_adapter()
	_test_connection_whitelist()
	_test_diagnostics()
	_test_guide_states()
	await _test_guide_wiring()
	await _test_guide_initial_background()
	await _test_entry()
	await _test_guide_layout()
	print("CROSS_PLATFORM_CHECKS %d FAILURES %d" % [checks, failures])
	quit(1 if failures else 0)

func _test_pad() -> void:
	var pad: Control = PAD.new()
	pad.position = Vector2(100, 100)
	pad.size = Vector2(180, 180)
	root.add_child(pad)
	await process_frame
	pad.size = Vector2(180, 180)
	var right := Vector2(100 + 150, 100 + 90)
	var up := Vector2(100 + 90, 100 + 30)
	var outside := Vector2(20, 20)
	check(pad.handle_pointer_event(touch(0, right, true)) and pad.direction() == Vector2.RIGHT, "touch press on right sends right")
	check(pad.handle_pointer_event(drag(0, up)) and pad.direction() == Vector2.UP, "drag between regions changes direction")
	check(pad.handle_pointer_event(drag(0, outside)) and pad.direction() == Vector2.ZERO, "sliding out releases direction")
	check(not pad.handle_pointer_event(drag(0, up)) and pad.direction() == Vector2.ZERO, "returning after slide-out needs a new press")
	pad.handle_pointer_event(touch(1, up, true))
	check(pad.handle_pointer_event(touch(1, up, false, true)) and pad.direction() == Vector2.ZERO, "canceled touch releases direction")
	pad.handle_pointer_event(touch(2, right, true))
	check(pad.handle_pointer_event(touch(2, outside, false)) and pad.direction() == Vector2.ZERO, "release anywhere ends the press")
	pad.handle_pointer_event(touch(3, right, true))
	pad.handle_pointer_event(touch(4, up, true))
	check(is_equal_approx(pad.direction().length(), 1.0) and pad.direction().x > 0 and pad.direction().y < 0, "two fingers combine and stay unit length")
	pad.handle_pointer_event(touch(3, right, false))
	pad.handle_pointer_event(touch(4, up, false))
	check(not pad.handle_pointer_event(mouse(right, true, true)) and pad.direction() == Vector2.ZERO, "touch-emulated mouse is ignored")
	check(pad.handle_pointer_event(mouse(right, true)) and pad.direction() == Vector2.RIGHT, "real mouse press drives pad")
	check(pad.handle_pointer_event(mouse(outside, false)) and pad.direction() == Vector2.ZERO, "real mouse release outside ends press")
	pad.handle_pointer_event(touch(5, right, true))
	pad.notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	check(pad.direction() == Vector2.ZERO, "focus loss clears held pad without other effects")
	pad.handle_pointer_event(touch(6, right, true))
	pad.hide()
	check(pad.direction() == Vector2.ZERO and not pad.handle_pointer_event(touch(7, right, true)), "hidden pad clears and ignores input")
	pad.queue_free()
	await process_frame

func _test_view_scope() -> void:
	var spy := spy_session()
	spy.scope = "1:1:room-a"
	var view: Control = VIEW.new()
	view.transport = spy
	view.configure("local-id")
	view.set_presentation_scope("1:1:room-a")
	root.add_child(view)
	await process_frame
	check(view.click_pulse() and spy.submitted == ["command"], "current view pulse goes through Session as command")
	var state: Dictionary = view.collect_input()
	check(state.has("direction") and state.direction.x == 0.0 and state.direction.y == 0.0, "idle continuous state sends zero direction")
	view.pad.size = Vector2(180, 180)
	view.pad.handle_pointer_event(touch(0, view.pad.get_global_rect().position + Vector2(150, 90), true))
	check(view.collect_input().direction.x == 1.0, "touch direction becomes state.direction")
	spy.scope = "1:2:room-b"
	check(not view.click_pulse() and view.collect_input().is_empty(), "old view refuses pulse and state after room scope changes")
	view.pulse_button.pressed.emit()
	check(spy.submitted.size() == 1 and view.stale_input_rejections >= 3, "old view Pulse button callback cannot send")
	var retained: Callable = view.click_pulse
	view.release()
	spy.scope = "1:1:room-a"
	check(not retained.call() and view.collect_input().is_empty() and view.pad.direction() == Vector2.ZERO, "released view refuses retained callbacks and clears touch")
	var next_view: Control = VIEW.new()
	next_view.transport = spy
	next_view.set_presentation_scope("1:1:room-a")
	root.add_child(next_view)
	await process_frame
	check(next_view.click_pulse() and spy.submitted.size() == 2, "new view in current scope sends normally")
	view.queue_free()
	next_view.queue_free()
	spy.free()
	await process_frame

func _test_lifecycle() -> void:
	var spy := spy_session()
	spy.scope = "1:1:room-a"
	var view: Control = VIEW.new()
	view.transport = spy
	view.set_presentation_scope("1:1:room-a")
	root.add_child(view)
	await process_frame
	view.pad.size = Vector2(180, 180)
	view.pad.handle_pointer_event(touch(0, view.pad.get_global_rect().position + Vector2(150, 90), true))
	spy.input_provider = view.collect_input
	var fake := FakeBridgeInterface.new()
	var callbacks: Array = []
	var bridge = BRIDGE.new(fake, func(target: Callable):
		var callback := FakeCallback.new(target)
		callbacks.append(callback)
		return callback)
	var lifecycle: Node = LIFECYCLE.new()
	root.add_child(lifecycle)
	lifecycle.setup(spy, bridge, func(): return view)
	check(lifecycle.has_bridge() and fake.subscribed.size() == 1 and bridge.subscription_handle() == 7 and bridge.has_subscription(), "bridge subscribes once and retains callback with numeric handle")
	callbacks[0].fire("hide")
	check(spy.logouts == 1 and not spy.input_provider.is_valid() and view.pad.direction() == Vector2.ZERO and lifecycle.hidden, "hide clears local input immediately and logs out")
	callbacks[0].fire("hide")
	lifecycle.notification(Node.NOTIFICATION_APPLICATION_PAUSED)
	check(spy.logouts == 1 and lifecycle.duplicate_background_signals == 2, "repeated hide and pause are idempotent")
	callbacks[0].fire("show")
	check(not lifecycle.hidden and spy.logins == 0 and not spy.connected and spy.session == null, "show stays logged out and never reconnects")
	callbacks[0].fire("show")
	lifecycle.notification(Node.NOTIFICATION_APPLICATION_RESUMED)
	check(lifecycle.foreground_returns == 1 and spy.logins == 0, "repeated show and resume are idempotent")
	callbacks[0].fire("unexpected")
	callbacks[0].fire(5)
	check(spy.logouts == 1 and not lifecycle.hidden, "unknown bridge payloads are ignored")
	lifecycle.notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	check(spy.logouts == 1 and not lifecycle.hidden, "native window focus loss is not background")
	lifecycle.enter_background("simulated")
	check(spy.logouts == 2 and lifecycle.background_entries == 2, "simulated background button path logs out once more")
	lifecycle.return_foreground("simulated")
	lifecycle.queue_free()
	await process_frame
	check(fake.unsubscribed == [7] and not bridge.has_subscription(), "leaving the tree unsubscribes the exact handle and drops the callback")
	callbacks[0].fire("hide")
	check(spy.logouts == 2, "late bridge callback after release has no effect")
	var hidden_fake := FakeBridgeInterface.new()
	hidden_fake.hidden_now = true
	var hidden_bridge = BRIDGE.new(hidden_fake, func(target: Callable): return FakeCallback.new(target))
	var hidden_lifecycle: Node = LIFECYCLE.new()
	root.add_child(hidden_lifecycle)
	hidden_lifecycle.setup(spy, hidden_bridge, Callable())
	check(hidden_lifecycle.hidden and spy.logouts == 3, "starting while bridge reports hidden enters background once")
	hidden_lifecycle.queue_free()
	var native: Node = LIFECYCLE.new()
	root.add_child(native)
	native.setup(spy, null, Callable())
	check(not native.has_bridge() and not native.hidden, "native client runs without the bridge")
	native.queue_free()
	view.queue_free()
	await process_frame
	spy.free()

func _test_bridge_adapter() -> void:
	var fake := FakeBridgeInterface.new()
	var created: Array = []
	var bridge = BRIDGE.new(fake, func(target: Callable):
		var callback := FakeCallback.new(target)
		created.append(callback)
		return callback)
	var states: Array = []
	check(bridge.subscribe(func(state): states.append(state)) and not bridge.subscribe(func(state): states.append(state)), "adapter subscribes at most once")
	created[0].target.call("not-an-array")
	created[0].target.call([])
	created[0].fire("show")
	check(states == ["show"], "adapter forwards only hide/show strings from argument arrays")
	bridge.release()
	bridge.release()
	check(fake.unsubscribed == [7] and not bridge.has_subscription(), "adapter release is idempotent")
	created[0].fire("hide")
	check(states == ["show"], "released adapter ignores late callbacks")
	var failures_rejected := true
	var failures_released := true
	for failed_handle in [0, -1]:
		var failed := FakeBridgeInterface.new()
		failed.next_handle = failed_handle
		var failed_bridge = BRIDGE.new(failed, func(target: Callable): return FakeCallback.new(target))
		failures_rejected = failures_rejected and not failed_bridge.subscribe(func(state): states.append(state)) and not failed_bridge.has_subscription() and failed_bridge.subscription_handle() == -1
		failures_released = failures_released and failed_bridge._callback == null and failed_bridge._interface == null and not failed_bridge._handler.is_valid() and not failed_bridge._create_callback.is_valid()
		failed.subscribed[0].fire("hide")
		failed_bridge.release()
		failures_released = failures_released and failed.unsubscribed.is_empty() and states == ["show"]
	check(failures_rejected, "zero and negative subscription handles are failures")
	check(failures_released, "failed subscriptions clear references and ignore callbacks without unsubscribing")

func _apply(values: Dictionary) -> Node:
	for key in SETTINGS:
		ProjectSettings.set_setting("cross_platform/" + key, values.get(key))
	var session: Node = load(TEST_SESSION).new()
	session.host = "127.0.0.1"
	session.port = 7350
	session.tls = false
	session.apply_cross_platform_settings()
	return session

func _test_connection_whitelist() -> void:
	var static_session = load(TEST_SESSION)
	for address in ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10"]:
		check(static_session.is_private_lan_ipv4(address), "RFC1918 accepted: " + address)
	for address in ["172.32.0.1", "172.15.0.1", "8.8.8.8", "100.64.0.1", "169.254.1.1", "192.169.0.1", "192.168.1", "10.0.0.256", "010.0.0.1", "10.0.0.1.", "10.0.0.1:7350", " 10.0.0.1", "lan.local", "+10.0.0.1", "10.0.0.-1", ""]:
		check(not static_session.is_private_lan_ipv4(address), "non-private or malformed rejected: [" + address + "]")
	var lan := _apply({"enabled": true, "host": "192.168.1.20", "port": 7350, "tls": false, "allow_insecure_lan": true, "diagnostics": false})
	check(lan._valid_connection() and lan.host == "192.168.1.20" and not lan.cross_platform_config_rejected, "explicit LAN test package admits private HTTP")
	lan.host = "203.0.113.5"
	check(not lan._valid_connection(), "explicit LAN flag still rejects public plaintext")
	lan.tls = true
	check(lan._valid_connection(), "public host with TLS keeps original rule")
	lan.free()
	var strict := _apply({"enabled": true, "host": "192.168.1.20", "port": 7350, "tls": false, "allow_insecure_lan": false, "diagnostics": false})
	check(not strict._valid_connection(), "LAN plaintext rejected unless flag is set")
	strict.free()
	var disabled := _apply({"enabled": false, "host": "192.168.1.20", "port": 7350, "tls": false, "allow_insecure_lan": true, "diagnostics": true})
	disabled.host = "192.168.1.20"
	check(not disabled._valid_connection() and not disabled.cross_platform_enabled and not disabled.allow_insecure_lan, "disabled package ignores LAN flag")
	disabled.free()
	var loopback := _apply({"enabled": true, "host": "127.0.0.1", "port": 7350, "tls": false, "allow_insecure_lan": false, "diagnostics": true})
	check(loopback._valid_connection() and loopback.diagnostics.enabled, "loopback and diagnostics settings apply")
	loopback.free()
	var invalid := _apply({"enabled": true, "host": "", "port": "7350", "tls": "yes", "allow_insecure_lan": 1, "diagnostics": false})
	check(invalid.cross_platform_config_rejected and invalid.port == 7350 and invalid.host == "127.0.0.1" and not invalid.tls and not invalid.allow_insecure_lan, "mistyped settings are rejected without being applied")
	invalid.free()
	for key in SETTINGS:
		ProjectSettings.set_setting("cross_platform/" + key, null)

func _test_diagnostics() -> void:
	var snapshot := {"phase": "playing", "round_id": 2, "tick": 345, "token": "PRIVATE_TOKEN", "chat": "PRIVATE_CHAT",
		"diagnostics": {"received": 10, "accepted": 9, "session_id": "PRIVATE_SESSION"},
		"players": [{"user_id": "PRIVATE_UID", "username": "PRIVATE_NAME", "private_note": "PRIVATE_NOTE", "score": 3,
			"position": {"x": 12.5, "y": -4.0}, "velocity": {"x": 60, "y": 0}, "accepted_input_seq": 41, "applied_input_seq": 40},
			{"user_id": "PRIVATE_OTHER", "username": "PRIVATE_OTHER_NAME", "score": 99}]}
	var summary := {"enabled": true, "send_attempt": {"count": 5, "window_bytes": 120, "window_interval_mean_ms": 33.3, "window_interval_max_ms": INF, "last_age_ms": 12}, "send_completed": {"window_bytes": 456}, "snapshot_received": {"count": NAN, "window_bytes": 321}}
	var presentation := {"enabled": true, "snapshot_receive_age_ms": 20, "frame_callback_interval_ms": 16.6, "sample_cpu_usec": 23, "gpu_ms": null,
		"timeline": {"presentation_state": "PRIVATE_STATE", "buffer_samples": 4, "buffer_depth_ms": 66.0}}
	var commands := [{"seq": 7, "round_id": 2, "tick": 300, "status": "applied"}, {"seq": 8, "round_id": 2, "tick": 301, "status": "PRIVATE_STATUS"}, "PRIVATE_RAW"]
	var text := "\n".join(PANEL.rows(snapshot, "PRIVATE_UID", summary, presentation, commands))
	check(not text.contains("PRIVATE"), "panel output excludes ids, names, private fields, chat, tokens and raw strings")
	check(text.contains("阶段 playing") and text.contains("轮次 2") and text.contains("tick 345") and text.contains("(12.5, -4.0)") and text.contains("分数 3"), "panel shows own numeric state only")
	check(text.contains("非累计确认") and text.contains("RTT 缺测") and text.contains("GPU 缺测"), "panel labels high-water acks and missing measurements")
	check(text.contains("命令 seq 7 · 第 2 轮 · applied") and not text.contains("seq 8"), "panel lists exact whitelisted command outcomes only")
	check(text.contains("最大 缺测 ms") and text.contains("received 10") and not text.contains("99") and text.contains("send_attempt 计数 5 · 窗口字节 120") and text.contains("send_completed 计数 缺测 · 窗口字节 456") and text.contains("snapshot_received 计数 缺测 · 窗口字节 321") and text.contains("snapshot_consumed 计数 缺测 · 窗口字节 缺测"), "panel shows actual send/receive byte windows, missing unavailable values and no other player data")
	var off := "\n".join(PANEL.rows({}, "", {"enabled": false}, {"enabled": false}, []))
	check(off.contains("诊断未启用") and off.contains("未知不等于失败"), "empty and disabled diagnostics stay explicit")

func _test_entry() -> void:
	var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
	root.add_child(entry)
	await process_frame
	await process_frame
	var session := root.get_node("Session")
	check(ModuleRegistry.modules.has("fixture") and ModuleRegistry.version("fixture") == 1 and not entry.registration_conflict, "entry registers fixture module_version 1 for this process")
	var marker := entry.find_child("IsolatedTestLabel", true, false) as Label
	check(entry.main != null and entry.main.page == "login" and entry.find_child("PlayerName", true, false) != null and marker != null and marker.text == "隔离测试" and marker.is_visible_in_tree() and marker.get_global_rect().end.y <= entry.main.global_position.y, "entry runs original Main with a visible isolated-test marker above its controls")
	check(not entry.lifecycle.has_bridge(), "native entry runs without the WeChat bridge")
	var bundled_font := load("res://assets/fonts/TemplateCJK.otf") as Font
	check(entry.find_child("SimulateBackground", true, false).get_theme_font("font") == bundled_font and entry.diagnostics_panel.label.get_theme_font("font") == bundled_font, "acceptance overlays use bundled CJK across CanvasLayer")
	var created: Variant = ModuleRegistry.create("fixture")
	check(created != null and created.get_script() == VIEW, "registered factory creates the cross-platform view")
	if created != null:
		created.free()
	var logged_out := [0]
	session.logged_out.connect(func(): logged_out[0] += 1)
	(entry.find_child("SimulateBackground", true, false) as Button).pressed.emit()
	(entry.find_child("SimulateBackground", true, false) as Button).pressed.emit()
	check(logged_out[0] == 1 and entry.lifecycle.hidden and not session.busy and not session.connected, "simulated background logs out once and stays offline")
	(entry.find_child("SimulateForeground", true, false) as Button).pressed.emit()
	await process_frame
	check(not entry.lifecycle.hidden and entry.main.page == "login" and not session.busy, "foreground returns to login page without reconnecting")
	entry.queue_free()
	await process_frame
	check(not ModuleRegistry.modules.has("fixture"), "entry removes its process-local fixture registration on exit")

## Spy Session for guide wiring: real signals and logout/_on_closed, injectable user id.
func guide_spy_session() -> Node:
	var source := GDScript.new()
	source.source_code = "extends \"%s\"\nvar uid := \"\"\nvar logins := 0\nfunc user_id() -> String:\n\treturn uid\nfunc login(a: String, b: String = \"\", c: String = \"\", d: bool = false) -> void:\n\tlogins += 1\n" % TEST_SESSION
	source.reload()
	return source.new()

func _test_guide_states() -> void:
	var cases := [
		[{}, "login"],
		[{"busy": true}, "connecting"],
		[{"logout_reason": "background"}, "after_background"],
		[{"logout_reason": "disconnect"}, "after_disconnect"],
		[{"background": true, "connected": true, "in_room": true, "phase": "playing", "round": 2}, "background"],
		[{"connected": true}, "lobby"],
		[{"connected": true, "busy": true}, "entering"],
		[{"connected": true, "room_failed": true}, "room_failed"],
		[{"connected": true, "in_room": true, "phase": "lobby", "round": 1}, "ready_needed"],
		[{"connected": true, "in_room": true, "phase": "lobby", "round": 1, "self_ready": true}, "waiting_peer"],
		[{"connected": true, "in_room": true, "phase": "lobby", "round": 1, "self_ready": true, "all_ready": true, "is_host": true}, "host_start"],
		[{"connected": true, "in_room": true, "phase": "lobby", "round": 1, "self_ready": true, "all_ready": true}, "waiting_host"],
		[{"connected": true, "in_room": true, "phase": "countdown", "round": 1}, "countdown"],
		[{"connected": true, "in_room": true, "phase": "playing", "round": 1}, "playing"],
		[{"connected": true, "in_room": true, "phase": "results", "round": 1}, "results"],
	]
	var mismatches: Array = []
	for item in cases:
		if GUIDE.describe(item[0]) != item[1]:
			mismatches.append(item[1])
	check(mismatches.is_empty(), "guide stage keys follow connection, room, busy and authoritative phase")
	var stale := [
		GUIDE.describe({"connected": true, "in_room": false, "phase": "playing", "round": 3}),
		GUIDE.describe({"connected": false, "in_room": true, "phase": "results", "round": 3}),
		GUIDE.describe({"connected": true, "in_room": true}),
		GUIDE.describe({"connected": true, "in_room": true, "phase": "PRIVATE_PHASE", "round": 3}),
		GUIDE.describe({"connected": true, "in_room": true, "phase": "results", "round": 0}),
	]
	check(stale == ["lobby", "login", "syncing", "syncing", "syncing"] and not GUIDE.text_for("syncing", 3).contains("第") and not GUIDE.text_for("lobby", 3).contains("第"), "without a valid current snapshot the guide never reuses an old room or round")
	check(GUIDE.describe({"logout_reason": "disconnect", "phase": "results", "round": 2}) == "after_disconnect" and GUIDE.text_for("after_disconnect", 0).contains("不是正常结算") and GUIDE.text_for("room_failed", 0).contains("不是正常结算") and GUIDE.text_for("results", 2).contains("不是掉线"), "abnormal disconnect and room failure are never labeled as normal results")
	var login := GUIDE.text_for("login", 0)
	var playing := GUIDE.text_for("playing", 2)
	var results := GUIDE.text_for("results", 2)
	var returned := GUIDE.text_for("after_background", 0)
	check(login.contains("设备游客") and login.contains("无需账号密码") and login.contains("连接信息已预置") and playing.contains("第2局") and playing.contains("约12秒") and playing.contains("服务端结算") and results.contains("房主开启下一局") and results.contains("重新准备") and returned.contains("重新登录") and returned.contains("不会恢复"), "guide carries the required login, round length, results and background wording")

func _test_guide_wiring() -> void:
	var spy := guide_spy_session()
	spy.uid = "PRIVATE_SELF"
	var lifecycle: Node = LIFECYCLE.new()
	root.add_child(lifecycle)
	lifecycle.setup(spy, null, Callable())
	var signals := [spy.authenticated, spy.logged_out, spy.joined, spy.left, spy.snapshot_received, spy.connection_changed, spy.room_failed, lifecycle.background_entered, lifecycle.foreground_returned]
	var before: Array = signals.map(func(s): return s.get_connections().size())
	var guide: Label = GUIDE.new()
	root.add_child(guide)
	guide.setup(spy, null, lifecycle)
	check(guide.state_key == "login" and guide.connection_count() == signals.size(), "guide starts at login and listens only to existing Session and lifecycle signals")
	spy.busy = true
	await create_timer(0.3).timeout
	var polled: String = guide.state_key
	spy.busy = false
	spy.connected = true
	spy.authenticated.emit()
	check(polled == "connecting" and guide.state_key == "lobby", "busy has no signal, so a bounded poll shows connecting, then lobby after authentication")
	var keys: Array = []
	var room := func(phase: String, round_id: int, self_ready: bool, other_ready: bool, host: String) -> void:
		spy.match_id = "room-a"
		spy.snapshot = {"phase": phase, "round_id": round_id, "host_id": host, "token": "PRIVATE_TOKEN", "players": [
			{"user_id": "PRIVATE_SELF", "username": "PRIVATE_NAME", "connected": true, "ready": self_ready},
			{"user_id": "PRIVATE_OTHER", "connected": true, "ready": other_ready}]}
		spy.snapshot_received.emit(spy.snapshot)
		keys.append(guide.state_key)
	spy.joined.emit()
	room.call("lobby", 1, false, false, "PRIVATE_SELF")
	room.call("lobby", 1, true, false, "PRIVATE_SELF")
	room.call("lobby", 1, true, true, "PRIVATE_SELF")
	room.call("lobby", 1, true, true, "PRIVATE_OTHER")
	room.call("countdown", 1, true, true, "PRIVATE_SELF")
	room.call("playing", 1, true, true, "PRIVATE_SELF")
	room.call("results", 1, true, true, "PRIVATE_SELF")
	var results_text: String = guide.text
	room.call("lobby", 2, false, false, "PRIVATE_SELF")
	check(keys == ["ready_needed", "waiting_peer", "host_start", "waiting_host", "countdown", "playing", "results", "ready_needed"] and results_text.contains("第1局") and guide.text.contains("第2局"), "authoritative snapshot drives ready, host, countdown, playing, results and next-round stages")
	check(not guide.text.contains("PRIVATE") and not results_text.contains("PRIVATE"), "guide text never carries ids, names or snapshot fields")
	var updates_before: int = guide.text_updates
	for i in range(5):
		guide.refresh()
	var child_count := guide.get_child_count()
	var instance := guide.get_instance_id()
	for i in range(30):
		await process_frame
	check(guide.text_updates == updates_before and guide.get_child_count() == child_count and guide.get_instance_id() == instance, "unchanged state neither rewrites text nor rebuilds nodes across frames")
	spy.match_id = ""
	spy.snapshot = {}
	spy.left.emit()
	var after_leave: String = guide.state_key
	spy.room_failed.emit("module_failure")
	var failed: String = guide.state_key
	spy.match_id = "room-b"
	spy.joined.emit()
	check(after_leave == "lobby" and failed == "room_failed" and guide.state_key == "syncing" and not guide.text.contains("第"), "leaving clears the old round, room failure is not results, and a new room waits for its own snapshot")
	spy.match_id = ""
	spy.snapshot = {}
	spy.left.emit()
	lifecycle.enter_background("simulated")
	var hidden_key: String = guide.state_key
	lifecycle.return_foreground("simulated")
	var returned_key: String = guide.state_key
	var logins_after_show: int = spy.logins
	spy.connected = true
	spy.authenticated.emit()
	check(hidden_key == "background" and returned_key == "after_background" and logins_after_show == 0 and guide.state_key == "lobby", "background logout then foreground asks for manual relogin, cleared only by a real authentication")
	spy._on_closed()
	check(guide.state_key == "after_disconnect" and not spy.connected, "unexpected socket close is shown as ended session, not normal results")
	guide.release()
	var after: Array = signals.map(func(s): return s.get_connections().size())
	var frozen: String = guide.text
	spy.connected = true
	spy.authenticated.emit()
	spy.snapshot_received.emit({})
	lifecycle.enter_background("simulated")
	check(after == before and guide.connection_count() == 0 and guide.text == frozen, "released guide disconnects every signal and ignores later callbacks")
	guide.queue_free()
	lifecycle.queue_free()
	await process_frame
	spy.free()

func _test_guide_initial_background() -> void:
	# Match entry's actual order: initial hidden bridge logs out before guide exists.
	var spy := spy_session()
	var fake := FakeBridgeInterface.new()
	fake.hidden_now = true
	var bridge = BRIDGE.new(fake, func(target: Callable): return FakeCallback.new(target))
	var lifecycle: Node = LIFECYCLE.new()
	root.add_child(lifecycle)
	lifecycle.setup(spy, bridge, Callable())
	var guide: Label = GUIDE.new()
	root.add_child(guide)
	guide.setup(spy, null, lifecycle)
	var hidden_key: String = guide.state_key
	lifecycle.return_foreground("bridge")
	check(hidden_key == "background" and guide.state_key == "after_background" and spy.logouts == 1 and spy.logins == 0, "guide installed after initial hidden logout retains the reason on foreground return")
	spy.connected = true
	spy.authenticated.emit()
	check(guide.state_key == "lobby" and not guide.text.contains("刚才切到后台"), "fresh authentication clears the initial-background explanation")
	guide.queue_free()
	lifecycle.queue_free()
	await process_frame
	spy.free()

func _test_guide_layout() -> void:
	var sizes := [Vector2(1152, 648), Vector2(1402, 648), Vector2(800, 600)]
	var failures_seen: Array = []
	for size in sizes:
		var holder := Control.new()
		holder.size = size
		root.add_child(holder)
		var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
		holder.add_child(entry)
		await process_frame
		await process_frame
		var guide: Label = entry.guide
		guide.text = GUIDE.text_for("playing", 12)
		await process_frame
		await process_frame
		var guide_rect := guide.get_global_rect()
		var field := entry.find_child("PlayerName", true, false) as Control
		var marker := entry.find_child("IsolatedTestLabel", true, false) as Control
		var inside: bool = guide_rect.position.x >= 0 and guide_rect.end.x <= size.x + 0.5
		var stacked: bool = guide_rect.position.y >= marker.get_global_rect().end.y - 0.5 and guide_rect.end.y <= entry.main.global_position.y + 0.5
		var clear: bool = field != null and field.get_global_rect().position.y >= guide_rect.end.y
		var bounded: bool = guide.get_line_count() <= guide.max_lines_visible and entry.main.offset_top <= 120.0
		if not (guide.is_visible_in_tree() and guide.theme == entry.main.theme and inside and stacked and clear and bounded):
			failures_seen.append("%dx%d" % [int(size.x), int(size.y)])
		holder.queue_free()
		await process_frame
	check(failures_seen.is_empty(), "longest guide wraps within 3 lines above Main at desktop, landscape-phone and narrow widths")
	var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
	root.add_child(entry)
	await process_frame
	await process_frame
	var bar := entry.find_child("AcceptanceBar", true, false) as Control
	var panel: Control = entry.diagnostics_panel
	check(not entry.guide.get_global_rect().intersects(bar.get_global_rect()) and panel.offset_top >= entry.guide.get_global_rect().end.y - 0.5, "guide stays clear of the bottom test buttons and the diagnostics panel starts below it")
	entry.queue_free()
	await process_frame
