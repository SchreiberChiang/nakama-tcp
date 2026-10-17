extends RefCounted
## Session-owned, memory-only controller. Transport and subscriptions stay in Session.
signal changed
signal message_received(message: Dictionary)

const MAX_MESSAGES := 100
const MAX_BYTES := 65536
const LOBBY_TARGET := "tcp_lobby_v1"
const ERRORS := {
	"CHAT_RATE_LIMITED": "发送太快，请稍后再试。",
	"CHAT_TEXT_TOO_LONG": "消息最多 128 个字符、512 字节。",
	"CHAT_INVALID_TEXT": "请输入有效的单行文字。",
	"CHAT_INVALID_MESSAGE": "消息格式无效，请检查内容。",
	"CHAT_INVALID_SCHEMA": "聊天格式不兼容，请更新客户端。",
	"CHAT_PAYLOAD_TOO_LARGE": "消息过长，请缩短后发送。",
	"CHAT_PHASE_UNAVAILABLE": "比赛期间暂停聊天。",
	"CHAT_UNAVAILABLE": "聊天暂时不可用，请稍后再试。",
	"CHAT_AUTH_REQUIRED": "请重新登录后使用聊天。",
	"CHAT_CHANNEL_NOT_ALLOWED": "当前聊天频道不可用。",
	"CHAT_EDIT_NOT_SUPPORTED": "聊天不支持修改或撤回。",
}

var messages: Array:
	get: return _messages.duplicate(true)
var status: String = "聊天未连接"
var title: String = "大厅聊天"
var scope: String = ""
var phase: String:
	get: return _phase
var scope_epoch: int:
	get: return _epoch

var _transport := Callable()
var _generation := -1
var _epoch := 0
var _online := false
var _capable := false
var _self_id := ""
var _desired_lobby := false
var _channel := ""
var _joined_channel := ""
var _pump_serial := 0
var _pumping := false
var _room := ""
var _room_committed := false
var _round := 0
var _snapshot_tick := -1
var _room_version := 0
var _phase := ""
var _members: Dictionary = {}
var _room_sequence := 0
var _sending := false
var _sent_at: Array[int] = []
var _messages: Array[Dictionary] = []
var _bytes := 0
var _seen: Dictionary = {}
var _error_until := 0

func configure(transport: Callable) -> void:
	_transport = transport

func reset() -> void:
	# In-flight work keeps its old serial/generation and cannot mutate the new scope.
	_generation = -1
	_epoch += 1
	_pump_serial += 1
	_pumping = false
	_online = false
	_capable = false
	_self_id = ""
	_desired_lobby = false
	_channel = ""
	_joined_channel = ""
	_room = ""
	_room_committed = false
	_round = 0
	_snapshot_tick = -1
	_room_version = 0
	_phase = ""
	_members.clear()
	_room_sequence = 0
	_clear_scope("")
	status = "聊天未连接"
	title = "大厅聊天"
	changed.emit()

func connected(generation: int, self_id: String, capability: Variant) -> void:
	reset()
	_generation = generation
	_self_id = self_id
	_online = true
	_capable = valid_capability(capability)
	show_lobby()

func show_lobby() -> void:
	if not _online: return
	_epoch += 1
	_room = ""
	_room_committed = false
	_round = 0
	_snapshot_tick = -1
	_room_version = 0
	_members.clear()
	_room_sequence = 0
	_phase = ""
	_clear_scope("lobby")
	title = "大厅聊天"
	_desired_lobby = _capable
	status = "正在连接大厅聊天…" if _capable else "服务器暂不支持聊天"
	changed.emit()
	_drive_lobby()

func enter_room(match_id: String) -> void:
	# Called before awaiting match join; rejects lobby deliveries immediately.
	_epoch += 1
	_desired_lobby = false
	_channel = ""
	_room = match_id
	_room_committed = false
	_round = 0
	_snapshot_tick = -1
	_room_version = 0
	_phase = ""
	_members.clear()
	_room_sequence = 0
	_clear_scope("room:" + match_id)
	title = "房间聊天"
	status = "正在加入房间…"
	changed.emit()
	_drive_lobby()

func commit_room(match_id: String) -> void:
	if _online and match_id == _room:
		_room_committed = true
		_refresh_room_status()
		changed.emit()

func suspend_room() -> void:
	# Disable before awaiting leave_match_async; do not reopen lobby until return.
	_epoch += 1
	_room_committed = false
	_sending = false
	_channel = ""
	_desired_lobby = false
	_clear_scope("")
	status = "正在离开房间…"
	changed.emit()

func observe_room(match_id: String, state: Dictionary, generation: int) -> void:
	if generation != _generation or match_id != _room or not _online: return
	if not integer(state.get("round_id"), 1) or not integer(state.get("tick"), 0): return
	var next_round := int(state.round_id)
	var tick := int(state.tick)
	if next_round < _round or (next_round == _round and tick < _snapshot_tick): return
	var prior_status := status
	var prior_can_send := can_send()
	var prior_epoch := _epoch
	if next_round != _round or state.get("phase", "") != _phase:
		_epoch += 1
		_sending = false
		_error_until = 0
		# Already accepted room history survives rounds; new old-round arrivals do not.
	_round = next_round
	_snapshot_tick = tick
	_phase = str(state.get("phase", ""))
	_room_version = 1 if state.get("room_chat_version") == 1 else 0
	_members.clear()
	var players: Variant = state.get("players")
	if players is Array and players.size() <= 8:
		for player in players:
			if player is Dictionary and identity(player.get("user_id")) and player.get("connected") == true:
				_members[player.user_id] = true
	_refresh_room_status()
	if prior_epoch != _epoch or prior_status != status or prior_can_send != can_send(): changed.emit()

func can_send() -> bool:
	if not _online or not _capable or _sending: return false
	if scope == "lobby": return _desired_lobby and not _channel.is_empty()
	return not _room.is_empty() and _room_committed and _room_version == 1 and _round > 0 and _phase in ["lobby", "results"] and _members.has(_self_id)

func send_text(draft: String) -> bool:
	if not can_send(): return false
	var cleaned := clean_text(draft)
	if cleaned.is_empty():
		_fail("CHAT_INVALID_TEXT")
		return false
	var now := Time.get_ticks_msec()
	while not _sent_at.is_empty() and now - _sent_at[0] >= 1000: _sent_at.pop_front()
	if _sent_at.size() >= 2:
		_fail("CHAT_RATE_LIMITED")
		return false
	var generation := _generation
	var epoch := _epoch
	var target := _channel if scope == "lobby" else _room
	var action := "send_lobby" if scope == "lobby" else "send_room"
	var payload := {"text": cleaned}
	if action == "send_room": payload.round_id = _round
	if JSON.stringify(payload).to_utf8_buffer().size() > 768:
		_fail("CHAT_PAYLOAD_TOO_LARGE")
		return false
	_sent_at.append(now)
	_sending = true
	status = "正在发送…"
	changed.emit()
	draft = ""
	# No optimistic echo or resend. Only received server messages enter history.
	var result: Dictionary = await _transport.call(action, generation, target, payload)
	cleaned = ""
	payload.clear()
	if generation != _generation or epoch != _epoch: return false
	_sending = false
	if result.get("ok") != true:
		_fail(result.get("error", "CHAT_UNAVAILABLE"))
		return false
	status = ""
	changed.emit()
	return true

func receive_lobby(envelope: Dictionary, generation: int) -> void:
	if generation != _generation or not _online or scope != "lobby" or not _desired_lobby or _channel.is_empty(): return
	# Nakama 3.41 ChannelMessageTypeChat is iota 0; 1 is edit, 2 is remove.
	if envelope.get("channel_id") != _channel or envelope.get("code") != 0 or envelope.get("persistent") != false: return
	if not identity(envelope.get("message_id")) or not identity(envelope.get("sender_id")): return
	var content := bounded_object(envelope.get("content"), 1536)
	if content.is_empty() or not content.has("text"): return
	for key in content:
		if key not in ["text", "display_name"]: return
	if not content.text is String: return
	var text := clean_text(content.text)
	if text.is_empty() or text != content.text: return
	var name := display_name(content.get("display_name"))
	if name.is_empty(): name = display_name(envelope.get("username"))
	if name.is_empty(): name = "玩家"
	_append({"id": envelope.message_id, "user_id": envelope.sender_id, "username": name, "text": text, "round_id": 0})

func receive_room(op: int, raw: String, match_id: String, generation: int) -> void:
	if generation != _generation or match_id != _room or not _room_committed or not _online or _room_version != 1 or not _members.has(_self_id): return
	var data := bounded_object(raw, 2048)
	if op == 13:
		# Contract addition: round_id is required to reject delayed prior-round errors.
		if exact_keys(data, ["chat_version", "error", "round_id"]) and data.chat_version == 1 and integer(data.round_id, 1) and int(data.round_id) == _round and _phase in ["lobby", "results"]:
			_fail(data.error)
		return
	if op != 12 or not exact_keys(data, ["chat_version", "message_seq", "round_id", "tick", "user_id", "username", "text"]): return
	if data.chat_version != 1 or not integer(data.message_seq, 1) or not integer(data.round_id, 1) or not integer(data.tick, 0): return
	if int(data.round_id) != _round or int(data.message_seq) <= _room_sequence: return
	if not identity(data.user_id) or not _members.has(data.user_id) or not data.text is String: return
	var text := clean_text(data.text)
	var name := display_name(data.username)
	if text.is_empty() or text != data.text or name.is_empty(): return
	_room_sequence = int(data.message_seq)
	_append({"id": str(_room_sequence), "user_id": data.user_id, "username": name, "text": text, "round_id": _round})

func _drive_lobby() -> void:
	if _pumping or not _online or not _transport.is_valid(): return
	_pumping = true
	_pump_serial += 1
	var serial := _pump_serial
	var generation := _generation
	while generation == _generation and serial == _pump_serial:
		if not _joined_channel.is_empty() and (not _desired_lobby or _channel != _joined_channel):
			var old_channel := _joined_channel
			var left: Dictionary = await _transport.call("leave_lobby", generation, old_channel, {})
			if generation != _generation or serial != _pump_serial: return
			if left.get("ok") != true:
				# Keep uncertain membership recorded; never overlap another join.
				_pumping = false
				if _desired_lobby: _fail("CHAT_UNAVAILABLE")
				return
			_joined_channel = ""
			continue
		if not _desired_lobby or not _channel.is_empty(): break
		var epoch := _epoch
		var joined: Dictionary = await _transport.call("join_lobby", generation, LOBBY_TARGET, {})
		if generation != _generation or serial != _pump_serial: return
		if joined.get("ok") != true or not identity(joined.get("channel_id"), 256):
			if epoch != _epoch: continue
			_pumping = false
			if epoch == _epoch and _desired_lobby: _fail(joined.get("error", "CHAT_UNAVAILABLE"))
			return
		_joined_channel = joined.channel_id
		if epoch != _epoch or not _desired_lobby:
			# The loop leaves this late join before any replacement joins.
			continue
		_channel = _joined_channel
		status = ""
		changed.emit()
	_pumping = false

func _refresh_room_status() -> void:
	if not _capable or _room_version != 1: status = "服务器暂不支持房间聊天"
	elif not _room_committed or not _members.has(_self_id): status = "正在确认房间成员身份…"
	elif _phase not in ["lobby", "results"]: status = "比赛期间暂停聊天"
	elif not _sending and Time.get_ticks_msec() >= _error_until: status = ""

func _fail(code: Variant) -> void:
	status = str(ERRORS.get(code, ERRORS.CHAT_UNAVAILABLE)) if code is String else ERRORS.CHAT_UNAVAILABLE
	_error_until = Time.get_ticks_msec() + 4000
	changed.emit()

func _clear_scope(next_scope: String) -> void:
	scope = next_scope
	_sending = false
	_sent_at.clear()
	_messages.clear()
	_seen.clear()
	_bytes = 0
	_error_until = 0

func _append(item: Dictionary) -> void:
	if _seen.has(item.id): return
	# Account serialized payload plus a conservative per-row bookkeeping allowance.
	var bytes := JSON.stringify(item).to_utf8_buffer().size() + 256
	if bytes > MAX_BYTES: return
	item["_bytes"] = bytes
	_messages.append(item)
	_seen[item.id] = true
	_bytes += bytes
	while _messages.size() > MAX_MESSAGES or _bytes > MAX_BYTES:
		var removed: Dictionary = _messages.pop_front()
		_bytes -= int(removed._bytes)
		_seen.erase(removed.id)
	changed.emit()
	message_received.emit(item.duplicate(true))

static func integer(value: Variant, minimum: int) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] and is_finite(float(value)) and float(value) == floor(float(value)) and float(value) >= minimum and float(value) <= 9007199254740991.0

static func identity(value: Variant, limit: int = 128) -> bool:
	if not value is String or value.is_empty() or value.length() > limit: return false
	for index in value.length():
		var code: int = value.unicode_at(index)
		if code < 33 or code > 126: return false
	return true

static func bounded_object(raw: Variant, maximum: int) -> Dictionary:
	if not raw is String or raw.length() > maximum or raw.to_utf8_buffer().size() > maximum: return {}
	var parser := JSON.new()
	if parser.parse(raw) != OK or not parser.data is Dictionary: return {}
	return parser.data

static func exact_keys(data: Dictionary, keys: Array) -> bool:
	if data.size() != keys.size(): return false
	for key in keys:
		if not data.has(key): return false
	return true

static func _forbidden(code: int) -> bool:
	return code < 32 or (code >= 127 and code <= 159) or (code >= 0xd800 and code <= 0xdfff) or code in [0x2028, 0x2029] or (code >= 0x202a and code <= 0x202e) or (code >= 0x2066 and code <= 0x2069)

static func _space(code: int) -> bool:
	return code in [32, 0xa0, 0x1680, 0x202f, 0x205f, 0x3000, 0xfeff] or (code >= 0x2000 and code <= 0x200a)

static func clean_text(value: String) -> String:
	if value.length() > 1024: return ""
	for index in value.length():
		if _forbidden(value.unicode_at(index)): return ""
	var start := 0
	var end := value.length()
	while start < end and _space(value.unicode_at(start)): start += 1
	while end > start and _space(value.unicode_at(end - 1)): end -= 1
	var text := value.substr(start, end - start)
	if text.is_empty() or text.length() > 128 or text.to_utf8_buffer().size() > 512: return ""
	var visible := false
	for index in text.length():
		var code := text.unicode_at(index)
		if not _space(code) and code not in [0x200b, 0x200c, 0x200d, 0x2060]: visible = true
	return text if visible else ""

static func display_name(value: Variant) -> String:
	if not value is String or value.length() > 32 or value.to_utf8_buffer().size() > 128: return ""
	for index in value.length():
		if value.unicode_at(index) in [0x61c, 0x200e, 0x200f]: return ""
	return clean_text(value)

static func valid_capability(value: Variant) -> bool:
	if not value is Dictionary or value.get("version") != 1: return false
	var lobby: Variant = value.get("lobby")
	var room: Variant = value.get("room")
	var limits: Variant = value.get("limits")
	return lobby is Dictionary and lobby.get("target") == LOBBY_TARGET and lobby.get("type") == 1 and lobby.get("persistence") == false and lobby.get("hidden") == false and room is Dictionary and room.get("send_op") == 6 and room.get("message_op") == 12 and room.get("error_op") == 13 and limits is Dictionary and limits.get("codepoints") == 128 and limits.get("utf8_bytes") == 512 and limits.get("messages_per_second") == 2
