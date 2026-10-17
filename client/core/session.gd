extends Node
## The sole transport boundary. No gameplay resources, cloud credentials or token persistence.
signal authenticated
signal logged_out
signal rooms_updated(rooms: Array)
signal joined
signal left
signal snapshot_received(snapshot: Dictionary)
signal notice(message: String, is_error: bool)
signal connection_changed(online: bool)

var chat = preload("res://core/session_chat.gd").new()
var client: NakamaClient
var socket: NakamaSocket
var session: NakamaSession
var connected := false
var busy := false
var match_id := ""
var game_id := ""
var snapshot: Dictionary = {}
var rooms: Array = []
var catalog: Array = []
var room_flow_version := 0
var room_capacity_supported := false
var host := "127.0.0.1"
var port := 7350
var tls := false
var server_key := "defaultkey" # Public LOCAL development key, never a production credential.
var username := "Player"
var profile := "default"
var input_provider := Callable()
var _device_id := ""
var _generation := 0
var _room_epoch := 0
var _seq := 0
var _joining_id := ""
var _presence_session_id := ""
var _host_change_seq := 0
var _input_elapsed := 0.0
var _control_sent_at: Dictionary = {}
var _args: Dictionary = {}

func _ready() -> void:
	chat.configure(_chat_transport)
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--"):
			var pair := argument.substr(2).split("=", true, 1)
			_args[pair[0]] = pair[1] if pair.size() > 1 else "true"
	profile = str(_args.get("profile", "default")).validate_filename()
	var config := ConfigFile.new()
	config.load(config_path())
	_device_id = str(config.get_value("player", "device_id", ""))
	if _device_id.is_empty():
		_device_id = Crypto.new().generate_random_bytes(16).hex_encode()
	username = str(config.get_value("player", "name", "Player"))
	host = str(_args.get("host", host))
	port = int(_args.get("port", port))
	tls = str(_args.get("tls", "false")) == "true"
	save_settings()

func config_path() -> String:
	return "user://template-" + profile + ".cfg"

func save_settings() -> void:
	var config := ConfigFile.new()
	config.set_value("player", "device_id", _device_id)
	config.set_value("player", "name", username)
	config.save(config_path())

func arg(key: String, fallback: String = "") -> String:
	return str(_args.get(key, fallback))

func user_id() -> String:
	return session.user_id if session != null else ""

func _valid_connection() -> bool:
	return port > 0 and port <= 65535 and not host.is_empty() and (tls or host in ["127.0.0.1", "localhost", "::1"])

func _process(delta: float) -> void:
	_input_elapsed += delta
	if _input_elapsed >= 1.0 / 30.0:
		_input_elapsed = 0.0
		if connected and snapshot.get("phase") == "playing" and input_provider.is_valid():
			submit_input(input_provider.call())

func _valid_snapshot(data: Dictionary) -> bool:
	return data.get("phase") in ["lobby", "countdown", "playing", "results"] and data.get("players") is Array and typeof(data.get("tick")) in [TYPE_INT, TYPE_FLOAT] and int(data.get("room_phase_version", 0)) == 2

func login(display_name: String, email: String = "", password: String = "", create_account: bool = false) -> void:
	if busy:
		return
	if not _valid_connection():
		notice.emit("远端连接必须启用 TLS；本地使用 127.0.0.1。", true)
		return
	busy = true
	chat.reset()
	_generation += 1
	var generation := _generation
	if socket != null:
		socket.close()
		socket = null
	connected = false
	session = null
	username = display_name.strip_edges().substr(0, 20)
	if username.is_empty():
		username = "Player"
	client = Nakama.create_client(server_key, host, port, "https" if tls else "http", 8, NakamaLogger.LOG_LEVEL.ERROR)
	var result: NakamaSession
	if email.is_empty():
		result = await client.authenticate_device_async(_device_id, null, true)
	else:
		result = await client.authenticate_email_async(email.strip_edges(), password, null, create_account)
	# Password exists only for this request and is never persisted or logged.
	password = ""
	if generation != _generation:
		return
	if result.is_exception():
		busy = false
		_report_request_error("authentication_error", result.get_exception(), "注册失败" if create_account else "登录失败")
		return
	session = result
	# Existing email accounts retain their display name across devices.
	if not email.is_empty() and not create_account:
		var account_result = await client.get_account_async(session)
		if generation != _generation:
			return
		if not account_result.is_exception() and not account_result.user.display_name.is_empty():
			username = account_result.user.display_name
		elif account_result.is_exception():
			_report_request_error("rpc_error", account_result.get_exception(), "已登录，但昵称读取失败")
	else:
		# Display names are separate from globally unique account usernames.
		var account_result = await client.update_account_async(session, null, username)
		if generation != _generation:
			return
		if account_result.is_exception():
			_report_request_error("rpc_error", account_result.get_exception(), "已登录，但昵称保存失败")
	socket = Nakama.create_socket_from(client)
	socket.received_channel_message.connect(func(message): _on_chat_channel(message, generation))
	socket.received_match_state.connect(func(state):
		if generation == _generation:
			_on_match_state(state, generation))
	socket.closed.connect(func():
		if generation == _generation:
			_on_closed())
	socket.received_match_presence.connect(func(event):
		if generation == _generation:
			_on_presence(event))
	socket.received_error.connect(func(error):
		if generation == _generation:
			_on_socket_error(error))
	var socket_result = await socket.connect_async(session, true, 8)
	if generation != _generation:
		return
	busy = false
	if socket_result.is_exception():
		session = null
		_report_request_error("socket_error", socket_result.get_exception(), "账号已验证，但实时连接失败")
		return
	connected = true
	busy = true
	var catalog_result := await call_rpc("game_catalog", {})
	if generation != _generation:
		return
	catalog = catalog_result.get("games", [])
	room_flow_version = int(catalog_result.get("room_flow_version", 0))
	room_capacity_supported = bool(catalog_result.get("room_capacity", false))
	chat.connected(generation, user_id(), catalog_result.get("chat"))
	busy = false
	save_settings()
	connection_changed.emit(true)
	authenticated.emit()
	refresh_rooms()

func call_rpc(rpc_id: String, payload: Dictionary = {}) -> Dictionary:
	if session == null or client == null:
		return {}
	var generation := _generation
	var result = await client.rpc_async(session, rpc_id, JSON.stringify(payload))
	if generation != _generation or session == null:
		return {}
	if result.is_exception():
		_report_request_error("rpc_error", result.get_exception(), "服务器操作失败")
		return {}
	var parsed = JSON.parse_string(result.payload)
	return parsed if parsed is Dictionary else {}

func refresh_rooms() -> void:
	var generation := _generation
	var result := await call_rpc("room_list", {})
	if generation != _generation:
		return
	rooms = result.get("rooms", [])
	rooms_updated.emit(rooms)

func create_room(room_name: String, module_id: String, options: Dictionary = {}, capacity: int = 0) -> void:
	if busy or not match_id.is_empty():
		return
	busy = true
	var generation := _generation
	var room_epoch := _room_epoch
	var payload := {"name": room_name.strip_edges().substr(0, 32), "game_id": module_id}
	if capacity > 0 and room_capacity_supported:
		payload["capacity"] = capacity
	if not options.is_empty():
		payload["options"] = options.duplicate(true)
	var result := await call_rpc("room_create", payload)
	if generation != _generation or room_epoch != _room_epoch:
		return
	busy = false
	if result.has("match_id"):
		await join_room(str(result.match_id), module_id)

## known_game is false for a typed-in room ID whose game is only a guess; the
## join then advertises every game's capabilities.
func join_room(id: String, module_id: String, known_game: bool = true) -> void:
	if busy or socket == null or not connected or not match_id.is_empty():
		return
	busy = true
	var generation := _generation
	var room_epoch := _room_epoch
	_joining_id = id
	chat.enter_room(id)
	_host_change_seq = 0
	snapshot = {}
	game_id = module_id
	var metadata := ModuleRegistry.join_metadata(module_id if known_game else "")
	metadata.display_name = username
	metadata.room_phase_version = str(2)
	var result = await socket.join_match_async(id, metadata)
	if generation != _generation or room_epoch != _room_epoch:
		return
	busy = false
	_joining_id = ""
	if result.is_exception():
		chat.show_lobby()
		_report_request_error("join_error", result.get_exception(), "无法加入房间")
		return
	match_id = result.match_id
	_presence_session_id = result.self_user.session_id if result.self_user != null else ""
	chat.commit_room(match_id)
	chat.observe_room(match_id, snapshot, generation)
	game_id = str(snapshot.get("game_id", module_id))
	_seq = 0
	_control_sent_at.clear()
	joined.emit()

func leave_room() -> void:
	if not _joining_id.is_empty():
		logout()
		return
	chat.suspend_room()
	_room_epoch += 1
	var generation := _generation
	var room_epoch := _room_epoch
	_joining_id = ""
	busy = false
	var old_match := match_id
	match_id = ""
	_presence_session_id = ""
	snapshot = {}
	input_provider = Callable()
	if socket != null and connected and not old_match.is_empty():
		await socket.leave_match_async(old_match)
	if generation != _generation or room_epoch != _room_epoch:
		return
	if connected:
		chat.show_lobby()
	left.emit()
	if connected:
		refresh_rooms()

func logout() -> void:
	chat.reset()
	var old_client := client
	var old_session := session
	_generation += 1
	_room_epoch += 1
	_joining_id = ""
	busy = false
	connected = false
	match_id = ""
	_presence_session_id = ""
	snapshot = {}
	input_provider = Callable()
	if socket != null:
		socket.close()
		socket = null
	session = null
	client = null
	connection_changed.emit(false)
	logged_out.emit()
	# Revoke the captured session only; a newer login must not be affected.
	if old_client != null and old_session != null:
		var logout_result = await old_client.session_logout_async(old_session)

func ready_up(value: bool) -> void:
	var payload := {"ready": value}
	if int(snapshot.get("room_flow_version", 0)) >= 1:
		payload["round_id"] = int(snapshot.get("round_id", 0))
	send(2, payload)

func start_round() -> void:
	send(3, {})

func rematch() -> void:
	if snapshot.get("phase") != "results":
		return
	if int(snapshot.get("room_flow_version", 0)) >= 1:
		send(4, {"round_id": int(snapshot.get("round_id", 0))})
	elif str(snapshot.get("host_id", "")) == user_id():
		send(4, {})
	# A legacy server does not support guest rematch. Waiting keeps membership;
	# it must never be implemented as leave/rejoin or an unauthorized request.

func submit_input(data: Dictionary) -> void:
	if data.is_empty():
		return
	_seq += 1
	data["seq"] = _seq
	data["round_id"] = int(snapshot.get("round_id", 0))
	send(1, data)

func send(op: int, data: Dictionary) -> void:
	if connected and socket != null and not match_id.is_empty():
		if op != 1:
			var now := Time.get_ticks_msec()
			if now - int(_control_sent_at.get(op, -1000)) < 220:
				return
			_control_sent_at[op] = now
		var generation := _generation
		var room_epoch := _room_epoch
		var sending_match := match_id
		var result = await socket.send_match_state_async(match_id, op, JSON.stringify(data))
		if generation != _generation or room_epoch != _room_epoch or sending_match != match_id:
			return
		if result.is_exception():
			notice.emit("发送失败，请检查连接。", true)


func _chat_transport(action: String, generation: int, target: String, payload: Dictionary) -> Dictionary:
	if generation != _generation or not connected or socket == null:
		return {"ok": false, "error": "CHAT_AUTH_REQUIRED"}
	var sending_socket := socket
	var result: Variant
	match action:
		"join_lobby":
			if target != "tcp_lobby_v1": return {"ok": false}
			result = await sending_socket.join_chat_async(target, 1, false, false)
		"leave_lobby":
			result = await sending_socket.leave_chat_async(target)
		"send_lobby":
			if not match_id.is_empty() or not _joining_id.is_empty(): return {"ok": false}
			result = await sending_socket.write_chat_message_async(target, payload)
		"send_room":
			if target != match_id or _presence_session_id.is_empty() or payload.get("round_id") != snapshot.get("round_id") or snapshot.get("phase") not in ["lobby", "results"]:
				return {"ok": false}
			result = await sending_socket.send_match_state_async(target, 6, JSON.stringify(payload))
		_:
			return {"ok": false}
	if generation != _generation or sending_socket != socket:
		return {"ok": false, "error": "CHAT_AUTH_REQUIRED"}
	if result == null or result.is_exception():
		return {"ok": false, "error": _chat_exception_code(result.get_exception() if result != null else null)}
	if action == "join_lobby":
		return {"ok": true, "channel_id": result.id}
	return {"ok": true}

func _chat_exception_code(error: Variant, fallback: String = "CHAT_UNAVAILABLE") -> String:
	# Never forward arbitrary server errors/content to notice or diagnostics.
	if not error is Object and not error is Dictionary: return fallback
	var message: Variant = error.get("message")
	if message is String:
		for code in chat.ERRORS:
			if message.contains(code): return code
	return fallback

func _on_chat_channel(message: Variant, generation: int) -> void:
	if generation != _generation: return
	chat.receive_lobby({"channel_id": message.channel_id, "code": message.code,
		"persistent": message.persistent, "message_id": message.message_id,
		"sender_id": message.sender_id, "username": message.username,
		"content": message.content}, generation)

func _on_match_state(state: NakamaRTAPI.MatchData, expected_generation: int = -1) -> void:
	if expected_generation >= 0 and expected_generation != _generation:
		return
	if state.match_id != match_id and state.match_id != _joining_id:
		return
	# Chat never enters gameplay snapshots, diagnostics, QA capture or room notices.
	if state.op_code in [12, 13]:
		chat.receive_room(state.op_code, state.data, state.match_id, _generation)
		return
	if state.op_code == 11:
		var error = JSON.parse_string(state.data)
		_on_room_action_error(error)
		return
	if state.op_code != 10:
		return
	var parser := JSON.new()
	if parser.parse(state.data) != OK:
		return
	var data = parser.data
	if data is Dictionary:
		if not _valid_snapshot(data):
			return
		if not snapshot.is_empty() and int(data.get("tick", -1)) < int(snapshot.get("tick", -1)):
			return
		snapshot = data
		chat.observe_room(state.match_id, data, _generation)
		game_id = str(data.get("game_id", game_id))
		snapshot_received.emit(data)
		var change: Variant = data.get("host_change")
		if change is Dictionary and int(change.get("seq", 0)) > _host_change_seq:
			_host_change_seq = int(change.seq)
			notice.emit("原房主已离开或失去连接，你已成为房主。" if str(change.get("host_id", "")) == user_id() else "原房主已离开或失去连接，房主已移交给仍在房间的玩家。", false)

func _on_presence(event: NakamaRTAPI.MatchPresenceEvent) -> void:
	if event.match_id != match_id or session == null:
		return
	for presence in event.leaves:
		if presence.user_id == user_id() and presence.session_id == _presence_session_id:
			match_id = ""
			_presence_session_id = ""
			snapshot = {}
			input_provider = Callable()
			chat.show_lobby()
			left.emit()
			notice.emit("房间成员身份已结束，账号仍在线。可在大厅重新选择房间。", true)
			return

func _on_closed() -> void:
	chat.reset()
	if not connected:
		return
	_generation += 1
	_room_epoch += 1
	_joining_id = ""
	busy = false
	session = null
	client = null
	socket = null
	connected = false
	match_id = ""
	_presence_session_id = ""
	snapshot = {}
	input_provider = Callable()
	connection_changed.emit(false)
	logged_out.emit()
	notice.emit("连接已断开，请重新登录。", true)


func _report_request_error(_kind: String, error: NakamaException, label: String) -> void:
	# Whitelisted status only: never display/log arbitrary response bodies or server errors.
	var code := error.status_code if error.status_code >= 0 and error.status_code <= 65535 else -1
	var rpc_code := error.grpc_status_code if error.grpc_status_code >= 0 and error.grpc_status_code <= 65535 else -1
	notice.emit("%s（HTTP/SOCKET %d，RPC %d）" % [label, code, rpc_code], true)

func _on_socket_error(error: Variant) -> void:
	if not _chat_exception_code(error, "").is_empty():
		return
	notice.emit("实时连接操作失败，请检查房间状态和客户端版本。", true)

func _on_room_action_error(_error: Variant) -> void:
	notice.emit("房间操作被拒绝，请检查房主、准备状态和轮次。", true)

func _exit_tree() -> void:
	_generation += 1
	_room_epoch += 1
	chat.reset()
	if socket != null:
		socket.close()
