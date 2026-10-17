extends SceneTree
## Focused SDK ownership tests. Fake adapters exercise completion ordering;
## this is not a server throughput or operating-system memory benchmark.
var checks: int = 0
var failures: int = 0

class QuietLogger extends NakamaLogger:
	var warnings_seen: Array[String] = []
	var errors_seen: Array[String] = []
	var debug_seen: Array[String] = []
	var info_seen: Array[String] = []
	func warning(message):
		warnings_seen.append(str(message))
	func error(message):
		errors_seen.append(str(message))
	func debug(message):
		debug_seen.append(str(message))
	func info(message):
		info_seen.append(str(message))

class FakeAdapter extends NakamaSocketAdapter:
	var send_error: int = OK
	var sends: int = 0
	var last_packet := PackedByteArray()
	func send(buffer: PackedByteArray, _reliable: bool = true) -> int:
		sends += 1
		last_packet = buffer
		return send_error
	func close():
		closed.emit()
	func connect_to_host(_uri: String, _timeout: int):
		call_deferred("emit_signal", "connected")

func _initialize() -> void:
	_run.call_deferred()

func check(condition: bool, description: String) -> void:
	checks += 1
	print(("PASS " if condition else "FAIL ") + description)
	if not condition:
		failures += 1

func _fixture() -> Dictionary:
	var adapter := FakeAdapter.new()
	var logger := QuietLogger.new()
	adapter.logger = logger
	root.add_child(adapter)
	var socket := NakamaSocket.new(adapter, "127.0.0.1", 7350, "ws", false)
	return {"adapter": adapter, "socket": socket, "logger": logger}

func _send(socket: NakamaSocket, raw: bool) -> Signal:
	if raw:
		return socket.send_match_state_raw_async("test-match", 1, PackedByteArray([0, 1, 127, 255]))
	return socket.send_match_state_async("test-match", 1, "{\"left\":true}")

func _observe(completion: Signal, fixture: Dictionary) -> Dictionary:
	var trace := {"calls": 0, "failures": 0, "pending_at_completion": -1}
	completion.connect(func(result):
		trace.calls += 1
		trace.failures += int(result.is_exception())
		trace.pending_at_completion = fixture.socket._requests.size())
	return trace

func _flush() -> void:
	await process_frame
	await process_frame

func _dispose(fixture: Dictionary) -> void:
	fixture.adapter.queue_free()
	await process_frame
	fixture.socket = null

func _single_send(raw: bool, fail: bool, close_before: bool) -> void:
	var fixture := _fixture()
	fixture.adapter.send_error = ERR_CONNECTION_ERROR if fail else OK
	var completion := _send(fixture.socket, raw)
	var trace := _observe(completion, fixture)
	var label := "%s fail=%s close-before=%s" % ["raw" if raw else "typed", str(fail), str(close_before)]
	var packet: Dictionary = JSON.parse_string(fixture.adapter.last_packet.get_string_from_utf8())
	var expected := Marshalls.raw_to_base64(PackedByteArray([0, 1, 127, 255])) if raw else Marshalls.utf8_to_base64("{\"left\":true}")
	check(packet.has("cid") and packet.match_data_send.match_id == "test-match" and packet.match_data_send.data == expected, label + " wire envelope preserved")
	if close_before:
		fixture.adapter.close()
	await _flush()
	check(trace.calls == 1 and trace.failures == int(fail or close_before), label + " completes exactly once with correct success/failure")
	check(fixture.socket._requests.is_empty() and trace.pending_at_completion == 0, label + " releases request before callbacks")
	check(fixture.logger.warnings_seen.is_empty() and fixture.logger.errors_seen.is_empty(), label + " delayed cleanup produces no missing-request noise")
	await _dispose(fixture)

func _reentrant_close(raw: bool) -> void:
	var fixture := _fixture()
	# A normal acknowledgement-bearing request must be cancelled by the close.
	var ack = fixture.socket._send_async(NakamaRTMessage.MatchLeave.new("other-match"))
	var ack_trace := _observe(ack.completed, fixture)
	var completion := _send(fixture.socket, raw)
	var match_trace := _observe(completion, fixture)
	completion.connect(func(_result): fixture.adapter.close())
	await _flush()
	check(match_trace.calls == 1 and match_trace.failures == 0 and ack_trace.calls == 1 and ack_trace.failures == 1, "%s callback close completes each request once" % ("raw" if raw else "typed"))
	check(fixture.socket._requests.is_empty() and fixture.logger.warnings_seen.is_empty() and fixture.logger.errors_seen.is_empty(), "%s callback close leaves no retained requests or cleanup noise" % ("raw" if raw else "typed"))
	await _dispose(fixture)

func _ack_behavior() -> void:
	var fixture := _fixture()
	var request = fixture.socket._send_async(NakamaRTMessage.MatchLeave.new("test-match"))
	var trace := _observe(request.completed, fixture)
	await _flush()
	check(trace.calls == 0 and fixture.socket._requests.size() == 1, "ordinary request still waits for its server acknowledgement")
	fixture.socket._received(JSON.stringify({"cid": request.id}).to_utf8_buffer())
	check(trace.calls == 1 and trace.failures == 0 and trace.pending_at_completion == 0 and fixture.socket._requests.is_empty(), "ordinary acknowledgement parsing and erase-before-callback preserved")
	fixture.socket._cancel_request(request.id)
	check(trace.calls == 1 and fixture.logger.warnings_seen.is_empty(), "late cancellation of completed request is a quiet no-op")
	await _dispose(fixture)

func _repeated_batches() -> void:
	var fixture := _fixture()
	var trace := {"calls": 0, "failures": 0}
	for batch in range(8):
		for i in range(128):
			var completion := _send(fixture.socket, i % 2 == 1)
			completion.connect(func(result):
				trace.calls += 1
				trace.failures += int(result.is_exception()))
		await _flush()
		check(fixture.socket._requests.is_empty() and trace.calls == (batch + 1) * 128, "batch %d drains all 128 typed/raw send requests" % (batch + 1))
	check(trace.calls == 1024 and trace.failures == 0 and fixture.logger.warnings_seen.is_empty() and fixture.logger.errors_seen.is_empty(), "1024 sends complete successfully with bounded request ownership")
	await _dispose(fixture)

func _privacy_logs() -> void:
	var fixture := _fixture()
	var sentinel := "PRIVATE_CHAT_PAYLOAD_SENTINEL"
	var synthetic_session = load("res://addons/com.heroiclabs.nakama/api/NakamaSession.gd").new()
	synthetic_session._token = sentinel
	var connection_result = await fixture.socket.connect_async(synthetic_session)
	check(not connection_result.is_exception(), "synthetic connection completes without a real network")
	var request = fixture.socket._send_async(NakamaRTMessage.ChannelMessageSend.new("test-channel", JSON.stringify({"text": sentinel})))
	var trace := _observe(request.completed, fixture)
	fixture.socket._received(JSON.stringify({"cid": request.id, "error": {"code": 3, "message": sentinel}}).to_utf8_buffer())
	check(trace.calls == 1 and trace.failures == 1, "chat error still completes the request with failure")
	fixture.socket._received(("{" + sentinel).to_utf8_buffer())
	fixture.socket._received(JSON.stringify({"cid": "late", "content": sentinel}).to_utf8_buffer())
	fixture.socket._received(JSON.stringify({"unhandled": {"text": sentinel}}).to_utf8_buffer())
	fixture.socket._resume_request("missing", {"text": sentinel})
	var all_logs: Array = fixture.logger.debug_seen + fixture.logger.info_seen + fixture.logger.warnings_seen + fixture.logger.errors_seen
	check(not all_logs.is_empty(), "privacy patch preserves debug/error categories")
	var leaked := false
	for message in all_logs:
		if sentinel in message: leaked = true
	check(not leaked, "outgoing, error, malformed, late and unhandled logs contain no payload")
	check(fixture.logger.warnings_seen.has("Error response from server (code 3)"), "numeric server error remains observable")
	check(fixture.logger.errors_seen.has("Unable to parse realtime response") and fixture.logger.errors_seen.has("Invalid realtime call id received"), "parse and late-response error categories remain observable")
	check(fixture.socket._requests.is_empty(), "privacy changes preserve request cleanup")
	await _dispose(fixture)

func _run() -> void:
	await process_frame
	for raw in [false, true]:
		for fail in [false, true]:
			for close_before in [false, true]:
				await _single_send(raw, fail, close_before)
		await _reentrant_close(raw)
	await _ack_behavior()
	await _repeated_batches()
	await _privacy_logs()
	print("SDK_SOCKET_LIFECYCLE_SUMMARY checks=%d failures=%d" % [checks, failures])
	quit(1 if failures else 0)
