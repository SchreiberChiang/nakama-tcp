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

class FakeGeometryInterface:
	var calls := 0
	func geometryJSON() -> String:
		calls += 1
		return JSON.stringify({"status": "known", "x": 0.04, "y": 0.04, "width": 0.92, "height": 0.90})

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
	await _test_diagnostics_geometry()
	await _test_diagnostics_input_routing()
	await _test_safearea_layout()
	print("CROSS_PLATFORM_CHECKS %d FAILURES %d" % [checks, failures])
	quit(1 if failures else 0)

func _test_safearea_layout() -> void:
	var holder := Control.new()
	holder.size = Vector2(1409, 648)
	root.add_child(holder)
	var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
	holder.add_child(entry)
	await process_frame
	entry.geometry_override = {"status": "conservative", "x": 0.07, "y": 0.08, "width": 0.81, "height": 0.82}
	entry._toggle_diagnostics()
	for frame in range(4):
		await process_frame
	var safe := Rect2(Vector2(1409 * 0.07, 648 * 0.08), Vector2(1409 * 0.81, 648 * 0.82))
	var panel: Control = entry.diagnostics_panel
	check(panel.visible and safe.encloses(panel.get_global_rect()), "conservative safe area scales with logical viewport and bounds the whole card")
	check(safe.encloses(panel.close_button.get_global_rect()) and panel.tabs.all(func(button): return safe.encloses(button.get_global_rect())), "conservative status note leaves Close and all tabs in the effective safe area")
	panel.set_observations(diagnostic_payload()[0], "PRIVATE_UID", {}, {}, [])
	panel.select_page("服务端")
	await process_frame
	check(panel.get_global_rect().encloses(panel.scroll.get_global_rect()) and panel.label.size.y > panel.scroll.size.y, "long server page scrolls internally inside the safe-area card")
	entry.geometry_override = {"status": "unknown"}
	entry._layout_header()
	check(not panel.visible and entry._diagnostics_requested, "unknown observation suppresses stale geometry while retaining explicit open request")
	entry._sync_diagnostic_controls()
	check(entry._diagnostics_requested, "snapshot/join input synchronization cannot cancel a geometry-suppressed open request")
	entry.geometry_override = {"status": "known", "x": 0.02, "y": 0.04, "width": 0.90, "height": 0.90}
	entry._layout_header()
	for frame in range(3):
		await process_frame
	check(panel.visible and panel.position.x >= 1409 * 0.02 and panel.get_global_rect().end.y <= 648 * 0.94, "fresh known observation restores requested diagnostics without using the old rectangle")
	panel.close_button.pressed.emit()
	check(not entry._diagnostics_requested and not panel.visible, "explicit Close cancels the request after geometry recovery")
	entry.geometry_override = {"status": "known", "x": NAN, "y": 0, "width": 1, "height": 1}
	entry._toggle_diagnostics()
	check(not panel.visible and entry.geometry_status == "unknown", "nonfinite bridge observation is unknown rather than a full-screen safe fallback")
	entry.geometry_override = {"status": "known", "x": 0, "y": 0, "width": 0.1, "height": 0.1}
	entry._layout_header()
	check(not panel.visible and entry._diagnostics_requested, "too-small effective area does not overflow the external frame")
	entry.geometry_override = {"status": "known", "x": 0, "y": 0.2, "width": 1, "height": 0.46}
	entry._layout_header()
	for frame in range(4):
		await process_frame
	entry.geometry_override.status = "conservative"
	entry._layout_header()
	for frame in range(4):
		await process_frame
	check(not panel.visible or panel.get_global_rect().end.y <= 648 * 0.66, "known to conservative at tight height settles without note-driven external overflow")
	entry._diagnostics_requested = false
	entry.geometry_override = null
	var geometry := FakeGeometryInterface.new()
	entry._geometry_interface = geometry
	entry._layout_header()
	check(geometry.calls == 0, "closed diagnostics does not query platform geometry")
	entry._toggle_diagnostics()
	for frame in range(3):
		await process_frame
	check(panel.visible and geometry.calls >= 1, "explicit open queries current platform geometry immediately")
	var queried := geometry.calls
	entry._toggle_diagnostics()
	check(not panel.visible and geometry.calls == queried, "toggle closes the platform panel without another geometry query")
	holder.queue_free()
	await process_frame

func diagnostic_payload() -> Array:
	var maximum := 9007199254740991
	var state := {"phase": "playing", "round_id": 2, "tick": 345, "diagnostics": {}, "token": "PRIVATE_TOKEN", "players": [{"user_id": "PRIVATE_UID", "username": "PRIVATE_NAME", "private_note": "PRIVATE_NOTE", "score": 2147483647, "position": {"x": maximum, "y": -maximum}, "velocity": {"x": 60, "y": -60}, "accepted_input_seq": 2147483647, "applied_input_seq": 2147483646}]}
	for key in PANEL.SERVER_COUNTERS:
		state.diagnostics[key] = 2147483647
	var summary := {"enabled": true}
	for key in PANEL.CLIENT_EVENTS:
		summary[key] = {"count": 2147483647, "window_bytes": maximum, "window_interval_mean_ms": maximum, "window_interval_max_ms": maximum, "last_age_ms": maximum}
	var presentation := {"enabled": true, "snapshot_receive_age_ms": maximum, "frame_callback_interval_ms": maximum, "sample_cpu_usec": maximum, "timeline": {"presentation_state": "extrapolating", "buffer_samples": 120, "buffer_depth_ms": maximum, "underrun_frames": 2147483647, "extrapolated_frames": 2147483647, "late_snapshot_drops": 2147483647, "timeline_resets": 2147483647}}
	var commands: Array = []
	for index in range(8):
		commands.append({"seq": 2147483640 + index, "round_id": 2, "status": PANEL.COMMAND_STATUSES[index]})
	return [state, "PRIVATE_UID", summary, presentation, commands]

func _test_diagnostics_geometry() -> void:
	var data := diagnostic_payload()
	for dimensions in [Vector2(1152, 648), Vector2(1409, 648), Vector2(800, 600)]:
		var holder := Control.new()
		holder.size = dimensions
		root.add_child(holder)
		var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
		holder.add_child(entry)
		var panel: Control = entry.diagnostics_panel
		var probe := spy_session()
		panel.setup(probe, Callable())
		panel.set_process(false) # Explicit synthetic observations, no live sampling.
		panel.show()
		panel.set_observations(data[0], data[1], data[2], data[3], data[4])
		for frame in range(6):
			await process_frame
		var rect := panel.get_global_rect()
		check(rect.position.x >= 0 and rect.end.x <= dimensions.x + 0.5 and rect.position.y >= entry.top_bar.get_global_rect().end.y and rect.end.y <= dimensions.y + 0.5 and panel.label.get_theme_font_size("font_size") >= 22, "diagnostics %dx%d: bounded readable body (panel %.0f..%.0f, font %d)" % [int(dimensions.x), int(dimensions.y), rect.position.x, rect.end.x, panel.label.get_theme_font_size("font_size")])
		var collected := ""
		for page in PANEL.PAGES:
			panel.select_page(page)
			for frame in range(3):
				await process_frame
			collected += panel.label.text
			var body_rect: Rect2 = panel.scroll.get_global_rect()
			var text_rect: Rect2 = panel.label.get_global_rect()
			check(rect.encloses(body_rect) and text_rect.position.x >= body_rect.position.x - 0.5 and text_rect.end.x <= body_rect.end.x + 0.5 and panel.label.autowrap_mode == TextServer.AUTOWRAP_WORD_SMART and panel.scroll.horizontal_scroll_mode == ScrollContainer.SCROLL_MODE_DISABLED, "diagnostics %dx%d %s body wraps inside a bounded vertical scroll" % [int(dimensions.x), int(dimensions.y), page])
		var counters_complete := true
		for key in PANEL.SERVER_COUNTERS:
			counters_complete = counters_complete and collected.contains("（%s）：2147483647" % key)
		check(counters_complete and collected.count("命令 seq ") == 8 and not collected.contains("PRIVATE") and collected.contains("非累计确认") and collected.contains("未知不等于失败") and collected.contains("RTT 缺测") and collected.contains("轮次 2") and collected.contains("tick 345"), "diagnostics groups retain every counter, 8 exact commands and privacy/unknown semantics")
		var close_rect: Rect2 = panel.close_button.get_global_rect()
		check(rect.encloses(close_rect) and close_rect.end.y <= panel.scroll.global_position.y and panel.close_button.size.y >= 44 and panel.tabs.all(func(button): return button.size.y >= 44), "diagnostics close and page controls remain visible touch targets above scrolling")
		panel.select_page("服务端")
		for frame in range(3):
			await process_frame
		panel.scroll.scroll_vertical = 90
		await process_frame
		var held_scroll: int = panel.scroll.scroll_vertical
		var updates: int = panel.text_updates
		var instance: int = panel.label.get_instance_id()
		panel.hide()
		panel._process(10.0)
		panel.show()
		await process_frame
		check(held_scroll > 0 and panel.scroll.scroll_vertical == held_scroll and panel.text_updates == updates and panel.label.get_instance_id() == instance and probe.logins == 0 and probe.logouts == 0 and probe.submitted.is_empty(), "diagnostics hide/show preserves scroll and nodes without hidden updates or Session actions")
		panel.set_observations({}, "", {}, {}, [])
		for frame in range(3):
			await process_frame
		check(panel.label.text.contains("缺测") and panel.scroll.scroll_vertical <= panel.scroll.get_v_scroll_bar().max_value and rect.encloses(panel.scroll.get_global_rect()), "diagnostics smaller observations clamp scroll without overflowing")
		holder.queue_free()
		await process_frame
		probe.free()

func _test_diagnostics_input_routing() -> void:
	var session := root.get_node("Session")
	var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
	root.add_child(entry)
	session.match_id = "diagnostics-input-room"
	session.snapshot = {"phase": "playing", "round_id": 1, "tick": 1, "game_id": "fixture", "host_id": "", "players": [{"user_id": "", "username": "甲", "connected": true, "ready": true, "score": 0}]}
	session.joined.emit()
	for frame in range(8):
		await process_frame
	var view: Control = entry.main.module_view
	var at: Vector2 = view.pad.global_position + Vector2(view.pad.size.x * 5.0 / 6.0, view.pad.size.y * 0.5)
	root.push_input(touch(90, at, true), true)
	check(view.pad.direction() == Vector2.RIGHT, "viewport-dispatched touch drives the uncovered pad")
	var before_seq: int = session._seq
	root.push_input(mouse(view.pulse_button.get_global_rect().get_center(), true), true)
	entry.diagnostics_panel.show()
	root.push_input(mouse(view.pulse_button.get_global_rect().get_center(), false), true)
	root.push_input(touch(91, at, true), true)
	var covered_direction: Vector2 = view.pad.direction()
	root.push_input(drag(91, at + Vector2(0, 12)), true)
	root.push_input(touch(91, at, false), true)
	check(covered_direction == Vector2.ZERO and view.pad.direction() == Vector2.ZERO and not view.pad.is_processing_input() and session._seq == before_seq and session.input_provider.is_valid(), "opening diagnostics clears held touch and intercepts overlay touches/Pulse release without pausing the provider")
	entry.geometry_override = {"status": "unknown"}
	entry._layout_header()
	session.snapshot.round_id = 2
	session.snapshot.tick = 2
	session.snapshot_received.emit(session.snapshot)
	await process_frame
	var new_view: Control = entry.main.module_view
	check(entry._diagnostics_requested and not entry.diagnostics_panel.visible, "unknown geometry keeps open request through snapshot and view replacement")
	entry.geometry_override = {"status": "known", "x": 0.04, "y": 0.02, "width": 0.92, "height": 0.92}
	entry._layout_header()
	for frame in range(3):
		await process_frame
	check(new_view != view and not new_view.pad.is_processing_input() and new_view.pulse_button.disabled, "new playing view inherits open diagnostics input protection")
	var close_at: Vector2 = entry.diagnostics_panel.close_button.get_global_rect().get_center()
	root.push_input(mouse(close_at, true), true)
	root.push_input(mouse(close_at, false), true)
	root.push_input(touch(90, at, false), true)
	check(not entry.diagnostics_panel.visible and new_view.pad.is_processing_input() and not new_view.pulse_button.disabled and new_view.pad.direction() == Vector2.ZERO and session._seq == before_seq, "viewport-dispatched Close restores current controls without replaying a held input or passing through Pulse")
	session.match_id = ""
	session.snapshot = {}
	entry.queue_free()
	await process_frame

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
		var buttons := entry.find_child("AcceptanceBar", true, false) as Control
		var bar_rect: Rect2 = entry.top_bar.get_global_rect()
		var inside: bool = guide_rect.position.x >= 0 and guide_rect.end.x <= size.x + 0.5 and buttons.get_global_rect().end.x <= size.x + 0.5
		var row: bool = not guide_rect.intersects(marker.get_global_rect()) and not guide_rect.intersects(buttons.get_global_rect()) and bar_rect.encloses(guide_rect)
		var clear: bool = field != null and field.get_global_rect().position.y >= bar_rect.end.y and entry.main.global_position.y >= bar_rect.end.y - 0.5
		var bounded: bool = guide.get_line_count() <= guide.max_lines_visible and entry.main.offset_top <= 120.0
		if not (guide.is_visible_in_tree() and guide.get_theme_font("font") == entry.main.get_theme_font("font") and inside and row and clear and bounded):
			failures_seen.append("%dx%d" % [int(size.x), int(size.y)])
		holder.queue_free()
		await process_frame
	check(failures_seen.is_empty(), "one top bar holds marker, longest guide (max 3 lines) and test buttons above Main at desktop, landscape-phone and narrow widths")
	var entry: Control = load("res://tests/cross_platform/entry.tscn").instantiate()
	root.add_child(entry)
	await process_frame
	await process_frame
	var panel: Control = entry.diagnostics_panel
	var panel_hidden: bool = not panel.visible
	(entry.find_child("ToggleDiagnostics", true, false) as Button).pressed.emit()
	await process_frame
	check(panel_hidden and panel.visible and panel.offset_top >= entry.top_bar.get_global_rect().end.y and panel.get_theme_stylebox("panel").bg_color.a >= 0.9, "diagnostics card is hidden by default, opens on demand below the top bar and is opaque")
	var spy := spy_session()
	var base_session := root.get_node("Session")
	var plain: bool = not entry.compact_login(base_session) and (entry.main.find_child("Host", true, false) as Control).visible
	spy.cross_platform_enabled = true
	var compacted: bool = entry.compact_login(spy)
	var hidden_fields := ["Host", "Port", "TLS", "ServerKey"].all(func(id): return not (entry.main.find_child(id, true, false) as Control).visible)
	var kept := ["PlayerName", "Login"].all(func(id): return (entry.main.find_child(id, true, false) as Control).visible)
	check(plain and compacted and hidden_fields and kept, "only an enabled test session hides preset connection fields; name and login stay")
	spy.free()
	var main: Control = entry.main
	var login := main.find_child("Login", true, false) as Button
	var name_field := main.find_child("PlayerName", true, false) as Control
	check(login.theme_type_variation == "PrimaryButton" and name_field.get_theme_font_size("font_size") == 20 and login.get_theme_stylebox("normal") is StyleBoxFlat, "shared Main theme reaches child controls with size 20 text and styled primary actions")
	var column_ok: bool = name_field.get_global_rect().size.x <= main.COLUMN_WIDTH + 1.0
	check(column_ok, "forms keep a bounded readable column on wide screens")
	var session := base_session
	session.match_id = "layout-room"
	var players := [{"user_id": "", "username": "甲", "connected": true, "ready": true, "score": 1, "position": {"x": 0, "y": 0}, "velocity": {"x": 0, "y": 0}},
		{"user_id": "other", "username": "乙", "connected": true, "ready": true, "score": 2, "position": {"x": 0, "y": 0}, "velocity": {"x": 0, "y": 0}}]
	session.snapshot = {"phase": "lobby", "round_id": 1, "tick": 10, "game_id": "fixture", "host_id": "other", "min_players": 2, "players": players, "results": []}
	session.joined.emit()
	await process_frame
	var leave := main.find_child("Leave", true, false) as Control
	check(leave != null and leave.get_parent().name == "Header" and main.find_child("Ready", true, false).theme_type_variation == "PrimaryButton", "room page puts Leave in the title row and readies with a primary action")
	session.snapshot = {"phase": "playing", "round_id": 1, "tick": 20, "game_id": "fixture", "host_id": "other", "min_players": 2, "players": players, "results": []}
	session.snapshot_received.emit(session.snapshot)
	for i in range(4):
		await process_frame
	var view: Control = main.module_view
	var pad_rect: Rect2 = view.pad.get_global_rect()
	var field_rect: Rect2 = view.field.get_global_rect()
	var pulse_rect: Rect2 = view.pulse_button.get_global_rect()
	check(view != null and pad_rect.end.x <= field_rect.position.x and pulse_rect.position.x >= field_rect.end.x and field_rect.size.y >= 200.0 and pad_rect.end.y <= get_root().get_visible_rect().size.y, "playing page puts the pad left, a tall field centre and Pulse right inside the screen")
	view.update_extent({"far": {"position": Vector2(600, -420)}, "near": {"position": Vector2(5, 5)}}, 0.016)
	var far: Vector2 = view.world_to_field(Vector2(600, -420))
	view.update_extent({}, 0.016)
	check(Rect2(Vector2.ZERO, view.field.size).has_point(far) and view._extent > view.MIN_EXTENT, "field zooms out so distant authoritative positions stay visible")
	session.snapshot = {"phase": "results", "round_id": 1, "tick": 30, "game_id": "fixture", "host_id": "other", "min_players": 2, "players": players, "results": [{"username": "乙", "score": 2}, {"username": "甲", "score": 1}]}
	session.snapshot_received.emit(session.snapshot)
	await process_frame
	check(main.find_child("ResultsCard", true, false) != null and main.find_child("Rematch", true, false).theme_type_variation == "PrimaryButton", "results render as a card with a primary rematch action")
	session.match_id = ""
	session.snapshot = {}
	entry.queue_free()
	await process_frame
