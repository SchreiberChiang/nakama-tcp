extends SceneTree
func _initialize() -> void:
	call_deferred("_check")
func _check() -> void:
	var session := root.get_node("Session")
	var expected := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--profile="): expected = arg.substr(10)
	if not expected.begins_with("test-owned-") or session.profile != expected or session.config_path() != "user://template-" + expected + ".cfg" or not FileAccess.file_exists(session.config_path()):
		print("FAIL owned profile mismatch")
		quit(1)
		return
	print("PROFILE_SMOKE_OK")
	quit()
