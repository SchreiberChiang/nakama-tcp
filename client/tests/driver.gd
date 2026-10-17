extends SceneTree
## File IPC is test-only. The real Main controls and Session connect to the owned loopback server.
var ui: Control
var dir := ""
var last_command := 0
var working := false

func _initialize() -> void:
	call_deferred("_start")

func _start() -> void:
	dir = str(root.get_node("Session").arg("evidence"))
	if dir.is_empty():
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(dir)
	if root.get_node("Session").arg("fixture") == "true":
		ModuleRegistry.register_module("fixture", func(): return load("res://tests/fixture_view.gd").new())
	ui = load("res://Main.tscn").instantiate()
	root.add_child(ui)
	await process_frame
	await process_frame
	_write("ready.json", {"ready": true})

func _process(_delta: float) -> bool:
	if dir.is_empty() or working:
		return false
	var target := dir.path_join("command.json")
	if not FileAccess.file_exists(target):
		return false
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(target)) != OK:
		return false # An IPC writer may still be replacing this test-only file.
	var command: Variant = parser.data
	if command is Dictionary and int(command.get("id", 0)) > last_command:
		last_command = int(command.id)
		working = true
		_execute(command)
	return false

func _execute(command: Dictionary) -> void:
	var session_node := root.get_node("Session")
	var ok := true
	match str(command.get("action", "status")):
		"login":
			var edit := ui.find_child("PlayerName", true, false) as LineEdit
			edit.text = session_node.arg("name", "Tester")
			ui.find_child("Login", true, false).pressed.emit()
		"button":
			var button := ui.find_child(str(command.get("button", "")), true, false) as Button
			ok = button != null and not button.disabled
			if ok: button.pressed.emit()
		"join":
			session_node.join_room(str(command.room), "fixture")
		"input":
			session_node.submit_input({"pulse": true})
		"raw":
			session_node.send(int(command.op), command.payload)
		"screenshot":
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(dir.path_join(str(command.get("name", "screen")) + ".png"))
		"disconnect":
			session_node.socket.close()
		"cancel_login":
			session_node.logout()
		"exit":
			await session_node.logout()
			_write("response.json", {"id": last_command, "ok": true})
			quit()
			return
	await process_frame
	var data := _status(session_node)
	data["id"] = last_command
	data["ok"] = ok
	_write("response.json", data)
	working = false

func _status(session_node: Node) -> Dictionary:
	var nodes: Array = []
	var resources: Dictionary = {}
	var bad: Array = []
	_scan(root, nodes, resources, bad)
	var state: Dictionary = session_node.snapshot
	var score := 0
	var ready := false
	var connected_count := 0
	for player in state.get("players", []):
		if player.get("connected", false): connected_count += 1
		if player.get("user_id") == session_node.user_id():
			score = int(player.get("score", 0))
			ready = bool(player.get("ready", false))
	return {"page": ui.page, "connected": session_node.connected, "busy": session_node.busy,
		"room": session_node.match_id, "phase": state.get("phase", ""),
		"round": int(state.get("round_id", 0)), "members": connected_count,
		"host_self": state.get("host_id", "") == session_node.user_id() and not session_node.user_id().is_empty(),
		"ready_self": ready, "score": score, "results": state.get("results", []).size(),
		"catalog": session_node.catalog.size(), "modules": ModuleRegistry.modules.size(),
		"empty_state": ui.find_child("EmptyState", true, false) != null,
		"active_module": is_instance_valid(ui.module_view), "bad_nodes": bad,
		"nodes": nodes, "resources": resources.keys(),
		"sdk_pending": session_node.socket._requests.size() if session_node.socket != null else 0}

func _scan(node: Node, nodes: Array, resources: Dictionary, bad: Array) -> void:
	nodes.append(node.get_class())
	if node is Node3D or node is SubViewport or node is AudioStreamPlayer or node is AudioStreamPlayer3D or node is AnimationPlayer:
		bad.append(str(node.get_path()))
	for property in node.get_property_list():
		if int(property.type) == TYPE_OBJECT:
			var value: Variant = node.get(property.name)
			if is_instance_valid(value) and value is Resource: _scan_resource(value, resources)
	for child in node.get_children(): _scan(child, nodes, resources, bad)

func _scan_resource(resource: Resource, resources: Dictionary) -> void:
	var key := resource.resource_path if not resource.resource_path.is_empty() else str(resource.get_instance_id())
	if resources.has(key): return
	resources[key] = true
	for property in resource.get_property_list():
		if int(property.type) == TYPE_OBJECT:
			var value: Variant = resource.get(property.name)
			if is_instance_valid(value) and value is Resource: _scan_resource(value, resources)

func _write(file_name: String, data: Dictionary) -> void:
	var file := FileAccess.open(dir.path_join(file_name), FileAccess.WRITE)
	file.store_string(JSON.stringify(data))
	file.close()
