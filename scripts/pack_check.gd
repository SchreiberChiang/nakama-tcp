extends SceneTree
## Runs from outside the client source using --main-pack. Audits the actual shipped file system.
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
	if node is Node3D or node is SubViewport or node is AudioStreamPlayer or node is AudioStreamPlayer3D or node is AnimationPlayer:
		bad_nodes.append(str(node.get_path()))
	for child in node.get_children(): _nodes(child)

func _check() -> void:
	_walk("res://")
	files.sort()
	var scene: PackedScene = load("res://Main.tscn")
	var ui := scene.instantiate()
	root.add_child(ui)
	await process_frame
	await process_frame
	_nodes(root)
	var registry: Variant = load("res://core/module_registry.gd")
	var result := {"files": files, "bad_nodes": bad_nodes, "page": ui.page, "empty_registry": registry.modules.is_empty(), "has_fixture": ResourceLoader.exists("res://tests/fixture_view.gd")}
	var file := FileAccess.open(report, FileAccess.WRITE)
	file.store_string(JSON.stringify(result))
	file.close()
	quit(0 if bad_nodes.is_empty() and ui.page == "login" and not result.has_fixture else 1)
