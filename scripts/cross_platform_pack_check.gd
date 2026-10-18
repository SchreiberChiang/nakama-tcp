extends SceneTree
## External checker. Loads the packed entry explicitly; never logs in or invokes network actions.
var files: Array[String] = []
var bad_nodes: Array[String] = []
var report := ""

func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--report="): report = arg.substr(9)
	call_deferred("_check")

func _walk(dir: String) -> void:
	for file in DirAccess.get_files_at(dir): files.append(dir.path_join(file))
	for child in DirAccess.get_directories_at(dir): _walk(dir.path_join(child))

func _nodes(node: Node) -> void:
	if node is Node3D or node is SubViewport or node is AudioStreamPlayer or node is AudioStreamPlayer2D or node is AudioStreamPlayer3D or node is AnimationPlayer:
		bad_nodes.append(node.get_class())
	for child in node.get_children(): _nodes(child)

func _check() -> void:
	_walk("res://")
	files.sort()
	var registry: Variant = load("res://core/module_registry.gd")
	var empty_registry: bool = registry.modules.is_empty()
	var scene: PackedScene = load("res://tests/cross_platform/entry.tscn")
	var ui: Node = scene.instantiate()
	root.add_child(ui)
	await process_frame
	await process_frame
	_nodes(root)
	var result := {
		"files": files, "bad_nodes": bad_nodes, "empty_registry": empty_registry,
		"main_scene": ProjectSettings.get_setting("application/run/main_scene"),
		"session": ProjectSettings.get_setting("autoload/Session"),
		"has_entry": ResourceLoader.exists("res://tests/cross_platform/entry.tscn"),
		"has_main": ResourceLoader.exists("res://Main.tscn"),
		"has_fixture": ResourceLoader.exists("res://tests/fixture_view.gd"),
		"entry_instantiated": is_instance_valid(ui),
		"fixture_registry_count": registry.modules.size(),
		"has_fixture_module": registry.modules.has("fixture"),
		"isolated_user_data": bool(ProjectSettings.get_setting("application/config/use_custom_user_dir", false)) and str(ProjectSettings.get_setting("application/config/custom_user_dir_name", "")).begins_with("nakama-cross-platform-"),
		"test_enabled": ProjectSettings.get_setting("cross_platform/enabled", false)
	}
	var file := FileAccess.open(report, FileAccess.WRITE)
	file.store_string(JSON.stringify(result))
	file.close()
	quit(0 if bad_nodes.is_empty() and empty_registry else 1)
