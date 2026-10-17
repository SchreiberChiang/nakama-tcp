class_name GameModule
extends Control
## Created only during playing; all authority remains on the server.
signal exit_requested
var continuous_input := false
var local_user_id := ""
var latest_snapshot: Dictionary = {}

func configure(id: String) -> void:
	local_user_id = id

func apply_snapshot(data: Dictionary) -> void:
	latest_snapshot = data

func collect_input() -> Dictionary:
	return {}

func release() -> void:
	## Stop owned work/connections before the view is freed.
	pass
