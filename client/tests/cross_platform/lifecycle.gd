extends Node
## Test-only background policy for this acceptance stage: entering background stops
## local input immediately and calls the existing Session.logout(); returning to the
## foreground stays on the login page and never reconnects or restores the round.
## Native window focus loss is not background. Repeated hide/pause signals are idempotent.
const BRIDGE_SCRIPT := preload("res://tests/cross_platform/js_lifecycle_bridge.gd")
signal background_entered(source: String)
signal foreground_returned(source: String)
var session: Node = null
var bridge: RefCounted = null
var view_provider := Callable()
var hidden := false
var background_entries := 0
var duplicate_background_signals := 0
var foreground_returns := 0
var _released := false

## The WeChat package bridge, or null on native clients / when the global is absent.
static func engine_bridge() -> RefCounted:
	if not OS.has_feature("web"):
		return null
	var bridge_interface: Variant = JavaScriptBridge.get_interface(BRIDGE_SCRIPT.GLOBAL_NAME)
	if bridge_interface == null:
		return null
	return BRIDGE_SCRIPT.new(bridge_interface, func(target: Callable): return JavaScriptBridge.create_callback(target))

func setup(session_node: Node, lifecycle_bridge: RefCounted, current_view: Callable) -> void:
	session = session_node
	bridge = lifecycle_bridge
	view_provider = current_view
	if bridge != null and not bridge.subscribe(_on_bridge_state):
		bridge = null
	if bridge != null and bridge.is_hidden():
		enter_background("bridge_initial")

func has_bridge() -> bool:
	return bridge != null

func enter_background(source: String = "simulated") -> void:
	if _released:
		return
	if hidden:
		duplicate_background_signals += 1
		return
	hidden = true
	background_entries += 1
	_stop_local_input()
	if session != null:
		session.logout()
	background_entered.emit(source)

func return_foreground(source: String = "simulated") -> void:
	if _released or not hidden:
		return
	hidden = false
	foreground_returns += 1
	foreground_returned.emit(source)

func release() -> void:
	if _released:
		return
	_released = true
	if bridge != null:
		bridge.release()
	bridge = null
	view_provider = Callable()
	session = null

func _stop_local_input() -> void:
	if session != null:
		session.input_provider = Callable()
	var view: Variant = view_provider.call() if view_provider.is_valid() else null
	if is_instance_valid(view) and view.has_method("clear_local_input"):
		view.clear_local_input()

func _on_bridge_state(state: String) -> void:
	if state == "hide":
		enter_background("bridge")
	elif state == "show":
		return_foreground("bridge")

func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_PAUSED:
			enter_background("application_paused")
		NOTIFICATION_APPLICATION_RESUMED:
			return_foreground("application_resumed")
		NOTIFICATION_EXIT_TREE:
			release()
