extends SceneTree
## Actual Session and Main with manually completed SDK responses; no backend.
var checks := 0
var failures := 0

class Pending extends RefCounted:
	signal completed(result)

class FakeClient extends NakamaClient:
	var pending: Array = []
	func _init():
		var adapter := NakamaHTTPAdapter.new()
		adapter.logger = NakamaLogger.new()
		super(adapter, "", "http", "127.0.0.1", 7350, 8)
		adapter.free()
	func rpc_async(_session: NakamaSession, _id: String, _payload = null):
		var request := Pending.new()
		pending.append(request)
		return await request.completed
	func session_logout_async(_session: NakamaSession):
		return NakamaAsyncResult.new()
	func finish(index: int, payload: String, failed := false) -> void:
		var result := NakamaAPI.ApiRpc.new(NakamaException.new("PRIVATE_RESPONSE_SENTINEL", 503, 14) if failed else null)
		result._payload = payload
		pending[index].completed.emit(result)
		pending[index] = null

class FakeSocket extends NakamaSocket:
	var pending: Array = []
	func _init():
		var adapter := NakamaSocketAdapter.new()
		adapter.logger = NakamaLogger.new()
		super(adapter, "127.0.0.1", 7350, "ws", false)
		adapter.free()
	func join_match_async(_id: String, _metadata = null):
		var request := Pending.new()
		pending.append(request)
		return await request.completed
	func leave_match_async(_id: String):
		return NakamaAsyncResult.new()
	func close():
		pass
	func finish(index: int, success := false) -> void:
		var result := NakamaRTAPI.Match.new(null if success else NakamaException.new("PRIVATE_JOIN_SENTINEL", 503, 14))
		result.match_id = "joined-room"
		pending[index].completed.emit(result)
		pending[index] = null

func payload(id := "current") -> String:
	return JSON.stringify({"rooms": [{"match_id": id, "size": 1, "label": {"game_id": "alpha", "name": "有效房间", "capacity": 4, "phase": "lobby"}}]})

func complete(session: Node, client: FakeClient, value: String, failed := false) -> void:
	session.refresh_rooms()
	client.finish(client.pending.size() - 1, value, failed)

func _initialize() -> void:
	_run.call_deferred()

func check(ok: bool, description: String) -> void:
	checks += 1
	failures += int(not ok)
	print(("PASS " if ok else "FAIL ") + description)

func _run() -> void:
	var session = root.get_node("Session")
	var client := FakeClient.new()
	session.client = client
	session.session = NakamaSession.new()
	session.connected = true
	ModuleRegistry.modules = {"alpha": {"metadata": {}}, "beta": {"metadata": {}}}
	session.catalog = [{"id": "alpha", "module_version": 1}, {"id": "beta", "module_version": 1}]
	var ui = load("res://ui/main.gd").new()
	root.add_child(ui)
	session.authenticated.emit()
	ui.find_child("RoomName", true, false).text = "草稿房间"
	ui.find_child("Capacity", true, false).value = 7
	ui.find_child("Modules", true, false).select(1)
	session.refresh_rooms()
	client.finish(0, '{"rooms":[]}')
	check(ui.find_child("RoomName", true, false).text == "草稿房间", "refresh preserves room name")
	check(ui.find_child("Capacity", true, false).value == 7, "refresh preserves capacity")
	check(ui._available[ui.find_child("Modules", true, false).selected].id == "beta", "refresh preserves selected module id")
	complete(session, client, payload("last-good"))
	session.refresh_rooms()
	client.finish(client.pending.size() - 1, "{}", true)
	check(session.rooms.size() == 1 and session.rooms[0].match_id == "last-good", "RPC failure preserves last valid rooms")
	check(session.rooms_state == "error" and "过期" in ui.find_child("RoomListState", true, false).text, "failure visibly marks preserved list stale and retryable")
	var name_control = ui.find_child("RoomName", true, false)
	name_control.grab_focus()
	var name_id: int = name_control.get_instance_id()
	session.refresh_rooms()
	check(session.rooms_state == "loading" and "正在" in ui.find_child("RoomListState", true, false).text, "in-flight refresh shows loading state")
	client.finish(client.pending.size() - 1, payload())
	check(session.rooms_state == "ready" and session.rooms[0].match_id == "current", "retry recovers successful room list")
	check(ui.find_child("RoomName", true, false).get_instance_id() == name_id and name_control.has_focus(), "refresh keeps actual form control and keyboard focus")
	complete(session, client, '{"rooms":[]}')
	check(session.rooms.is_empty() and session.rooms_state == "ready" and ui.find_child("RoomListState", true, false).text == "暂无房间。", "successful empty list is distinct from failure")
	complete(session, client, payload("good"))
	for malformed in ['{}', '{"rooms":{}}', '{"rooms":[{}]}', '{"rooms":[{"match_id":2}]}', '[]', 'PRIVATE_RAW_SENTINEL']:
		complete(session, client, malformed)
		check(session.rooms_state == "error" and session.rooms[0].match_id == "good", "malformed response retains valid list")
	for field in ["size", "name", "capacity", "phase", "game_id"]:
		var malformed: Dictionary = JSON.parse_string(payload())
		if field == "size": malformed.rooms[0][field] = -1
		else: malformed.rooms[0].label[field] = []
		complete(session, client, JSON.stringify(malformed))
		check(session.rooms_state == "error" and session.rooms[0].match_id == "good", "invalid consumed room field rejected: " + field)
	check(not "PRIVATE" in ui.find_child("RoomListState", true, false).text and not "PRIVATE" in ui.status.text, "server raw bodies and errors never enter UI notices")
	# Newer completion wins whether the older one succeeds or fails.
	for old_fails in [false, true]:
		session.refresh_rooms()
		var old := client.pending.size() - 1
		session.refresh_rooms()
		client.finish(old + 1, payload("new"))
		client.finish(old, payload("old"), old_fails)
		check(session.rooms_state == "ready" and session.rooms[0].match_id == "new", "older refresh completion cannot overwrite newer success")
	session.refresh_rooms()
	var older_success := client.pending.size() - 1
	session.refresh_rooms()
	client.finish(older_success + 1, '{}', true)
	client.finish(older_success, payload("obsolete"))
	check(session.rooms_state == "error" and session.rooms[0].match_id == "new", "older success cannot conceal newer failure")
	# Rebuilding a lobby uses module strings, independent of catalog order.
	session.catalog.reverse()
	ui._show_lobby()
	check(ui._available[ui.find_child("Modules", true, false).selected].id == "beta", "catalog reorder restores selection by module id")
	session.catalog = [{"id": "alpha", "module_version": 1}]
	ui._show_lobby()
	check(ui._available[ui.find_child("Modules", true, false).selected].id == "alpha", "removed selection falls back to available module")
	var socket := FakeSocket.new()
	session.socket = socket
	session.refresh_rooms()
	var before_join := client.pending.size() - 1
	session.join_room("joining", "alpha")
	ui._process(0)
	check(ui._join_buttons[0].disabled, "join buttons disabled while joining")
	socket.finish(0)
	ui._process(0)
	check(not ui._join_buttons[0].disabled, "failed join restores retry button")
	client.finish(before_join, payload("obsolete"))
	check(session.rooms[0].match_id == "new", "refresh started before failed join stays invalid after join finishes")
	session.refresh_rooms()
	var before_create := client.pending.size() - 1
	session.create_room("test", "alpha")
	client.finish(client.pending.size() - 1, '{}', true)
	client.finish(before_create, payload("obsolete"))
	check(session.rooms[0].match_id == "new", "refresh started before create stays invalid after create fails")
	session.refresh_rooms()
	var joining_refresh := client.pending.size() - 1
	session.refresh_rooms()
	session.join_room("joining", "alpha")
	client.finish(joining_refresh, payload("obsolete"), true)
	check(session.rooms[0].match_id == "new" and session.rooms_state != "error", "old error during pending join cannot alter lobby state")
	socket.finish(1, true)
	client.finish(joining_refresh + 1, payload("obsolete"))
	check(session.match_id == "joined-room", "real Session accepts current join completion")
	check(session.rooms[0].match_id == "new", "old success after joining cannot update new room list")
	var in_room_requests := client.pending.size()
	session.refresh_rooms()
	check(client.pending.size() == in_room_requests, "refresh does not issue requests from inside room")
	session.match_id = ""
	session.refresh_rooms()
	var before_leave := client.pending.size() - 1
	session.match_id = "room"
	session.leave_room()
	client.finish(before_leave, payload("obsolete"))
	check(session.rooms.is_empty() and not session.rooms_have_success, "leave clears list and ignores pre-room refresh")
	await process_frame
	# The automatic post-leave refresh is pending; logout invalidates it too.
	var before_logout := client.pending.size() - 1
	session.logout()
	session.client = client
	session.session = NakamaSession.new()
	session.socket = socket
	session.connected = true
	session.authenticated.emit()
	client.finish(before_logout, payload("old-account"))
	check(session.rooms.is_empty() and session.rooms_state == "idle", "logout and relogin reject previous connection list")
	check(ui.find_child("RoomName", true, false).text == "新房间" and ui.find_child("Capacity", true, false).value == 4, "new login resets queued old form drafts")
	# Loading listeners are allowed to reenter synchronously.
	var cancel := func():
		if session.rooms_state == "loading": session.logout()
	session.rooms_state_changed.connect(cancel)
	var requests_before := client.pending.size()
	session.refresh_rooms()
	check(client.pending.size() == requests_before and ui.page == "login", "loading listener logout prevents sending obsolete RPC")
	session.rooms_state_changed.disconnect(cancel)
	session.client = client
	session.session = NakamaSession.new()
	session.connected = true
	var nested := {"started": false}
	var newer_refresh := func():
		if session.rooms_state == "loading" and not nested.started:
			nested.started = true
			session.refresh_rooms()
	session.rooms_state_changed.connect(newer_refresh)
	requests_before = client.pending.size()
	session.refresh_rooms()
	check(client.pending.size() == requests_before + 1, "reentrant newer refresh prevents obsolete outer RPC send")
	client.finish(client.pending.size() - 1, payload("nested"))
	session.rooms_state_changed.disconnect(newer_refresh)
	var updates := {"count": 0}
	var observe := func(_rooms): updates.count += 1
	var ready_logout := func():
		if session.rooms_state == "ready": session.logout()
	session.rooms_updated.connect(observe)
	session.rooms_state_changed.connect(ready_logout)
	complete(session, client, payload())
	check(updates.count == 0 and session.rooms.is_empty(), "ready-state logout prevents subsequent obsolete rooms signal")
	session.rooms_updated.disconnect(observe)
	session.rooms_state_changed.disconnect(ready_logout)
	session.client = client
	session.session = NakamaSession.new()
	session.connected = true
	ModuleRegistry.modules = {}
	session.catalog = []
	session.authenticated.emit()
	complete(session, client, '{}', true)
	check(ui.find_child("EmptyState", true, false) != null and ui.find_child("Create", true, false) == null and not is_instance_valid(ui.module_view), "empty registration and failure page load no gameplay module")
	complete(session, client, payload())
	session.match_id = "removed-room"
	session._presence_session_id = "removed-presence"
	var event := NakamaRTAPI.MatchPresenceEvent.new()
	event.match_id = "removed-room"
	var presence := NakamaRTAPI.UserPresence.new()
	presence.user_id = session.user_id()
	presence.session_id = "removed-presence"
	event.leaves = [presence]
	session._on_presence(event)
	check(session.match_id.is_empty() and session.rooms.is_empty() and session.rooms_state == "idle", "server membership removal clears old lobby list")
	complete(session, client, payload())
	check(session.rooms_state == "ready" and ui.page == "lobby" and not is_instance_valid(ui.module_view), "manual refresh recovers lobby after server membership removal")
	session._on_closed()
	check(session.rooms.is_empty() and session.rooms_state == "idle" and not session.rooms_have_success, "socket close clears cached list status")
	ui.queue_free()
	session.client = null
	session.session = null
	session.connected = false
	session.socket = null
	await process_frame
	if session.profile.begins_with("unit-lobby-"):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(session.config_path()))
	print("LOBBY_STATE checks=%d failures=%d" % [checks, failures])
	quit(1 if failures else 0)
