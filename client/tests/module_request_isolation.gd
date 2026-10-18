extends SceneTree
## Actual Session and Main, deterministic SDK boundary; no backend or default module.
var checks := 0
var failures := 0

class TestSocket extends NakamaSocket:
	var sent: Array = []
	var departures := 0
	var metadata: Dictionary = {}
	func _init():
		var adapter := NakamaSocketAdapter.new()
		adapter.logger = NakamaLogger.new()
		super(adapter, "127.0.0.1", 7350, "ws", false)
		adapter.free()
	func send_match_state_async(id, op: int, data: String, _presences = null):
		sent.append({"match_id": id, "op": op, "data": JSON.parse_string(data)})
		return NakamaAsyncResult.new()
	func leave_match_async(_id: String):
		departures += 1
		return NakamaAsyncResult.new()
	func join_match_async(id: String, values = null):
		metadata = values.duplicate(true)
		var result := NakamaRTAPI.Match.new()
		result.match_id = id
		return result
	func close(): pass

class TestView extends GameModule:
	var releases := 0
	func _init(): continuous_input = true
	func _ready(): enable_timeline(0, 0)
	func collect_input() -> Dictionary: return {"direction": {"x": 0, "y": 0}}
	func release():
		releases += 1
		super.release()

func _initialize(): _run.call_deferred()
func check(value: bool, label: String):
	checks += 1
	if not value: failures += 1
	print(("PASS " if value else "FAIL ") + label)
func deliver(transport: Node, op: int, data: Dictionary, id := "request-room"):
	var message := NakamaRTAPI.MatchData.new()
	message.match_id = id
	message.op_code = op
	message.data = JSON.stringify(data)
	transport._on_match_state(message, transport._generation)
func packet(tick: int) -> Dictionary:
	return {"protocol_version": 3, "module_version": 1, "room_phase_version": 2,
		"game_id": "REQUEST_TEST", "phase": "playing", "tick": tick, "round_id": 1,
		"tick_rate": 30, "snapshot_rate": 20, "players": [{"user_id": "local",
		"username": "Tester", "connected": true, "position": {"x": tick, "y": 0},
		"command_results": [{"seq": 1, "round_id": 1, "tick": tick, "status": "rejected_module_error", "secret": "PRIVATE_SENTINEL"}]}]}

func _run():
	var transport := root.get_node("Session")
	var saved_modules: Dictionary = ModuleRegistry.modules.duplicate(true)
	ModuleRegistry.register_module("REQUEST_TEST", func(): return TestView.new())
	var ui: Control = load("res://Main.tscn").instantiate()
	root.add_child(ui)
	var socket := TestSocket.new()
	transport.socket = socket
	transport.connected = true
	transport.session = NakamaSession.new()
	transport.session._user_id = "local"
	await transport.join_room("request-room", "REQUEST_TEST")
	check(socket.metadata.protocol_version == "3", "join advertises protocol v3")
	check(not transport._valid_catalog({"protocol_version": 2, "games": []}) and transport._valid_catalog({"protocol_version": 3, "games": []}), "catalog rejects v2 and accepts v3")
	var old := packet(1)
	old.protocol_version = 2
	deliver(transport, 10, old)
	check(transport.snapshot.is_empty(), "old v2 snapshot rejected")
	transport.diagnostics.set_enabled(true)
	deliver(transport, 10, packet(1))
	var view: TestView = ui.module_view
	var scope: String = transport.presentation_scope()
	var generation: int = transport._generation
	var epoch: int = transport._room_epoch
	var account = transport.session
	var provider: Callable = transport.input_provider
	var outcomes: Array = transport.command_results()
	check(ui.page == "playing" and is_instance_valid(view) and provider.is_valid(), "playing owns actual module and input provider")
	check(outcomes == [{"seq": 1, "round_id": 1, "tick": 1, "status": "rejected_module_error"}], "Session recognizes exact request rejection with extra fields removed")
	check(transport.diagnostic_summary().command_results == [{"seq": 1, "round_id": 1, "tick": 1, "status_code": 10}], "numeric diagnostics recognizes request rejection")
	var signals := {"failed": 0, "left": 0, "request": 0}
	transport.room_failed.connect(func(_category): signals.failed += 1)
	transport.left.connect(func(): signals.left += 1)
	transport.module_request_failed.connect(func(): signals.request += 1)
	deliver(transport, 11, {"error": "Module request failure", "secret": "PRIVATE_SENTINEL"})
	check(transport.socket == socket and transport.session == account and transport.connected and transport.match_id == "request-room" and socket.departures == 0, "recoverable hint preserves socket account and match without departure")
	check(transport._generation == generation and transport._room_epoch == epoch and transport.presentation_scope() == scope, "recoverable hint preserves connection and room generation")
	check(ui.page == "playing" and ui.module_view == view and view.releases == 0 and transport.input_provider == provider and view.latest_snapshot.tick == 1 and view.timeline.frames.size() == 1, "recoverable hint preserves game view timeline and input provider")
	check(signals == {"failed": 0, "left": 0, "request": 1} and transport.command_results() == outcomes, "recoverable hint emits only fixed request signal and keeps exact outcomes")
	check(not ui.status.text.contains("PRIVATE"), "recoverable notice never exposes response fields")
	deliver(transport, 10, packet(2))
	check(transport.snapshot.tick == 2 and ui.module_view == view and view.latest_snapshot.tick == 2 and view.timeline.frames.size() == 2, "next snapshot updates the same playing presentation")
	transport.submit_input({"pulse": true})
	check(socket.sent.size() == 1 and socket.sent[0].match_id == "request-room" and socket.sent[0].data.client_tick == 2 and socket.sent[0].data.round_id == 1, "subsequent legal request uses same room and fresh authority")
	for error in ["Module failure", "Projection failure"]:
		if transport.match_id.is_empty():
			transport.match_id = "request-room"
			deliver(transport, 10, packet(3))
		var active: TestView = ui.module_view
		deliver(transport, 11, {"error": error})
		check(transport.match_id.is_empty() and transport.snapshot.is_empty() and transport.command_results().is_empty() and not transport.input_provider.is_valid() and ui.page == "lobby" and active.releases == 1 and ui.module_view == null, "fatal %s clears room inputs and presentation" % error)
	check(socket.departures == 2 and signals.failed == 2 and signals.left == 2, "both fatal classes retain departure and failure signals")
	transport.logout()
	ui.queue_free()
	ModuleRegistry.modules = saved_modules
	await process_frame
	await process_frame
	print("MODULE_REQUEST_CHECKS %d FAILURES %d" % [checks, failures])
	quit(1 if failures else 0)
